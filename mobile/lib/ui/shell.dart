// Where screens live: three tabs (Home, Search, Library), each with its own history, the mini player above the tabs,
// and the full-screen player over everything.
import 'package:audio_service/audio_service.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../api/client.dart';
import '../player/player.dart';
import '../screens/album.dart';
import '../screens/artist.dart';
import '../screens/home.dart';
import '../screens/library.dart';
import '../screens/login.dart';
import '../screens/player_screen.dart';
import '../screens/playlist.dart';
import '../screens/search.dart';
import '../screens/settings.dart';
import 'theme.dart';
import 'widgets.dart';

final _rootKey = GlobalKey<NavigatorState>();

/// The pages any tab can open, so they show inside it with the mini player under them.
List<RouteBase> _pages() => [
      GoRoute(path: 'album/:id', builder: (_, s) => LibraryAlbumScreen(id: s.pathParameters['id']!)),
      GoRoute(path: 'catalog-album/:id', builder: (_, s) => CatalogAlbumScreen(id: s.pathParameters['id']!)),
      GoRoute(path: 'artist/:id', builder: (_, s) => ArtistScreen(id: s.pathParameters['id']!)),
      GoRoute(path: 'artist-name/:name', builder: (_, s) => ArtistScreen(name: s.pathParameters['name']!)),
      GoRoute(path: 'playlist/:id', builder: (_, s) => PlaylistScreen(id: s.pathParameters['id']!)),
    ];

GoRouter buildRouter() => GoRouter(
      navigatorKey: _rootKey,
      initialLocation: '/',
      refreshListenable: api.session,
      redirect: (_, state) {
        final signedIn = api.session.value != null;
        if (!signedIn) return state.matchedLocation == '/login' ? null : '/login';
        if (state.matchedLocation == '/login') return '/';
        return null;
      },
      routes: [
        GoRoute(path: '/login', builder: (_, _) => const LoginScreen()),
        GoRoute(
          path: '/player',
          parentNavigatorKey: _rootKey,
          pageBuilder: (_, _) => CustomTransitionPage(
            child: const PlayerScreen(),
            transitionsBuilder: (_, animation, _, child) => SlideTransition(
              position: Tween(begin: const Offset(0, 1), end: Offset.zero).animate(CurvedAnimation(parent: animation, curve: Curves.easeOutCubic)),
              child: child,
            ),
          ),
        ),
        GoRoute(path: '/settings', parentNavigatorKey: _rootKey, builder: (_, _) => const SettingsScreen()),
        StatefulShellRoute.indexedStack(
          builder: (context, state, shell) => Shell(shell: shell),
          branches: [
            StatefulShellBranch(routes: [GoRoute(path: '/', builder: (_, _) => const HomeScreen(), routes: _pages())]),
            StatefulShellBranch(routes: [GoRoute(path: '/search', builder: (_, _) => const SearchScreen(), routes: _pages())]),
            StatefulShellBranch(routes: [GoRoute(path: '/library', builder: (_, _) => const LibraryScreen(), routes: _pages())]),
          ],
        ),
      ],
    );

class Shell extends StatelessWidget {
  final StatefulNavigationShell shell;
  const Shell({super.key, required this.shell});

  static const _roots = ['', '/search', '/library'];

  @override
  Widget build(BuildContext context) {
    currentTabRoot = _roots[shell.currentIndex];
    return Ambient(
      child: Scaffold(
        body: shell,
        bottomNavigationBar: Column(mainAxisSize: MainAxisSize.min, children: [
          const MiniPlayer(),
          NavigationBar(
            selectedIndex: shell.currentIndex,
            onDestinationSelected: (i) => shell.goBranch(i, initialLocation: i == shell.currentIndex),
            destinations: const [
              NavigationDestination(icon: Icon(Icons.home_outlined), selectedIcon: Icon(Icons.home_rounded), label: 'Home'),
              NavigationDestination(icon: Icon(Icons.search_rounded), selectedIcon: Icon(Icons.manage_search_rounded), label: 'Search'),
              NavigationDestination(icon: Icon(Icons.library_music_outlined), selectedIcon: Icon(Icons.library_music_rounded), label: 'Library'),
            ],
          ),
        ]),
      ),
    );
  }
}

/// What is playing, above the tabs: tap to open the player.
class MiniPlayer extends StatelessWidget {
  const MiniPlayer({super.key});

  @override
  Widget build(BuildContext context) => StreamBuilder<MediaItem?>(
        stream: player.mediaItem,
        builder: (context, snap) {
          final item = snap.data;
          final song = player.current;
          if (item == null || song == null) return const SizedBox.shrink();
          return GestureDetector(
            onTap: () => context.push('/player'),
            onVerticalDragEnd: (d) {
              if ((d.primaryVelocity ?? 0) < -200) context.push('/player');
            },
            child: Container(
              margin: const EdgeInsets.fromLTRB(10, 0, 10, 6),
              decoration: BoxDecoration(color: Palette.surface2.withValues(alpha: .96), borderRadius: BorderRadius.circular(18), boxShadow: const [BoxShadow(color: Color(0x66000000), blurRadius: 18, offset: Offset(0, 6))]),
              clipBehavior: Clip.antiAlias,
              child: Column(mainAxisSize: MainAxisSize.min, children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(8, 8, 4, 6),
                  child: Row(children: [
                    Hero(tag: 'cover', child: SongCover(song, size: 44, radius: 10)),
                    const SizedBox(width: 12),
                    Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(item.title, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w700)),
                      Text(item.artist ?? '', maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(color: Palette.muted, fontSize: 13)),
                    ])),
                    StreamBuilder<PlaybackState>(
                      stream: player.playbackState,
                      builder: (context, s) {
                        final playing = s.data?.playing ?? false;
                        final loading = s.data?.processingState == AudioProcessingState.loading || s.data?.processingState == AudioProcessingState.buffering;
                        return Row(mainAxisSize: MainAxisSize.min, children: [
                          if (loading && playing) const Padding(padding: EdgeInsets.all(12), child: SizedBox.square(dimension: 22, child: CircularProgressIndicator(strokeWidth: 2.5)))
                          else IconButton(iconSize: 32, tooltip: playing ? 'Pause' : 'Play', icon: Icon(playing ? Icons.pause_rounded : Icons.play_arrow_rounded), onPressed: playing ? player.pause : player.play),
                          IconButton(tooltip: 'Next', icon: const Icon(Icons.skip_next_rounded), onPressed: player.skipToNext),
                        ]);
                      },
                    ),
                  ]),
                ),
                const _ProgressLine(),
              ]),
            ),
          );
        },
      );
}

class _ProgressLine extends StatelessWidget {
  const _ProgressLine();

  @override
  Widget build(BuildContext context) => StreamBuilder<Duration>(
        stream: player.audio.positionStream,
        builder: (context, snap) {
          final total = player.audio.duration?.inMilliseconds ?? 0;
          final at = snap.data?.inMilliseconds ?? 0;
          return LinearProgressIndicator(value: total > 0 ? (at / total).clamp(0.0, 1.0) : 0, minHeight: 2.5, backgroundColor: Colors.transparent);
        },
      );
}
