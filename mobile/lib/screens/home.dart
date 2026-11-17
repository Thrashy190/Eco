// Home: what you were listening to gets the stage, then what just arrived, what is new, what you play most and a mix.
// With no connection it shows what is saved on the phone.
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../api/client.dart';
import '../api/models.dart';
import '../format.dart';
import '../offline/offline.dart';
import '../player/player.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'library.dart' show collectionArt, collectionRoute;

class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context) => Loader<HomeData>(
        cacheKey: 'home',
        load: api.home,
        builder: (context, data, reload) => ScrollPage(onRefresh: reload, children: [
          const _Top(),
          if (data.isEmpty)
            EmptyState(
              title: 'Your library is empty',
              message: 'Search for a song or an artist and tap Get to download it.',
              action: FilledButton.icon(onPressed: () => context.go('/search'), icon: const Icon(Icons.search_rounded), label: const Text('Search')),
            ),
          if (data.recent.isNotEmpty) _Spotlight(data.recent),
          if (data.downloads.any((j) => j.libraryId != null))
            Section(title: 'Just downloaded', child: SongList([
              for (final j in data.downloads.where((j) => j.libraryId != null))
                Song(id: j.libraryId!, title: j.title, artist: j.artist, album: j.album, cover: j.libraryId),
            ], showAlbum: false)),
          if (data.newest.isNotEmpty) Section(title: 'Recently added', child: Shelf(children: [for (final a in data.newest) AlbumCard(a)])),
          if (data.frequent.isNotEmpty) Section(title: 'Most played', child: Shelf(children: [for (final a in data.frequent) AlbumCard(a)])),
          if (data.randomSongs.isNotEmpty)
            Section(
              title: 'Mix for you',
              action: TextButton.icon(onPressed: () => player.playShuffled(data.randomSongs), icon: const Icon(Icons.shuffle_rounded), label: const Text('Shuffle')),
              child: SongList(data.randomSongs),
            ),
        ]),
        fallback: (context, error, reload) => ScrollPage(onRefresh: reload, children: [const _Top(), _Offline(error)]),
      );
}

class _Top extends StatelessWidget {
  const _Top();

  @override
  Widget build(BuildContext context) => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 4, 8, 0),
          child: Row(children: [
            const Text('Eco', style: TextStyle(fontFamily: titleFont, fontSize: 20, fontWeight: FontWeight.w700)),
            const Spacer(),
            IconButton(tooltip: 'Settings', icon: const Icon(Icons.settings_outlined), onPressed: () => context.push('/settings')),
          ]),
        ),
        TabTitle(greeting(), subtitle: api.user.isEmpty ? null : 'Signed in as ${api.user}'),
      ]);
}

/// The last album you played, one tap from playing, with the next few under it.
class _Spotlight extends StatelessWidget {
  final List<Album> albums;
  const _Spotlight(this.albums);

  Future<void> _play(BuildContext context, Album album) async {
    try {
      final whole = await api.getAlbum(album.id);
      await player.playList(whole.songs, 0);
    } catch (e) {
      if (context.mounted) toast(context, '$e');
    }
  }

  @override
  Widget build(BuildContext context) {
    final first = albums.first;
    final rest = albums.skip(1).take(4).toList();
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 0),
      child: Column(children: [
        InkWell(
          borderRadius: BorderRadius.circular(28),
          onTap: () => openAlbum(context, first.id),
          child: Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(color: Palette.surface2.withValues(alpha: .8), borderRadius: BorderRadius.circular(28), border: Border.all(color: Palette.line)),
            child: Row(children: [
              Cover(url: api.coverUrl(first.cover, 400), size: 120, radius: 20, icon: Icons.album_rounded),
              const SizedBox(width: 16),
              Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                const Text('Jump back in', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
                const SizedBox(height: 2),
                Text(first.name, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontFamily: titleFont, fontSize: 22, height: 1.05, fontWeight: FontWeight.w700)),
                Text(first.artist, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(color: Palette.muted)),
                const SizedBox(height: 10),
                FilledButton.icon(onPressed: () => _play(context, first), icon: const Icon(Icons.play_arrow_rounded), label: const Text('Play')),
              ])),
            ]),
          ),
        ),
        if (rest.isNotEmpty) ...[
          const SizedBox(height: 10),
          GridView.count(
            crossAxisCount: 2,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            mainAxisSpacing: 10,
            crossAxisSpacing: 10,
            childAspectRatio: 2.9,
            children: [
              for (final a in rest)
                InkWell(
                  borderRadius: BorderRadius.circular(16),
                  onTap: () => openAlbum(context, a.id),
                  child: Container(
                    padding: const EdgeInsets.all(7),
                    decoration: BoxDecoration(color: Colors.white.withValues(alpha: .06), borderRadius: BorderRadius.circular(16)),
                    child: Row(children: [
                      Cover(url: api.coverUrl(a.cover, 96), size: 42, radius: 10, icon: Icons.album_rounded),
                      const SizedBox(width: 10),
                      Expanded(child: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text(a.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
                        Text(a.artist, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(color: Palette.muted, fontSize: 12)),
                      ])),
                    ]),
                  ),
                ),
            ],
          ),
        ],
      ]),
    );
  }
}

/// No connection: what is on the phone.
class _Offline extends StatelessWidget {
  final Object error;
  const _Offline(this.error);

  @override
  Widget build(BuildContext context) => ListenableBuilder(
        listenable: offline,
        builder: (context, _) {
          final collections = offline.collections;
          final songs = offline.directSongs;
          return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Note('$error. Showing what is saved on this phone.'),
            if (collections.isEmpty && songs.isEmpty)
              const EmptyState(
                title: 'Nothing saved yet',
                message: 'When you are online, tap the download button on your favorites, a playlist or an album, or use the ⋮ menu on a song. It will be here without a connection.',
                icon: Icons.cloud_off_rounded,
              ),
            if (collections.isNotEmpty)
              Section(title: 'Downloaded', child: Shelf(children: [
                for (final c in collections)
                  ItemCard(art: collectionArt(c, 150), title: c.title, subtitle: c.subtitle, onTap: () => open(context, collectionRoute(c))),
              ])),
            if (songs.isNotEmpty)
              Section(
                title: 'Saved songs',
                action: TextButton.icon(onPressed: () => player.playList(songs, 0), icon: const Icon(Icons.play_arrow_rounded), label: const Text('Play')),
                child: SongList(songs),
              ),
          ]);
        },
      );
}
