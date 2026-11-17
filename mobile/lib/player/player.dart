// The player. It lives outside the screens, in Android's media service (audio_service), so music keeps playing with
// the app in the background or the screen off, and shows on the lock screen, in the notification and on Bluetooth.
// The queue follows lib/queue.dart, the web app's rules. A saved song plays from the phone, with no request for its
// audio; if that copy will not play and there is a connection, it streams.
import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:audio_service/audio_service.dart';
import 'package:audio_session/audio_session.dart';
import 'package:flutter/foundation.dart';
import 'package:just_audio/just_audio.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../api/client.dart';
import '../api/models.dart';
import '../offline/offline.dart';
import 'queue.dart' as q;

enum Repeat { off, all, one }

class EcoPlayer extends BaseAudioHandler with SeekHandler {
  EcoPlayer._();

  static late final EcoPlayer instance;

  static Future<void> init() async {
    instance = await AudioService.init(
      builder: EcoPlayer._,
      config: const AudioServiceConfig(
        androidNotificationChannelId: 'io.github.thrashy190.eco.playback',
        androidNotificationChannelName: 'Playback',
        androidNotificationIcon: 'drawable/ic_notification',
        androidStopForegroundOnPause: true,
      ),
    );
    await instance._setup();
  }

  final AudioPlayer audio = AudioPlayer();

  /// The play order and the song playing. Screens listen to it.
  final ValueNotifier<q.Order> order = ValueNotifier(q.Order.empty);
  final ValueNotifier<bool> shuffle = ValueNotifier(false);
  final ValueNotifier<Repeat> repeat = ValueNotifier(Repeat.off);

  /// Off unless someone turns it on: when the queue runs out, random songs from the library follow.
  final ValueNotifier<bool> autoplay = ValueNotifier(false);

  /// A message for the screen (a song that would not play).
  final ValueNotifier<String?> problem = ValueNotifier(null);

  Song? get current => order.value.current;
  bool _scrobbled = false;
  bool _fetchingAuto = false;
  bool _retried = false;

  Future<void> _setup() async {
    final session = await AudioSession.instance;
    await session.configure(const AudioSessionConfiguration.music());
    audio.playbackEventStream.listen((_) => _broadcast(), onError: (Object e, StackTrace _) => _failed(e));
    audio.playingStream.listen((_) => _broadcast());
    audio.processingStateStream.listen((s) {
      if (s == ProcessingState.completed) unawaited(_ended());
    });
    audio.positionStream.listen(_watchPosition);
    audio.durationStream.listen((d) {
      final item = mediaItem.value;
      if (d != null && item != null && item.duration != d) mediaItem.add(item.copyWith(duration: d));
    });
    final prefs = await SharedPreferences.getInstance();
    autoplay.value = prefs.getBool('eco.autoplay') ?? false;
    repeat.value = Repeat.values.firstWhere((r) => r.name == prefs.getString('eco.repeat'), orElse: () => Repeat.off);
    await _restore();
  }

  // ---- Controls the screens use ----

  /// Play a list from song i.
  Future<void> playList(List<Song> songs, int i) async {
    if (songs.isEmpty) return;
    var start = i.clamp(0, songs.length - 1);
    var list = songs;
    if (shuffle.value) {
      final first = songs[start];
      final rest = [...songs]..removeAt(start);
      list = [first, ...rest..shuffle(Random())];
      start = 0;
    }
    _setOrder(q.startList(order.value, list, start));
    await _load(play: true);
  }

  Future<void> playShuffled(List<Song> songs) async {
    if (songs.isEmpty) return;
    shuffle.value = true;
    await playList(songs, Random().nextInt(songs.length));
  }

  void playNext(Song song) {
    final empty = order.value.queue.isEmpty;
    _setOrder(q.addNext(order.value, song));
    if (empty) unawaited(_load(play: true));
  }

  void addToQueue(Song song) {
    final empty = order.value.queue.isEmpty;
    _setOrder(q.addToQueue(order.value, song));
    if (empty) unawaited(_load(play: true));
  }

  void moveInQueue(int from, int to) => _setOrder(q.move(order.value, from, to));
  void removeFromQueue(int at) => _setOrder(q.removeAt(order.value, at));

  Future<void> jumpTo(int at) async {
    _setOrder(q.jump(order.value, at));
    await _load(play: true);
  }

  void toggleShuffle() {
    shuffle.value = !shuffle.value;
    if (shuffle.value) _setOrder(q.shuffleUpcoming(order.value, (s) => [...s]..shuffle(Random())));
    _broadcast();
  }

  Future<void> cycleRepeat() async {
    repeat.value = Repeat.values[(repeat.value.index + 1) % Repeat.values.length];
    await (await SharedPreferences.getInstance()).setString('eco.repeat', repeat.value.name);
    _broadcast();
  }

  Future<void> toggleAutoplay() async {
    autoplay.value = !autoplay.value;
    if (!autoplay.value) _setOrder(q.withoutAutoplay(order.value));
    await (await SharedPreferences.getInstance()).setBool('eco.autoplay', autoplay.value);
  }

  /// Mark a song as a favourite (or not) wherever it sits in the queue.
  void starred(String id, bool on) {
    final o = order.value;
    if (!o.queue.any((s) => s.id == id)) return;
    _setOrder(q.Order([for (final s in o.queue) s.id == id ? s.withStarred(on) : s], o.index), save: false);
    final item = mediaItem.value;
    if (item != null && item.id == id) mediaItem.add(item.copyWith(rating: Rating.newHeartRating(on)));
  }

  // ---- What the media session asks (notification, lock screen, headphones) ----
  @override
  Future<void> play() async {
    if (audio.audioSource == null && current != null) return _load(play: true);
    await audio.play();
  }

  @override
  Future<void> pause() => audio.pause();

  @override
  Future<void> stop() async {
    await audio.stop();
    await super.stop();
  }

  @override
  Future<void> seek(Duration position) => audio.seek(position);

  @override
  Future<void> skipToNext() async {
    final o = order.value;
    if (o.index + 1 < o.queue.length) {
      _setOrder(q.jump(o, o.index + 1));
    } else if (repeat.value == Repeat.all && o.queue.isNotEmpty) {
      _setOrder(q.Order(o.queue, 0));
    } else if (!await _autoplayMore()) {
      return;
    } else {
      _setOrder(q.jump(order.value, order.value.index + 1));
    }
    await _load(play: true);
  }

  @override
  Future<void> skipToPrevious() async {
    final o = order.value;
    if (audio.position > const Duration(seconds: 3) || o.index == 0) {
      await audio.seek(Duration.zero);
      return;
    }
    _setOrder(q.Order(o.queue, o.index - 1));
    await _load(play: true);
  }

  @override
  Future<void> skipToQueueItem(int index) => jumpTo(index);

  @override
  Future<void> setShuffleMode(AudioServiceShuffleMode shuffleMode) async {
    if ((shuffleMode != AudioServiceShuffleMode.none) != shuffle.value) toggleShuffle();
  }

  @override
  Future<void> setRepeatMode(AudioServiceRepeatMode repeatMode) async {
    final want = switch (repeatMode) {
      AudioServiceRepeatMode.one => Repeat.one,
      AudioServiceRepeatMode.all || AudioServiceRepeatMode.group => Repeat.all,
      _ => Repeat.off,
    };
    while (repeat.value != want) {
      await cycleRepeat();
    }
  }

  // ---- Inside ----
  void _setOrder(q.Order next, {bool save = true}) {
    order.value = next;
    queue.add(next.queue.map(_item).toList());
    if (save) unawaited(_save());
  }

  MediaItem _item(Song s) {
    final local = offline.coverPath(s);
    final art = local != null ? Uri.file(local) : (api.songCover(s, 600) != null ? Uri.parse(api.songCover(s, 600)!) : null);
    return MediaItem(
      id: s.id,
      title: s.title,
      artist: s.artist,
      album: s.album,
      duration: s.duration != null ? Duration(seconds: s.duration!) : null,
      artUri: art,
      rating: Rating.newHeartRating(s.isStarred),
    );
  }

  Future<void> _load({required bool play, Duration position = Duration.zero, bool stream = false}) async {
    final song = current;
    if (song == null) return;
    _scrobbled = false;
    if (!stream) _retried = false;
    problem.value = null;
    mediaItem.add(_item(song));
    final local = stream ? null : offline.filePath(song.id);
    final source = local != null ? AudioSource.file(local) : AudioSource.uri(api.sourceUrl(song));
    try {
      await audio.setAudioSource(source, initialPosition: position);
      if (play) unawaited(audio.play());
    } catch (e) {
      await _failed(e);
    }
  }

  /// A song that would not play: a saved copy streams instead; otherwise say so and carry on with the next.
  Future<void> _failed(Object e) async {
    final song = current;
    if (song == null) return;
    if (!_retried && offline.filePath(song.id) != null) {
      _retried = true;
      return _load(play: true, position: audio.position, stream: true);
    }
    if (e is PlayerInterruptedException) return;
    problem.value = 'Could not play “${song.title}”';
    if (order.value.index + 1 < order.value.queue.length) {
      _setOrder(q.jump(order.value, order.value.index + 1));
      await _load(play: true);
    }
  }

  Future<void> _ended() async {
    if (repeat.value == Repeat.one) {
      await audio.seek(Duration.zero);
      await audio.play();
      return;
    }
    final o = order.value;
    if (o.index + 1 < o.queue.length) {
      _setOrder(q.jump(o, o.index + 1));
      return _load(play: true);
    }
    if (repeat.value == Repeat.all && o.queue.isNotEmpty) {
      _setOrder(q.Order(o.queue, 0));
      return _load(play: true);
    }
    if (await _autoplayMore()) {
      _setOrder(q.jump(order.value, order.value.index + 1));
      return _load(play: true);
    }
    await audio.pause();
    await audio.seek(Duration.zero);
  }

  /// Autoplay: ten random songs that are not in the queue yet; offline, from what is saved on the phone.
  Future<bool> _autoplayMore() async {
    if (!autoplay.value || _fetchingAuto) return false;
    _fetchingAuto = true;
    try {
      List<Song> candidates;
      try {
        candidates = await api.getRandomSongs(30);
      } catch (_) {
        candidates = offline.allSongs..shuffle(Random());
      }
      final picked = q.autoplayPick(candidates, order.value.queue, 10);
      if (picked.isEmpty) return false;
      _setOrder(q.Order([...order.value.queue, ...picked], order.value.index));
      return true;
    } finally {
      _fetchingAuto = false;
    }
  }

  /// Navidrome counts a song as played once half of it (or four minutes) has gone by.
  void _watchPosition(Duration position) {
    final song = current;
    if (song == null || _scrobbled || song.mediaId != null) return;
    final length = audio.duration ?? Duration(seconds: song.duration ?? 0);
    if (length == Duration.zero) return;
    final enough = Duration(milliseconds: min(length.inMilliseconds ~/ 2, 240000));
    if (position >= enough) {
      _scrobbled = true;
      unawaited(api.scrobble(song.id));
    }
  }

  void _broadcast() {
    final playing = audio.playing;
    final o = order.value;
    playbackState.add(playbackState.value.copyWith(
      controls: [MediaControl.skipToPrevious, if (playing) MediaControl.pause else MediaControl.play, MediaControl.skipToNext],
      systemActions: const {MediaAction.seek, MediaAction.seekForward, MediaAction.seekBackward, MediaAction.skipToQueueItem, MediaAction.setShuffleMode, MediaAction.setRepeatMode},
      androidCompactActionIndices: const [0, 1, 2],
      processingState: switch (audio.processingState) {
        ProcessingState.idle => AudioProcessingState.idle,
        ProcessingState.loading => AudioProcessingState.loading,
        ProcessingState.buffering => AudioProcessingState.buffering,
        ProcessingState.ready => AudioProcessingState.ready,
        ProcessingState.completed => AudioProcessingState.completed,
      },
      playing: playing,
      updatePosition: audio.position,
      bufferedPosition: audio.bufferedPosition,
      speed: audio.speed,
      queueIndex: o.queue.isEmpty ? null : o.index,
      shuffleMode: shuffle.value ? AudioServiceShuffleMode.all : AudioServiceShuffleMode.none,
      repeatMode: switch (repeat.value) {
        Repeat.off => AudioServiceRepeatMode.none,
        Repeat.all => AudioServiceRepeatMode.all,
        Repeat.one => AudioServiceRepeatMode.one,
      },
    ));
  }

  // The queue survives closing the app: it comes back paused where it was.
  static const _saveKey = 'eco.queue';
  Timer? _saveTimer;

  Future<void> _save() async {
    _saveTimer?.cancel();
    _saveTimer = Timer(const Duration(milliseconds: 500), () async {
      final o = order.value;
      final prefs = await SharedPreferences.getInstance();
      final start = max(0, o.index - 50); // enough history to go back, not the whole of a long library
      await prefs.setString(_saveKey, jsonEncode({
        'user': api.user,
        'index': o.index - start,
        'queue': o.queue.skip(start).take(500).map((s) => s.toJson()).toList(),
        'position': audio.position.inMilliseconds,
      }));
    });
  }

  Future<void> savePosition() => _save();

  Future<void> _restore() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final j = jsonDecode(prefs.getString(_saveKey) ?? 'null');
      if (j is! Map || j['user'] != api.user || j['queue'] is! List) return;
      final songs = (j['queue'] as List).whereType<Map>().map((m) => Song.fromJson(m.cast<String, dynamic>())).toList();
      if (songs.isEmpty) return;
      final index = ((j['index'] as num?)?.toInt() ?? 0).clamp(0, songs.length - 1);
      _setOrder(q.Order(songs, index), save: false);
      await _load(play: false, position: Duration(milliseconds: (j['position'] as num?)?.toInt() ?? 0));
    } catch (_) {
      // nothing to resume
    }
  }

  /// Signing out: nothing of this account stays playing or queued.
  Future<void> clear() async {
    await audio.stop();
    _setOrder(q.Order.empty, save: false);
    mediaItem.add(null);
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_saveKey);
  }
}

EcoPlayer get player => EcoPlayer.instance;
