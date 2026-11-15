// The shapes the app works with, read from what Navidrome (Subsonic) and Eco's /api send. They follow
// web/src/lib/types.ts; `fromRaw` accepts both Subsonic's camelCase and Eco's snake_case names.
import '../format.dart';

String? _str(Object? v) => v == null ? null : '$v';
int? _int(Object? v) => v is num ? v.toInt() : (v is String ? int.tryParse(v) : null);
List<Map<String, dynamic>> _list(Object? v) => v is List ? v.whereType<Map>().map((m) => m.cast<String, dynamic>()).toList() : const [];

/// Where a song in the queue comes from: added by hand, the album or playlist playing, or Autoplay.
enum SongKind { queued, list, auto }

class Song {
  final String id;
  final String title;
  final String artist;
  final String? artistId;
  final String? album;
  final String? albumId;
  final int? duration;
  final String? cover;
  final String? starred;

  /// Set on imported audio (podcasts, audiobooks…), which Eco serves itself instead of Navidrome.
  final String? mediaId;
  final String? kind;

  /// Only in the queue: added by hand ("Play next", "Add to queue").
  final bool queued;

  /// Only in the queue: picked by Autoplay when the queue ran out.
  final bool auto;

  const Song({
    required this.id,
    required this.title,
    required this.artist,
    this.artistId,
    this.album,
    this.albumId,
    this.duration,
    this.cover,
    this.starred,
    this.mediaId,
    this.kind,
    this.queued = false,
    this.auto = false,
  });

  factory Song.fromRaw(Map<String, dynamic> s) => Song(
        id: '${s['id']}',
        title: _str(s['title']) ?? '',
        artist: readableArtists(_str(s['artist'])),
        artistId: _str(s['artistId'] ?? s['artist_id']),
        album: _str(s['album']),
        albumId: _str(s['albumId'] ?? s['album_id']),
        duration: _int(s['duration']),
        cover: _str(s['coverArt'] ?? s['cover']),
        starred: _str(s['starred']),
      );

  SongKind get origin => queued ? SongKind.queued : (auto ? SongKind.auto : SongKind.list);

  Song withOrigin(SongKind kind) {
    if (origin == kind) return this;
    return Song(
      id: id, title: title, artist: artist, artistId: artistId, album: album, albumId: albumId, duration: duration,
      cover: cover, starred: starred, mediaId: mediaId, kind: this.kind,
      queued: kind == SongKind.queued, auto: kind == SongKind.auto,
    );
  }

  Song withStarred(bool on) => Song(
        id: id, title: title, artist: artist, artistId: artistId, album: album, albumId: albumId, duration: duration,
        cover: cover, starred: on ? DateTime.now().toUtc().toIso8601String() : null, mediaId: mediaId, kind: kind,
        queued: queued, auto: auto,
      );

  bool get isStarred => (starred ?? '').isNotEmpty;

  Map<String, dynamic> toJson() => {
        'id': id, 'title': title, 'artist': artist,
        if (artistId != null) 'artistId': artistId,
        if (album != null) 'album': album,
        if (albumId != null) 'albumId': albumId,
        if (duration != null) 'duration': duration,
        if (cover != null) 'cover': cover,
        if (starred != null) 'starred': starred,
        if (mediaId != null) 'mediaId': mediaId,
        if (kind != null) 'kind': kind,
        if (queued) 'queued': true,
        if (auto) 'auto': true,
      };

  /// Read back what [toJson] wrote. Names are already readable, so they are not changed again.
  factory Song.fromJson(Map<String, dynamic> j) => Song(
        id: '${j['id']}', title: _str(j['title']) ?? '', artist: _str(j['artist']) ?? '',
        artistId: _str(j['artistId']), album: _str(j['album']), albumId: _str(j['albumId']),
        duration: _int(j['duration']), cover: _str(j['cover']), starred: _str(j['starred']),
        mediaId: _str(j['mediaId']), kind: _str(j['kind']),
        queued: j['queued'] == true, auto: j['auto'] == true,
      );
}

class Album {
  final String id;
  final String name;
  final String artist;
  final String? artistId;
  final String? cover;
  final int? songCount;
  final int? year;

  const Album({required this.id, required this.name, required this.artist, this.artistId, this.cover, this.songCount, this.year});

  factory Album.fromRaw(Map<String, dynamic> a) => Album(
        id: '${a['id']}',
        name: _str(a['name']) ?? '',
        artist: readableArtists(_str(a['artist'])),
        artistId: _str(a['artistId'] ?? a['artist_id']),
        cover: _str(a['coverArt'] ?? a['cover']),
        songCount: _int(a['songCount'] ?? a['song_count']),
        year: _int(a['year']),
      );
}

class AlbumDetail {
  final Album album;
  final List<Song> songs;
  const AlbumDetail(this.album, this.songs);
}

class Artist {
  final String id;
  final String name;
  final String? cover;
  final int? albumCount;
  const Artist({required this.id, required this.name, this.cover, this.albumCount});

  factory Artist.fromRaw(Map<String, dynamic> a) => Artist(
        id: '${a['id']}', name: _str(a['name']) ?? '', cover: _str(a['coverArt'] ?? a['cover']),
        albumCount: _int(a['albumCount'] ?? a['album_count']),
      );
}

class ArtistDetail {
  final Artist artist;
  final List<Album> albums;
  const ArtistDetail(this.artist, this.albums);
}

class Playlist {
  final String id;
  final String name;
  final String? owner;
  final int songCount;
  final String? cover;
  final bool readonly;
  const Playlist({required this.id, required this.name, this.owner, this.songCount = 0, this.cover, this.readonly = false});

  factory Playlist.fromRaw(Map<String, dynamic> p) => Playlist(
        id: '${p['id']}', name: _str(p['name']) ?? '', owner: _str(p['owner']), songCount: _int(p['songCount']) ?? 0,
        cover: _str(p['coverArt']), readonly: p['readonly'] == true,
      );
}

class PlaylistDetail {
  final Playlist playlist;
  final List<Song> songs;
  const PlaylistDetail(this.playlist, this.songs);
}

/// A song in the catalogue that is not in the library yet.
class ExternalSong {
  final String id;
  final String title;
  final String artist;
  final String album;
  final int duration;
  final String? coverUrl;
  const ExternalSong({required this.id, required this.title, required this.artist, required this.album, required this.duration, this.coverUrl});

  factory ExternalSong.fromJson(Map<String, dynamic> j) => ExternalSong(
        id: '${j['id']}', title: _str(j['title']) ?? '', artist: _str(j['artist']) ?? '', album: _str(j['album']) ?? '',
        duration: _int(j['duration']) ?? 0, coverUrl: _str(j['cover_url']),
      );
}

/// An album in the catalogue.
class ExternalAlbum {
  final String id;
  final String name;
  final String artist;
  final String? albumType;
  final int? year;
  final int totalTracks;
  final String? coverUrl;
  const ExternalAlbum({required this.id, required this.name, required this.artist, this.albumType, this.year, this.totalTracks = 0, this.coverUrl});

  factory ExternalAlbum.fromJson(Map<String, dynamic> j) => ExternalAlbum(
        id: '${j['id']}', name: _str(j['name']) ?? '', artist: _str(j['artist']) ?? '', albumType: _str(j['album_type']),
        year: _int(j['year']), totalTracks: _int(j['total_tracks']) ?? 0, coverUrl: _str(j['cover_url']),
      );
}

class AlbumTrack {
  final String id;
  final String title;
  final String artist;
  final int disc;
  final int track;
  final int duration;

  /// The song in the library, when it is downloaded.
  final Song? library;
  const AlbumTrack({required this.id, required this.title, required this.artist, this.disc = 1, this.track = 0, this.duration = 0, this.library});

  factory AlbumTrack.fromJson(Map<String, dynamic> j) => AlbumTrack(
        id: '${j['id']}', title: _str(j['title']) ?? '', artist: _str(j['artist']) ?? '', disc: _int(j['disc']) ?? 1,
        track: _int(j['track']) ?? 0, duration: _int(j['duration']) ?? 0,
        library: j['library'] is Map ? Song.fromRaw((j['library'] as Map).cast<String, dynamic>()) : null,
      );
}

class CatalogAlbumPage {
  final ExternalAlbum album;
  final List<AlbumTrack> tracks;
  const CatalogAlbumPage(this.album, this.tracks);

  factory CatalogAlbumPage.fromJson(Map<String, dynamic> j) => CatalogAlbumPage(
        ExternalAlbum.fromJson((j['album'] as Map).cast<String, dynamic>()),
        _list(j['tracks']).map(AlbumTrack.fromJson).toList(),
      );
}

class LibrarySearch {
  final List<Song> songs;
  final List<Artist> artists;
  final List<Album> albums;
  const LibrarySearch(this.songs, this.artists, this.albums);

  factory LibrarySearch.fromJson(Map<String, dynamic> j) => LibrarySearch(
        _list(j['songs']).map(Song.fromRaw).toList(),
        _list(j['artists']).map(Artist.fromRaw).toList(),
        _list(j['albums']).map(Album.fromRaw).toList(),
      );
}

class ExternalSearch {
  final List<ExternalSong> external;
  final List<ExternalAlbum> albums;

  /// Library albums the catalogue also returned: its page says more, so the library's is not listed too.
  final Set<String> hideAlbums;
  final String? warning;
  const ExternalSearch(this.external, this.albums, this.hideAlbums, this.warning);

  factory ExternalSearch.fromJson(Map<String, dynamic> j) => ExternalSearch(
        _list(j['external']).map(ExternalSong.fromJson).toList(),
        _list(j['external_albums'] ?? j['albums']).map(ExternalAlbum.fromJson).toList(),
        {for (final id in (j['hide_albums'] as List? ?? const [])) '$id'},
        _str(j['warning']),
      );
}

enum JobState { queued, searching, downloading, tagging, ready, error }

class Job {
  final String id;

  /// What was asked for: a catalogue ID, `media:<video>`, `link:<video>` or `import:<hash>`.
  final String key;
  final JobState state;
  final double progress;
  final String title;
  final String artist;
  final String album;
  final String? libraryId;
  final String? error;
  final int? finishedAt;
  const Job({required this.id, required this.key, required this.state, this.progress = 0, this.title = '', this.artist = '', this.album = '', this.libraryId, this.error, this.finishedAt});

  bool get active => state != JobState.ready && state != JobState.error;

  factory Job.fromJson(Map<String, dynamic> j) => Job(
        id: '${j['id']}', key: '${j['key']}',
        state: JobState.values.firstWhere((s) => s.name == j['state'], orElse: () => JobState.queued),
        progress: (j['progress'] as num?)?.toDouble() ?? 0, title: _str(j['title']) ?? '', artist: _str(j['artist']) ?? '',
        album: _str(j['album']) ?? '', libraryId: _str(j['library_id']), error: _str(j['error']), finishedAt: _int(j['finished_at']),
      );
}

class HomeData {
  final List<Album> newest;
  final List<Album> recent;
  final List<Album> frequent;
  final List<Song> randomSongs;
  final List<Job> downloads;
  const HomeData(this.newest, this.recent, this.frequent, this.randomSongs, this.downloads);

  factory HomeData.fromJson(Map<String, dynamic> j) => HomeData(
        _list(j['newest']).map(Album.fromRaw).toList(),
        _list(j['recent']).map(Album.fromRaw).toList(),
        _list(j['frequent']).map(Album.fromRaw).toList(),
        _list(j['random_songs']).map(Song.fromRaw).toList(),
        _list(j['downloads']).map(Job.fromJson).toList(),
      );

  bool get isEmpty => newest.isEmpty && recent.isEmpty && frequent.isEmpty && randomSongs.isEmpty && downloads.isEmpty;
}

/// One row of the library's Recent view: favorites, pins and what was opened lately. Kept on the server per user.
class LibraryEntry {
  final String type; // playlist, album, artist, song, catalog_album, spotify_album
  final String id;
  final String name;
  final String? subtitle;
  final String? cover;
  final String? coverUrl;
  final String? artist;
  final String? artistId;
  final String? album;
  final String? albumId;
  final int? duration;
  const LibraryEntry({required this.type, required this.id, required this.name, this.subtitle, this.cover, this.coverUrl, this.artist, this.artistId, this.album, this.albumId, this.duration});

  factory LibraryEntry.fromJson(Map<String, dynamic> j) => LibraryEntry(
        type: '${j['type']}', id: '${j['id']}', name: _str(j['name']) ?? '', subtitle: _str(j['subtitle']), cover: _str(j['cover']),
        coverUrl: _str(j['cover_url']), artist: _str(j['artist']), artistId: _str(j['artist_id']), album: _str(j['album']),
        albumId: _str(j['album_id']), duration: _int(j['duration']),
      );

  Map<String, dynamic> toJson() => {
        'type': type, 'id': id, 'name': name,
        if (subtitle != null) 'subtitle': subtitle,
        if (cover != null) 'cover': cover,
        if (coverUrl != null) 'cover_url': coverUrl,
        if (artist != null) 'artist': artist,
        if (artistId != null) 'artist_id': artistId,
        if (album != null) 'album': album,
        if (albumId != null) 'album_id': albumId,
        if (duration != null) 'duration': duration,
      };
}

class LibraryState {
  final List<LibraryEntry> recents;
  final List<LibraryEntry> pins;
  final Map<String, int> covers;
  const LibraryState(this.recents, this.pins, this.covers);

  /// An answer cut short arrives as {}: only a whole answer counts (see isLibraryState in the web app).
  static LibraryState? tryParse(Object? value) {
    if (value is! Map || value['recents'] is! List || value['pins'] is! List || value['covers'] is! Map) return null;
    final j = value.cast<String, dynamic>();
    return LibraryState(
      _list(j['recents']).map(LibraryEntry.fromJson).toList(),
      _list(j['pins']).map(LibraryEntry.fromJson).toList(),
      {for (final e in (j['covers'] as Map).entries) '${e.key}': _int(e.value) ?? 0},
    );
  }
}

class Me {
  final String user;
  final bool admin;
  final String catalog;
  final String version;
  const Me(this.user, this.admin, this.catalog, this.version);

  factory Me.fromJson(Map<String, dynamic> j) => Me(_str(j['user']) ?? '', j['admin'] == true, _str(j['catalog']) ?? '', _str(j['version']) ?? '');
}
