// Songs kept on the phone, to play with no connection. The rules are the web app's (stores/offline.ts, saving.ts):
// a collection (favorites, a playlist, an album) remembers its songs, a song can be held by several collections and by
// an individual save, and its file goes only when nothing holds it. Unlike the web app, downloads run in Android's
// download service (background_downloader), so they carry on with the app in the background or closed.
import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:background_downloader/background_downloader.dart';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:path_provider/path_provider.dart';

import '../api/client.dart';
import '../api/models.dart';

const _group = 'eco-offline';

class Collection {
  final String id; // favorites, playlist:<id>, album:<id>
  final String kind; // favorites, playlist, album
  final String title;
  final String subtitle;
  final List<Song> songs; // in order, saved or not yet
  final bool paused; // stopped: what arrived stays, nothing more is fetched until asked
  const Collection(this.id, this.kind, this.title, this.subtitle, this.songs, {this.paused = false});

  Collection copyWith({List<Song>? songs, bool? paused}) => Collection(id, kind, title, subtitle, songs ?? this.songs, paused: paused ?? this.paused);

  Map<String, dynamic> toJson() => {'id': id, 'kind': kind, 'title': title, 'subtitle': subtitle, 'songs': songs.map((s) => s.toJson()).toList(), 'paused': paused};
  static Collection? fromJson(Object? j) {
    if (j is! Map || j['id'] is! String || j['songs'] is! List) return null;
    return Collection('${j['id']}', '${j['kind'] ?? 'playlist'}', '${j['title'] ?? ''}', '${j['subtitle'] ?? ''}',
        (j['songs'] as List).whereType<Map>().map((m) => Song.fromJson(m.cast<String, dynamic>())).toList(),
        paused: j['paused'] == true);
  }
}

class SavedSong {
  final Song song;
  final int size;
  const SavedSong(this.song, this.size);
  Map<String, dynamic> toJson() => {'song': song.toJson(), 'size': size};
}

enum SaveState { none, waiting, downloading, saved, failed }

class Offline extends ChangeNotifier {
  Offline._();
  static final instance = Offline._();

  final Map<String, SavedSong> _songs = {};
  final Map<String, Collection> _collections = {};
  final Set<String> _direct = {};
  final Map<String, double> _progress = {}; // song ID → 0..1 while downloading; -1 while waiting
  final Set<String> _failed = {};
  late final String _root; // the folder of saved files
  bool _ready = false;

  // ---- What screens read ----
  bool isSaved(String id) => _songs.containsKey(id);
  String? filePath(String id) => _ready && _songs.containsKey(id) ? '$_root/${_file(id)}' : null;
  String? coverPath(Song song) {
    if (!_ready || song.cover == null) return null;
    final f = File('$_root/covers/${_safe(song.cover!)}.jpg');
    return f.existsSync() ? f.path : null;
  }

  SaveState state(String id) {
    if (_songs.containsKey(id)) return SaveState.saved;
    final p = _progress[id];
    if (p != null) return p < 0 ? SaveState.waiting : SaveState.downloading;
    return _failed.contains(id) ? SaveState.failed : SaveState.none;
  }

  double progress(String id) => (_progress[id] ?? 0).clamp(0, 1).toDouble();
  bool isDirect(String id) => _direct.contains(id);
  Collection? collection(String id) => _collections[id];
  List<Collection> get collections => _collections.values.where((c) => c.songs.any((s) => isSaved(s.id))).toList();

  /// The songs of a collection that are on the phone, in its order.
  List<Song> collectionSongs(String id) => [for (final s in _collections[id]?.songs ?? const <Song>[]) if (_songs.containsKey(s.id)) _songs[s.id]!.song];

  /// Songs saved one by one.
  List<Song> get directSongs => [for (final id in _direct) if (_songs.containsKey(id)) _songs[id]!.song];
  List<Song> get allSongs => _songs.values.map((s) => s.song).toList();
  int get bytes => _songs.values.fold(0, (sum, s) => sum + s.size);

  /// How much of a collection is here: (saved, total, busy).
  (int, int, bool) collectionCount(String id) {
    final c = _collections[id];
    if (c == null) return (0, 0, false);
    final saved = c.songs.where((s) => isSaved(s.id)).length;
    final busy = c.songs.any((s) => _progress.containsKey(s.id));
    return (saved, c.songs.length, busy);
  }

  // ---- Starting ----
  Future<void> init() async {
    final base = await getApplicationSupportDirectory();
    _root = '${base.path}/offline';
    await Directory('$_root/covers').create(recursive: true);
    await _load();
    _ready = true;
    final downloader = FileDownloader();
    downloader.configureNotification(
      running: const TaskNotification('Saving to this phone', '{displayName}'),
      error: const TaskNotification('Could not save a song', '{displayName}'),
      progressBar: true,
    );
    downloader.updates.listen(_onUpdate);
    await downloader.start(autoCleanDatabase: true);
    for (final record in await downloader.database.allRecords(group: _group)) {
      if (record.status == TaskStatus.enqueued || record.status == TaskStatus.running || record.status == TaskStatus.waitingToRetry) {
        final id = record.task.metaData.isEmpty ? null : Song.fromJson(jsonDecode(record.task.metaData)).id;
        if (id != null && !_songs.containsKey(id)) _progress[id] = record.progress > 0 ? record.progress : -1;
      }
    }
    notifyListeners();
    unawaited(resume());
  }

  /// Fetch what collections and single saves still lack (on launch, and when the connection comes back).
  Future<void> resume() async {
    if (!_ready || api.session.value == null) return;
    for (final c in _collections.values) {
      if (c.paused) continue;
      for (final s in c.songs) {
        await _enqueue(s);
      }
    }
  }

  // ---- Saving and removing ----
  Future<void> saveSong(Song song) async {
    _direct.add(song.id);
    _failed.remove(song.id);
    await _persist();
    await _askNotifications();
    await _enqueue(song);
    notifyListeners();
  }

  Future<void> removeSong(String id) async {
    _direct.remove(id);
    await _prune();
  }

  /// Keep a whole collection; with [songs] it also follows what it holds now (new songs come, removed ones go).
  Future<void> saveCollection(String id, String kind, String title, String subtitle, List<Song> songs) async {
    _collections[id] = Collection(id, kind, title, subtitle, songs.map((s) => s.withOrigin(SongKind.list)).toList());
    for (final s in songs) {
      _failed.remove(s.id);
    }
    await _persist();
    await _askNotifications();
    for (final s in songs) {
      await _enqueue(s);
    }
    await _prune();
  }

  /// A kept collection follows its songs: called when its page loads with a connection.
  Future<void> updateCollection(String id, List<Song> songs) async {
    final c = _collections[id];
    if (c == null) return;
    final before = c.songs.map((s) => s.id).join(',');
    if (before == songs.map((s) => s.id).join(',')) return;
    _collections[id] = c.copyWith(songs: songs.map((s) => s.withOrigin(SongKind.list)).toList());
    await _persist();
    if (!c.paused) {
      for (final s in songs) {
        await _enqueue(s);
      }
    }
    await _prune();
  }

  /// Stop: what arrived stays, and nothing more is fetched until asked. With nothing saved the collection goes.
  Future<void> pauseCollection(String id) async {
    final c = _collections[id];
    if (c == null) return;
    _collections[id] = c.copyWith(paused: true);
    await _persist();
    await _prune();
  }

  Future<void> resumeCollection(String id) async {
    final c = _collections[id];
    if (c == null) return;
    _collections[id] = c.copyWith(paused: false);
    for (final s in c.songs) {
      _failed.remove(s.id);
    }
    await _persist();
    for (final s in c.songs) {
      await _enqueue(s);
    }
    notifyListeners();
  }

  Future<void> removeCollection(String id) async {
    _collections.remove(id);
    await _prune();
  }

  Future<void> removeEverything() async {
    _collections.clear();
    _direct.clear();
    await _prune();
  }

  // ---- Inside ----
  static String _safe(String id) => id.replaceAll(RegExp(r'[^A-Za-z0-9_-]'), '_');
  static String _file(String id) => '${_safe(id)}.audio';
  static String _taskId(String id) => 'song-${_safe(id)}';

  /// Is a song wanted on the phone: by a single save, or a collection that is not stopped?
  bool _wanted(String id) => _direct.contains(id) || _collections.values.any((c) => !c.paused && c.songs.any((s) => s.id == id));

  /// Is a song held: wanted, or already saved for a stopped collection?
  bool _held(String id) => _direct.contains(id) || _collections.values.any((c) => c.songs.any((s) => s.id == id));

  Future<void> _enqueue(Song song) async {
    if (_songs.containsKey(song.id) || _progress.containsKey(song.id) || _failed.contains(song.id)) return;
    if (song.mediaId != null) return; // podcasts and audiobooks stay on the server for now
    _progress[song.id] = -1;
    notifyListeners();
    final task = DownloadTask(
      taskId: _taskId(song.id),
      url: api.streamUrl(song.id).toString(),
      filename: _file(song.id),
      directory: 'offline',
      baseDirectory: BaseDirectory.applicationSupport,
      group: _group,
      updates: Updates.statusAndProgress,
      retries: 3,
      allowPause: true,
      displayName: '${song.title} · ${song.artist}',
      metaData: jsonEncode(song.withOrigin(SongKind.list).toJson()),
    );
    if (!await FileDownloader().enqueue(task)) {
      _progress.remove(song.id);
      _failed.add(song.id);
      notifyListeners();
    }
  }

  Future<void> _onUpdate(TaskUpdate update) async {
    if (update.task.group != _group || update.task.metaData.isEmpty) return;
    final Song song;
    try {
      song = Song.fromJson(jsonDecode(update.task.metaData));
    } catch (_) {
      return;
    }
    if (update is TaskProgressUpdate) {
      if (update.progress >= 0 && !_songs.containsKey(song.id)) {
        _progress[song.id] = update.progress;
        notifyListeners();
      }
      return;
    }
    if (update is! TaskStatusUpdate) return;
    switch (update.status) {
      case TaskStatus.complete:
        await _arrived(song);
      case TaskStatus.failed || TaskStatus.notFound:
        _progress.remove(song.id);
        _failed.add(song.id);
        notifyListeners();
      case TaskStatus.canceled:
        _progress.remove(song.id);
        notifyListeners();
      default:
        break;
    }
  }

  /// A download finished. Navidrome reports a missing song as HTTP 200 with a JSON error, so look before keeping it.
  Future<void> _arrived(Song song) async {
    _progress.remove(song.id);
    final file = File('$_root/${_file(song.id)}');
    if (!await file.exists()) return notifyListeners();
    final size = await file.length();
    if (size < 8192) {
      final text = await file.readAsString().catchError((_) => '');
      if (text.contains('subsonic-response')) {
        await file.delete().catchError((_) => file);
        if (text.contains('"code":70')) {
          // the library no longer has it: it leaves the collections
          _direct.remove(song.id);
          for (final c in _collections.values.toList()) {
            _collections[c.id] = c.copyWith(songs: c.songs.where((s) => s.id != song.id).toList());
          }
          await _persist();
        } else {
          _failed.add(song.id);
        }
        return notifyListeners();
      }
    }
    if (!_held(song.id)) {
      await file.delete().catchError((_) => file);
      return notifyListeners();
    }
    _songs[song.id] = SavedSong(song, size);
    await _persist();
    notifyListeners();
    unawaited(_saveCover(song));
  }

  Future<void> _saveCover(Song song) async {
    final url = api.coverUrl(song.cover, 600);
    if (url == null) return;
    final target = File('$_root/covers/${_safe(song.cover!)}.jpg');
    if (await target.exists()) return;
    try {
      final response = await http.get(Uri.parse(url)).timeout(const Duration(seconds: 30));
      final type = response.headers['content-type'] ?? '';
      if (response.statusCode == 200 && type.startsWith('image/')) await target.writeAsBytes(response.bodyBytes, flush: true);
    } catch (_) {
      // the cover comes from the server while online anyway
    }
  }

  /// Let go of what nothing holds: delete files, cancel downloads nobody wants, drop collections with nothing left.
  Future<void> _prune() async {
    for (final c in _collections.values.toList()) {
      if (c.paused && !c.songs.any((s) => _songs.containsKey(s.id))) _collections.remove(c.id);
    }
    final cancel = <String>[];
    for (final id in _progress.keys.toList()) {
      if (!_wanted(id)) {
        cancel.add(_taskId(id));
        _progress.remove(id);
      }
    }
    if (cancel.isNotEmpty) await FileDownloader().cancelTasksWithIds(cancel);
    for (final id in _songs.keys.toList()) {
      if (_held(id)) continue;
      _songs.remove(id);
      final file = File('$_root/${_file(id)}');
      if (await file.exists()) await file.delete().catchError((_) => file);
    }
    final covers = {for (final s in _songs.values) if (s.song.cover != null) '${_safe(s.song.cover!)}.jpg'};
    final dir = Directory('$_root/covers');
    if (await dir.exists()) {
      await for (final f in dir.list()) {
        if (f is File && !covers.contains(f.uri.pathSegments.last)) await f.delete().catchError((_) => f);
      }
    }
    await _persist();
    notifyListeners();
  }

  File get _index => File('$_root/index.json');

  Future<void> _load() async {
    try {
      final j = jsonDecode(await _index.readAsString());
      if (j is! Map) return;
      for (final s in (j['songs'] as List? ?? const [])) {
        if (s is Map && s['song'] is Map) {
          final song = Song.fromJson((s['song'] as Map).cast<String, dynamic>());
          if (File('$_root/${_file(song.id)}').existsSync()) _songs[song.id] = SavedSong(song, (s['size'] as num?)?.toInt() ?? 0);
        }
      }
      for (final c in (j['collections'] as List? ?? const [])) {
        final record = Collection.fromJson(c);
        if (record != null) _collections[record.id] = record;
      }
      _direct.addAll((j['direct'] as List? ?? const []).map((e) => '$e'));
    } catch (_) {
      // first launch, or an index that cannot be read: start empty, files are found again as they are saved
    }
  }

  Future<void> _persist() async {
    final data = jsonEncode({
      'songs': _songs.values.map((s) => s.toJson()).toList(),
      'collections': _collections.values.map((c) => c.toJson()).toList(),
      'direct': _direct.toList(),
    });
    final tmp = File('${_index.path}.tmp');
    await tmp.writeAsString(data, flush: true);
    await tmp.rename(_index.path); // whole or not at all
  }

  bool _asked = false;
  Future<void> _askNotifications() async {
    if (_asked) return;
    _asked = true;
    try {
      final permissions = FileDownloader().permissions;
      if (await permissions.status(PermissionType.notifications) != PermissionStatus.granted) {
        await permissions.request(PermissionType.notifications);
      }
    } catch (_) {
      // downloads work without the notification
    }
  }
}

final offline = Offline.instance;

/// Run [f] and keep its errors out of the way (for fire-and-forget calls from screens).
void quietly(Future<void> Function() f) => unawaited(f().catchError((Object e) => debugPrint('$e')));
