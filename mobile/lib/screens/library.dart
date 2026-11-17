// The library: Recent (Favorites, what you pinned, what you opened lately, kept on the server so every device agrees),
// playlists, albums, artists, and what is on this phone.
import 'package:material_ui/material_ui.dart';

import '../api/client.dart';
import '../api/models.dart';
import '../format.dart';
import '../offline/offline.dart';
import '../player/player.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

enum _Tab { recent, playlists, albums, artists, phone }

const _labels = {_Tab.recent: 'Recent', _Tab.playlists: 'Playlists', _Tab.albums: 'Albums', _Tab.artists: 'Artists', _Tab.phone: 'On this phone'};

/// Where a saved collection's page is. Never read a route out of a saved record: work it out from its ID.
String collectionRoute(Collection c) {
  if (c.id == 'favorites') return 'playlist/favorites';
  final colon = c.id.indexOf(':');
  final kind = colon < 0 ? c.kind : c.id.substring(0, colon);
  final id = Uri.encodeComponent(colon < 0 ? c.id : c.id.substring(colon + 1));
  return kind == 'album' ? 'album/$id' : 'playlist/$id';
}

/// A saved collection's picture: Favorites' heart, or its first saved song's cover.
Widget collectionArt(Collection c, double size) {
  if (c.id == 'favorites') return FavoritesArt(size: size, radius: size / 8);
  final songs = offline.collectionSongs(c.id);
  return songs.isEmpty ? Cover(size: size, radius: size / 8, icon: Icons.queue_music_rounded) : SongCover(songs.first, size: size, radius: size / 8);
}

class LibraryScreen extends StatefulWidget {
  const LibraryScreen({super.key});

  @override
  State<LibraryScreen> createState() => _LibraryScreenState();
}

class _LibraryScreenState extends State<LibraryScreen> {
  _Tab _tab = _Tab.recent;

  @override
  Widget build(BuildContext context) {
    final top = MediaQuery.of(context).padding.top;
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      SizedBox(height: top + 8),
      const TabTitle('Library'),
      SizedBox(
        height: 52,
        child: ListView(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
          children: [
            for (final t in _Tab.values)
              Padding(
                padding: const EdgeInsets.only(right: 8),
                child: ChoiceChip(label: Text(_labels[t]!), selected: _tab == t, showCheckmark: false, onSelected: (_) => setState(() => _tab = t)),
              ),
          ],
        ),
      ),
      Expanded(child: switch (_tab) {
        _Tab.recent => const _Recent(),
        _Tab.playlists => const _Playlists(),
        _Tab.albums => const _Albums(),
        _Tab.artists => const _Artists(),
        _Tab.phone => const _OnPhone(),
      }),
    ]);
  }
}

Widget _row({required Widget art, required String title, String subtitle = '', required VoidCallback onTap, Widget? trailing}) => ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 2),
      leading: art,
      title: Text(title, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w600)),
      subtitle: subtitle.isEmpty ? null : Text(subtitle, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(color: Palette.muted)),
      trailing: trailing,
      onTap: onTap,
    );

class _Recent extends StatelessWidget {
  const _Recent();

  void _openEntry(BuildContext context, LibraryEntry e) {
    switch (e.type) {
      case 'playlist':
        openPlaylist(context, e.id);
      case 'album':
        openAlbum(context, e.id);
      case 'artist':
        openArtist(context, e.name, e.id);
      case 'catalog_album':
        openCatalogAlbum(context, e.id);
      case 'song':
        player.playList([Song(id: e.id, title: e.name, artist: e.artist ?? e.subtitle ?? '', album: e.album, albumId: e.albumId, artistId: e.artistId, cover: e.cover, duration: e.duration)], 0);
      default:
        toast(context, 'Open this one in the web app');
    }
  }

  Widget _art(LibraryEntry e) {
    if (e.type == 'playlist' && e.id == 'favorites') return const FavoritesArt(size: 52);
    final url = e.coverUrl ?? api.coverUrl(e.cover, 160);
    return Cover(url: url, size: 52, round: e.type == 'artist', icon: e.type == 'artist' ? Icons.person_rounded : Icons.album_rounded);
  }

  String _kind(LibraryEntry e) => switch (e.type) {
        'playlist' => 'Playlist',
        'artist' => 'Artist',
        'song' => 'Song',
        _ => 'Album',
      };

  @override
  Widget build(BuildContext context) => Loader<LibraryState>(
        cacheKey: 'me/library',
        load: () async => await api.library() ?? (throw const ApiError('The server’s answer was cut short')),
        builder: (context, state, reload) {
          final seen = <String>{};
          final entries = <(LibraryEntry, bool)>[
            (const LibraryEntry(type: 'playlist', id: 'favorites', name: 'Favorites', subtitle: 'Playlist'), false),
            for (final p in state.pins) (p, true),
            for (final r in state.recents) (r, false),
          ].where((x) => seen.add('${x.$1.type}:${x.$1.id}')).toList();
          return RefreshIndicator(
            onRefresh: reload,
            child: ListView(padding: const EdgeInsets.only(bottom: 24), children: [
              for (final (e, pinned) in entries)
                _row(
                  art: _art(e),
                  title: e.name,
                  subtitle: (e.subtitle ?? '').isNotEmpty ? e.subtitle! : _kind(e),
                  trailing: pinned ? Icon(Icons.push_pin_rounded, size: 18, color: Theme.of(context).colorScheme.primary) : null,
                  onTap: () => _openEntry(context, e),
                ),
            ]),
          );
        },
        fallback: (context, error, reload) => _OnPhone(note: '$error'),
      );
}

class _Playlists extends StatelessWidget {
  const _Playlists();

  @override
  Widget build(BuildContext context) => ValueListenableBuilder(
        valueListenable: playlistsChanged,
        builder: (context, version, _) => Loader<List<Playlist>>(
          cacheKey: 'playlists:$version',
          load: api.getPlaylists,
          builder: (context, lists, reload) => RefreshIndicator(
            onRefresh: reload,
            child: ListView(padding: const EdgeInsets.only(bottom: 24), children: [
              _row(art: const FavoritesArt(size: 52), title: 'Favorites', subtitle: 'Your liked songs', onTap: () => openPlaylist(context, 'favorites')),
              for (final p in lists)
                _row(
                  art: Cover(url: api.coverUrl(p.cover, 160), size: 52, icon: Icons.queue_music_rounded),
                  title: p.name,
                  subtitle: [plural(p.songCount, 'song'), if (p.owner != null && p.owner != api.user) 'by ${p.owner}'].join(' · '),
                  onTap: () => openPlaylist(context, p.id),
                ),
            ]),
          ),
          fallback: (context, error, reload) => _OnPhone(note: '$error'),
        ),
      );
}

class _Albums extends StatelessWidget {
  const _Albums();

  @override
  Widget build(BuildContext context) => Loader<List<Album>>(
        cacheKey: 'albums',
        load: api.getAlbums,
        builder: (context, albums, reload) => RefreshIndicator(
          onRefresh: reload,
          child: GridView.builder(
            padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
            gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(maxCrossAxisExtent: 190, mainAxisSpacing: 16, crossAxisSpacing: 14, childAspectRatio: .74),
            itemCount: albums.length,
            itemBuilder: (context, i) => LayoutBuilder(builder: (context, box) => AlbumCard(albums[i], width: box.maxWidth)),
          ),
        ),
        fallback: (context, error, reload) => _OnPhone(note: '$error'),
      );
}

class _Artists extends StatelessWidget {
  const _Artists();

  @override
  Widget build(BuildContext context) => Loader<List<Artist>>(
        cacheKey: 'artists',
        load: api.getArtists,
        builder: (context, artists, reload) => RefreshIndicator(
          onRefresh: reload,
          child: ListView.builder(
            padding: const EdgeInsets.only(bottom: 24),
            itemCount: artists.length,
            itemBuilder: (context, i) {
              final a = artists[i];
              return _row(
                art: Cover(url: api.coverUrl(a.cover, 160), size: 52, round: true, icon: Icons.person_rounded),
                title: a.name,
                subtitle: a.albumCount != null ? plural(a.albumCount!, 'album') : '',
                onTap: () => openArtist(context, a.name, a.id),
              );
            },
          ),
        ),
        fallback: (context, error, reload) => _OnPhone(note: '$error'),
      );
}

class _OnPhone extends StatelessWidget {
  final String? note;
  const _OnPhone({this.note});

  @override
  Widget build(BuildContext context) => ListenableBuilder(
        listenable: offline,
        builder: (context, _) {
          final collections = offline.collections;
          final songs = offline.directSongs;
          return ListView(padding: const EdgeInsets.only(bottom: 24), children: [
            if (note != null) Note('$note. Showing what is saved on this phone.'),
            if (collections.isEmpty && songs.isEmpty)
              const EmptyState(
                title: 'Nothing on this phone yet',
                message: 'Tap the download button on your favorites, a playlist or an album to listen without a connection. Downloads carry on with the app closed.',
                icon: Icons.download_for_offline_outlined,
              ),
            for (final c in collections)
              Builder(builder: (context) {
                final (saved, total, busy) = offline.collectionCount(c.id);
                return _row(
                  art: collectionArt(c, 52),
                  title: c.title,
                  subtitle: [c.subtitle, saved == total ? plural(total, 'song') : '$saved of $total${busy ? ', downloading' : c.paused ? ', stopped' : ''}'].where((s) => s.isNotEmpty).join(' · '),
                  onTap: () => open(context, collectionRoute(c)),
                );
              }),
            if (songs.isNotEmpty) Section(title: 'Saved songs', child: SongList(songs)),
            if (offline.bytes > 0) Note('${megabytes(offline.bytes)} on this phone'),
          ]);
        },
      );
}
