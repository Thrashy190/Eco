// Talking to Eco: the Subsonic API (through Eco's /rest passthrough) and Eco's own /api. Follows web/src/lib/api.ts.
// The app keeps the server address, user, token and salt, never the password: t = md5(password + salt).
import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:crypto/crypto.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;

import 'models.dart';

class Session {
  final String server; // e.g. https://eco.example.com, no trailing slash
  final String user;
  final String token;
  final String salt;
  const Session(this.server, this.user, this.token, this.salt);

  Map<String, String> toJson() => {'server': server, 'u': user, 't': token, 's': salt};
  static Session? fromJson(Object? j) {
    if (j is! Map) return null;
    final server = j['server'], u = j['u'], t = j['t'], s = j['s'];
    if (server is! String || u is! String || t is! String || s is! String || server.isEmpty || u.isEmpty) return null;
    return Session(server, u, t, s);
  }
}

/// The address someone typed, made into the root of Eco: a scheme added when missing (https unless it is plainly a
/// home address), and any path or `#/route` copied from the browser taken away.
String normalizeServer(String typed) {
  var text = typed.trim();
  if (text.isEmpty) return '';
  if (!RegExp(r'^[a-z][a-z0-9+.-]*://', caseSensitive: false).hasMatch(text)) {
    final host = text.split(RegExp(r'[/:#?]')).first.toLowerCase();
    final local = host == 'localhost' || RegExp(r'^(10|127|192\.168|172\.(1[6-9]|2\d|3[01]))\.').hasMatch(host) || host.endsWith('.local');
    text = '${local ? 'http' : 'https'}://$text';
  }
  final uri = Uri.tryParse(text);
  if (uri == null || uri.host.isEmpty) return '';
  return Uri(scheme: uri.scheme.toLowerCase(), host: uri.host, port: uri.hasPort ? uri.port : null).toString();
}

/// What to say when [server] answers Subsonic but has no Eco API, which is what Navidrome itself does. Eco usually runs
/// next to Navidrome under another name (`music.` for Navidrome, `eco.` for Eco), and typing the one the Subsonic
/// apps use is the likely mistake, so the message names the address to try when it can guess it.
String notEcoMessage(String server) {
  final uri = Uri.tryParse(server);
  final host = uri?.host ?? '';
  if (host.startsWith('music.') && !uri!.hasPort) { // with a port, Eco's is anyone's guess
    final eco = uri.replace(host: 'eco.${host.substring('music.'.length)}').toString();
    return 'That is Navidrome, not Eco. Try $eco';
  }
  return 'That server answers like Navidrome, but it is not Eco. Use the address of Eco instead';
}

/// A request the server answered with an error.
class ApiError implements Exception {
  final String message;
  final int status;
  const ApiError(this.message, [this.status = 0]);
  @override
  String toString() => message;
}

/// `/api/albums/match` could not say in time (503): ask again, it is not "no such album".
class CatalogBusy implements Exception {
  const CatalogBusy();
}

class EcoApi {
  EcoApi._();
  static final instance = EcoApi._();

  static const _storeKey = 'eco.session';
  static const _timeout = Duration(seconds: 25);
  final _storage = const FlutterSecureStorage();
  final http.Client _http = http.Client();

  /// Who is signed in; null shows the sign-in screen.
  final ValueNotifier<Session?> session = ValueNotifier(null);
  Session? _candidate; // the credentials being tried by the sign-in form

  String get user => session.value?.user ?? '';
  String get server => session.value?.server ?? '';

  Future<void> restore() async {
    try {
      final saved = await _storage.read(key: _storeKey);
      if (saved != null) session.value = Session.fromJson(jsonDecode(saved));
    } catch (_) {
      // storage unreadable: sign in again
    }
  }

  Future<void> signIn(String serverText, String user, String password) async {
    final server = normalizeServer(serverText);
    if (server.isEmpty) throw const ApiError('That does not look like an address');
    final random = Random.secure();
    final salt = List.generate(8, (_) => random.nextInt(256).toRadixString(16).padLeft(2, '0')).join();
    final token = md5.convert(utf8.encode(password + salt)).toString();
    _candidate = Session(server, user.trim(), token, salt);
    try {
      await subsonic('ping');
      await eco('me'); // a bare Navidrome answers ping too: make sure this is Eco
      session.value = _candidate;
      await _storage.write(key: _storeKey, value: jsonEncode(_candidate!.toJson()));
    } on ApiError catch (e) {
      if (e.status == 404) throw ApiError(notEcoMessage(server));
      rethrow;
    } finally {
      _candidate = null;
    }
  }

  Future<void> signOut() async {
    session.value = null;
    try {
      await _storage.delete(key: _storeKey);
    } catch (_) {}
  }

  Map<String, List<String>> _params(Map<String, Object?> extra) {
    final current = _candidate ?? session.value;
    final out = <String, List<String>>{
      'u': [current?.user ?? ''], 't': [current?.token ?? ''], 's': [current?.salt ?? ''],
      'v': ['1.16.1'], 'c': ['eco-android'], 'f': ['json'],
    };
    extra.forEach((key, value) {
      if (value == null) return;
      out[key] = value is Iterable ? value.map((v) => '$v').toList() : ['$value'];
    });
    return out;
  }

  Uri _uri(String path, [Map<String, Object?> extra = const {}]) {
    final base = Uri.parse((_candidate ?? session.value)?.server ?? '');
    return base.replace(path: path, queryParameters: _params(extra));
  }

  Uri rest(String endpoint, [Map<String, Object?> extra = const {}]) => _uri('/rest/$endpoint', extra);
  Uri api(String path, [Map<String, Object?> extra = const {}]) => _uri('/api/$path', extra);

  /// The audio as it is: format=raw asks Navidrome not to transcode.
  Uri streamUrl(String id) => rest('stream', {'id': id, 'format': 'raw'});
  Uri mediaFileUrl(String id) => api('media/${Uri.encodeComponent(id)}/file');
  Uri sourceUrl(Song song) => song.mediaId != null ? mediaFileUrl(song.mediaId!) : streamUrl(song.id);

  String? coverUrl(String? id, [int size = 300]) => id == null || id.isEmpty ? null : rest('getCoverArt', {'id': id, 'size': size}).toString();
  String? songCover(Song song, [int size = 300]) =>
      song.mediaId != null ? api('media/${Uri.encodeComponent(song.mediaId!)}/thumb').toString() : coverUrl(song.cover, size);
  String playlistCoverUrl(String id, int version) => api('covers/playlists/${Uri.encodeComponent(id)}', {'cover': version}).toString();

  Future<dynamic> _send(String method, Uri uri, {Object? body}) async {
    http.Response response;
    try {
      final request = http.Request(method, uri);
      if (body != null) {
        request.headers['Content-Type'] = 'application/json';
        request.body = jsonEncode(body);
      }
      response = await http.Response.fromStream(await _http.send(request).timeout(_timeout)).timeout(_timeout);
    } on TimeoutException {
      throw const ApiError('The server took too long to answer');
    } catch (_) {
      throw const ApiError('No connection to the server');
    }
    if (response.statusCode == 401 && _candidate == null) {
      await signOut();
      throw const ApiError('Your session expired', 401);
    }
    dynamic decoded;
    try {
      decoded = jsonDecode(utf8.decode(response.bodyBytes));
    } catch (_) {
      decoded = const <String, dynamic>{}; // a 200 with an unreadable body: callers check the shape
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      if (response.statusCode == 503 && uri.path.endsWith('/albums/match')) throw const CatalogBusy();
      final message = decoded is Map && decoded['error'] is String ? decoded['error'] as String : 'Server error ${response.statusCode}';
      throw ApiError(response.statusCode == 401 ? 'Wrong username or password' : message, response.statusCode);
    }
    return decoded;
  }

  /// Call a Subsonic endpoint and return its response body.
  Future<Map<String, dynamic>> subsonic(String endpoint, [Map<String, Object?> extra = const {}]) async {
    final decoded = await _send('GET', rest(endpoint, extra));
    final body = decoded is Map ? decoded['subsonic-response'] : null;
    if (body is! Map) throw const ApiError('Navidrome sent an answer that could not be read');
    if (body['status'] != 'ok') {
      final error = body['error'] is Map ? body['error'] as Map : const {};
      final code = error['code'];
      if ((code == 40 || code == 41) && _candidate == null) await signOut();
      throw ApiError(error['message'] is String ? error['message'] as String : 'Navidrome returned an error', code is int ? code : 0);
    }
    return body.cast<String, dynamic>();
  }

  /// Call one of Eco's own endpoints.
  Future<dynamic> eco(String path, {Map<String, Object?> extra = const {}, String method = 'GET', Object? body}) =>
      _send(method, api(path, extra), body: body);

  Future<Map<String, dynamic>> _ecoMap(String path, {Map<String, Object?> extra = const {}, String method = 'GET', Object? body}) async {
    final decoded = await eco(path, extra: extra, method: method, body: body);
    if (decoded is! Map) throw const ApiError('The server sent an answer that could not be read');
    return decoded.cast<String, dynamic>();
  }

  // ---- Library (Subsonic) ----
  Future<AlbumDetail> getAlbum(String id) async {
    final a = ((await subsonic('getAlbum', {'id': id}))['album'] as Map).cast<String, dynamic>();
    return AlbumDetail(Album.fromRaw(a), _maps(a['song']).map(Song.fromRaw).toList());
  }

  Future<ArtistDetail> getArtist(String id) async {
    final a = ((await subsonic('getArtist', {'id': id}))['artist'] as Map).cast<String, dynamic>();
    return ArtistDetail(Artist.fromRaw(a), _maps(a['album']).map(Album.fromRaw).toList());
  }

  Future<List<Artist>> getArtists() async {
    final list = (await subsonic('getArtists'))['artists'] as Map? ?? const {};
    return _maps(list['index']).expand((group) => _maps(group['artist'])).map(Artist.fromRaw).toList();
  }

  /// Navidrome hands over 500 albums at most at once, so they are asked for until none are left.
  Future<List<Album>> getAlbums() async {
    const atOnce = 500;
    final albums = <Album>[];
    for (var offset = 0;; offset += atOnce) {
      final list = (await subsonic('getAlbumList2', {'type': 'alphabeticalByName', 'size': atOnce, 'offset': offset}))['albumList2'] as Map? ?? const {};
      final page = _maps(list['album']);
      albums.addAll(page.map(Album.fromRaw));
      if (page.length < atOnce) return albums;
    }
  }

  Future<List<Playlist>> getPlaylists() async {
    final list = (await subsonic('getPlaylists'))['playlists'] as Map? ?? const {};
    return _maps(list['playlist']).map(Playlist.fromRaw).toList();
  }

  Future<PlaylistDetail> getPlaylist(String id) async {
    final p = ((await subsonic('getPlaylist', {'id': id}))['playlist'] as Map).cast<String, dynamic>();
    return PlaylistDetail(Playlist.fromRaw(p), _maps(p['entry']).map(Song.fromRaw).toList());
  }

  /// Favourite songs, the most recently favourited first.
  Future<List<Song>> getStarred() async {
    final list = (await subsonic('getStarred2'))['starred2'] as Map? ?? const {};
    final songs = _maps(list['song']).map(Song.fromRaw).toList();
    songs.sort((a, b) => (b.starred ?? '').compareTo(a.starred ?? ''));
    return songs;
  }

  Future<List<Song>> getRandomSongs(int size) async {
    final list = (await subsonic('getRandomSongs', {'size': size}))['randomSongs'] as Map? ?? const {};
    return _maps(list['song']).map(Song.fromRaw).toList();
  }

  Future<void> star(String id) => subsonic('star', {'id': id});
  Future<void> unstar(String id) => subsonic('unstar', {'id': id});

  /// Tell Navidrome a song was played, which feeds "recently played" and "most played".
  Future<void> scrobble(String id) => subsonic('scrobble', {'id': id, 'submission': 'true'}).then((_) {}, onError: (_) {});

  /// Every ID travels in the address, and addresses have a limit, so long lists go a part at a time.
  Future<void> addToPlaylist(String id, List<String> songIds) async {
    for (var i = 0; i < songIds.length; i += 150) {
      await subsonic('updatePlaylist', {'playlistId': id, 'songIdToAdd': songIds.sublist(i, min(i + 150, songIds.length))});
    }
  }

  Future<String> createPlaylist(String name, [List<String> songIds = const []]) async {
    final id = '${((await subsonic('createPlaylist', {'name': name}))['playlist'] as Map)['id']}';
    await addToPlaylist(id, songIds);
    return id;
  }

  // ---- Eco ----
  Future<Me> me() async => Me.fromJson(await _ecoMap('me'));
  Future<HomeData> home() async => HomeData.fromJson(await _ecoMap('home'));
  Future<LibrarySearch> search(String q) async => LibrarySearch.fromJson(await _ecoMap('search', extra: {'q': q}));
  Future<ExternalSearch> searchExternal(String q) async => ExternalSearch.fromJson(await _ecoMap('search/external', extra: {'q': q}));
  Future<ExternalSearch> discover(String artist) async => ExternalSearch.fromJson(await _ecoMap('discover', extra: {'artist': artist}));

  Future<String> lookupArtist(String name) async => '${(await _ecoMap('artists/lookup', extra: {'name': name}))['id'] ?? ''}';

  /// Every song in the library that names this artist, featured or not, in album order.
  Future<List<Song>> artistSongs(String name) async => _maps((await _ecoMap('artists/songs', extra: {'name': name}))['songs']).map(Song.fromRaw).toList();

  Future<CatalogAlbumPage> catalogAlbum(String id) async => CatalogAlbumPage.fromJson(await _ecoMap('catalog/albums/${Uri.encodeComponent(id)}'));

  /// The whole of a library album according to the catalogue. Null when it has none; [CatalogBusy] when it could not say.
  Future<CatalogAlbumPage?> matchAlbum(String name, String artist) async {
    final page = await _ecoMap('albums/match', extra: {'name': name, 'artist': artist});
    return page['album'] is Map ? CatalogAlbumPage.fromJson(page) : null;
  }

  Future<Job> requestDownload(String catalogId) async => Job.fromJson(await _ecoMap('download', extra: {'id': catalogId}, method: 'POST'));

  Future<List<Job>> jobs() async {
    final list = await eco('jobs');
    return list is List ? list.whereType<Map>().map((m) => Job.fromJson(m.cast<String, dynamic>())).toList() : const [];
  }

  Future<LibraryState?> library() async => LibraryState.tryParse(await eco('me/library'));
  Future<void> touchRecent(LibraryEntry entry) => eco('me/recents', method: 'POST', body: entry.toJson()).then((_) {}, onError: (_) {});

  static List<Map<String, dynamic>> _maps(Object? v) => v is List ? v.whereType<Map>().map((m) => m.cast<String, dynamic>()).toList() : const [];
}

final api = EcoApi.instance;
