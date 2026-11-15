// A playlist, or Favorites: Navidrome's stars shown as a playlist with the reserved ID `favorites`, never turned into a
// real playlist. A kept playlist follows its songs. With no connection it shows what is saved on the phone.
import 'dart:async';

import 'package:material_ui/material_ui.dart';

import '../api/client.dart';
import '../api/models.dart';
import '../format.dart';
import '../offline/offline.dart';
import '../ui/widgets.dart';

class PlaylistScreen extends StatelessWidget {
  final String id;
  const PlaylistScreen({super.key, required this.id});

  bool get _favorites => id == 'favorites';
  String get _saveId => _favorites ? 'favorites' : 'playlist:$id';

  Future<PlaylistDetail> _load() async {
    final detail = _favorites
        ? PlaylistDetail(const Playlist(id: 'favorites', name: 'Favorites'), await api.getStarred())
        : await api.getPlaylist(id);
    final p = detail.playlist;
    final count = plural(detail.songs.length, 'song');
    unawaited(api.touchRecent(LibraryEntry(type: 'playlist', id: p.id, name: p.name, subtitle: 'Playlist · $count', cover: p.cover)));
    quietly(() => offline.updateCollection(_saveId, detail.songs));
    return detail;
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        body: ValueListenableBuilder(
          valueListenable: favoritesChanged,
          builder: (context, version, _) => Loader<PlaylistDetail>(
            cacheKey: 'playlist:$id:${_favorites ? version : 0}',
            load: _load,
            builder: (context, detail, reload) {
              final p = detail.playlist;
              final songs = detail.songs;
              final length = songs.fold<int>(0, (sum, s) => sum + (s.duration ?? 0));
              return ScrollPage(back: true, onRefresh: reload, children: [
                DetailHeader(
                  art: _favorites ? const FavoritesArt(size: 240, radius: 24) : Cover(url: api.coverUrl(p.cover, 600), size: 240, radius: 24, icon: Icons.queue_music_rounded),
                  title: p.name,
                  lines: [
                    if (p.owner != null && p.owner != api.user) Text('By ${p.owner}'),
                    Text([plural(songs.length, 'song'), listLength(length)].where((s) => s.isNotEmpty).join(' · ')),
                  ],
                ),
                PlayButtons(songs: songs, save: CollectionSpec(_saveId, _favorites ? 'favorites' : 'playlist', p.name, _favorites ? 'Your liked songs' : 'Playlist')),
                if (songs.isEmpty)
                  EmptyState(
                    title: _favorites ? 'No favorites yet' : 'This playlist is empty',
                    message: _favorites ? 'Tap the heart on a song you love.' : 'Add songs from their ⋮ menu.',
                    icon: _favorites ? Icons.favorite_border_rounded : Icons.queue_music_rounded,
                  ),
                SongList(songs),
              ]);
            },
            fallback: (context, error, reload) => ListenableBuilder(
              listenable: offline,
              builder: (context, _) {
                final record = offline.collection(_saveId);
                final songs = offline.collectionSongs(_saveId);
                if (record == null || songs.isEmpty) {
                  return ScrollPage(back: true, onRefresh: reload, children: [EmptyState(title: 'Could not open this list', message: '$error', icon: Icons.cloud_off_rounded)]);
                }
                return ScrollPage(back: true, onRefresh: reload, children: [
                  DetailHeader(
                    art: _favorites ? const FavoritesArt(size: 240, radius: 24) : SongCover(songs.first, size: 240, radius: 24),
                    title: record.title,
                    lines: [Text('Saved on this phone · ${plural(songs.length, 'song')}')],
                  ),
                  PlayButtons(songs: songs),
                  SongList(songs),
                ]);
              },
            ),
          ),
        ),
      );
}
