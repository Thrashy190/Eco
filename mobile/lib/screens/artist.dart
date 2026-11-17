// An artist: their albums, their songs (on their own albums, then "Appears on" where they are one of several artists),
// and what the catalogue has by them that the library does not. Navidrome's getArtist only lists the albums an artist
// made, so the songs come from Eco (/api/artists/songs). Reached by name, it finds the library's artist, or shows only
// what the catalogue has by them.
import 'dart:async';

import 'package:material_ui/material_ui.dart';

import '../api/client.dart';
import '../api/models.dart';
import '../format.dart';
import '../player/player.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

class _ArtistData {
  final Artist artist;
  final List<Album> albums;
  final List<Song> own;
  final List<Song> elsewhere;
  const _ArtistData(this.artist, this.albums, this.own, this.elsewhere);
}

Future<_ArtistData> _load(String? id, String? name) async {
  var artistId = id;
  if (artistId == null || artistId.isEmpty) artistId = await api.lookupArtist(name!);
  if (artistId.isEmpty) {
    final songs = await api.artistSongs(name!);
    return _ArtistData(Artist(id: '', name: name), const [], const [], songs);
  }
  final detail = await api.getArtist(artistId);
  final songs = await api.artistSongs(detail.artist.name);
  unawaited(api.touchRecent(LibraryEntry(type: 'artist', id: detail.artist.id, name: detail.artist.name, subtitle: 'Artist', cover: detail.artist.cover)));
  // Their own albums' songs in the order of the albums; the rest is where they appear on someone else's.
  final place = {for (var k = 0; k < detail.albums.length; k++) detail.albums[k].id: k};
  return _ArtistData(detail.artist, detail.albums, ownSongs(songs, place), songs.where((s) => s.albumId == null || !place.containsKey(s.albumId)).toList());
}

/// The songs on the artist's own albums, in the order of the albums; each album keeps its order (Dart's sort is not
/// stable, so the position breaks ties).
List<Song> ownSongs(List<Song> songs, Map<String, int> place) {
  final own = [for (var k = 0; k < songs.length; k++) if (songs[k].albumId != null && place.containsKey(songs[k].albumId)) (k, songs[k])];
  own.sort((a, b) {
    final byAlbum = place[a.$2.albumId]!.compareTo(place[b.$2.albumId]!);
    return byAlbum != 0 ? byAlbum : a.$1.compareTo(b.$1);
  });
  return own.map((x) => x.$2).toList();
}

class ArtistScreen extends StatelessWidget {
  final String? id;
  final String? name;
  const ArtistScreen({super.key, this.id, this.name});

  @override
  Widget build(BuildContext context) => Scaffold(
        body: Loader<_ArtistData>(
          cacheKey: 'artist:${id ?? 'name:$name'}',
          load: () => _load(id, name),
          builder: (context, data, reload) {
            final all = [...data.own, ...data.elsewhere];
            return ScrollPage(back: true, onRefresh: reload, children: [
              DetailHeader(
                art: Cover(url: api.coverUrl(data.artist.cover, 600), size: 200, round: true, icon: Icons.person_rounded),
                title: data.artist.name,
                lines: [Text([if (data.albums.isNotEmpty) plural(data.albums.length, 'album'), if (all.isNotEmpty) plural(all.length, 'song') else 'Not in your library yet'].join(' · '))],
              ),
              if (all.isNotEmpty) PlayButtons(songs: all),
              if (data.own.isNotEmpty)
                Section(title: 'Songs', child: SongList(data.own.take(10).toList(), onPlay: (i) => player.playList(all, i))),
              if (data.albums.isNotEmpty) Section(title: 'Albums', child: Shelf(children: [for (final a in data.albums) AlbumCard(a)])),
              if (data.elsewhere.isNotEmpty)
                Section(title: 'Appears on', child: SongList(data.elsewhere, onPlay: (i) => player.playList(all, data.own.length + i))),
              _Discover(name: data.artist.name),
            ]);
          },
        ),
      );
}

/// What the catalogue has by this artist that the library does not. Slow and rate-limited, so it comes on its own.
class _Discover extends StatefulWidget {
  final String name;
  const _Discover({required this.name});

  @override
  State<_Discover> createState() => _DiscoverState();
}

class _DiscoverState extends State<_Discover> {
  ExternalSearch? _found;
  Object? _error;

  @override
  void initState() {
    super.initState();
    api.discover(widget.name).then((r) {
      if (mounted) setState(() => _found = r);
    }, onError: (Object e) {
      if (mounted) setState(() => _error = e);
    });
  }

  @override
  Widget build(BuildContext context) {
    final found = _found;
    if (_error != null) return Note('Could not ask the catalogue: $_error');
    if (found == null) return const Note('Looking in the catalogue…');
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      if (found.albums.isNotEmpty) Section(title: 'More albums', child: Shelf(children: [for (final a in found.albums) ExternalAlbumCard(a)])),
      if (found.external.isNotEmpty) Section(title: 'Not in your library yet', child: Column(children: [for (final e in found.external) ExternalTile(e)])),
      if (found.warning != null) Note(found.warning!),
      if (found.albums.isEmpty && found.external.isEmpty && found.warning == null)
        const Padding(padding: EdgeInsets.fromLTRB(20, 18, 20, 0), child: Text('You have everything the catalogue lists by them.', style: TextStyle(color: Palette.muted))),
    ]);
  }
}
