// What several screens share: covers, rows, cards, the song menu, play and save buttons, and a loader that shows the
// last answer at once while it asks again.
import 'dart:async';
import 'dart:io';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../api/client.dart';
import '../api/jobs.dart';
import '../api/models.dart';
import '../format.dart';
import '../offline/offline.dart';
import '../player/player.dart';
import 'theme.dart';

// ---- Going places ----

/// The tab showing now ('' for Home, '/search', '/library'), so a page opens inside it, with the mini player under it.
String currentTabRoot = '';

void open(BuildContext context, String sub) => GoRouter.of(context).push('$currentTabRoot/$sub');
void openAlbum(BuildContext context, String id) => open(context, 'album/${Uri.encodeComponent(id)}');
void openCatalogAlbum(BuildContext context, String id) => open(context, 'catalog-album/${Uri.encodeComponent(id)}');
void openPlaylist(BuildContext context, String id) => open(context, 'playlist/${Uri.encodeComponent(id)}');

/// An artist's page: by ID when the name is one artist the library knows, else by name.
void openArtist(BuildContext context, String name, [String? id]) {
  if (id != null && id.isNotEmpty && !name.contains(', ')) {
    open(context, 'artist/${Uri.encodeComponent(id)}');
  } else {
    open(context, 'artist-name/${Uri.encodeComponent(name)}');
  }
}

void toast(BuildContext context, String message) {
  final messenger = ScaffoldMessenger.maybeOf(context);
  messenger?.hideCurrentSnackBar();
  messenger?.showSnackBar(SnackBar(content: Text(message), duration: const Duration(seconds: 3)));
}

// ---- Loading ----

final Map<String, Object> _answers = {};

/// Shows the last answer for [cacheKey] at once (so going back does not flash), then the new one.
class Loader<T> extends StatefulWidget {
  final String cacheKey;
  final Future<T> Function() load;
  final Widget Function(BuildContext context, T data, Future<void> Function() reload) builder;

  /// What to show when it cannot load (no connection): offline content, or the error.
  final Widget Function(BuildContext context, Object error, Future<void> Function() reload)? fallback;
  const Loader({super.key, required this.cacheKey, required this.load, required this.builder, this.fallback});

  @override
  State<Loader<T>> createState() => _LoaderState<T>();
}

class _LoaderState<T> extends State<Loader<T>> {
  T? _data;
  Object? _error;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    final cached = _answers[widget.cacheKey];
    if (cached is T) _data = cached;
    _reload();
    jobs.finished.addListener(_reload);
  }

  @override
  void didUpdateWidget(Loader<T> old) {
    super.didUpdateWidget(old);
    if (old.cacheKey != widget.cacheKey) {
      final cached = _answers[widget.cacheKey];
      _data = cached is T ? cached : null;
      _reload();
    }
  }

  @override
  void dispose() {
    jobs.finished.removeListener(_reload);
    super.dispose();
  }

  Future<void> _reload() async {
    final key = widget.cacheKey;
    _loading = true; // no setState: this also runs from initState and didUpdateWidget, which build anyway
    try {
      final data = await widget.load();
      if (!mounted || key != widget.cacheKey) return;
      _answers[key] = data as Object;
      setState(() {
        _data = data;
        _error = null;
        _loading = false;
      });
    } catch (e) {
      if (!mounted || key != widget.cacheKey) return;
      setState(() {
        _error = e;
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final data = _data;
    if (data != null) return widget.builder(context, data, _reload);
    if (_loading) return const Center(child: Padding(padding: EdgeInsets.all(48), child: CircularProgressIndicator()));
    final error = _error ?? 'Nothing here';
    if (widget.fallback != null) return widget.fallback!(context, error, _reload);
    return EmptyState(title: 'Could not load this', message: '$error', action: FilledButton.tonal(onPressed: _reload, child: const Text('Try again')));
  }
}

// ---- Pictures ----

class Cover extends StatelessWidget {
  final String? url;
  final String? file; // a copy on the phone, used when the server cannot be reached
  final double size;
  final double radius;
  final IconData icon;
  final bool round;
  const Cover({super.key, this.url, this.file, this.size = 48, this.radius = 10, this.icon = Icons.music_note_rounded, this.round = false});

  Widget _blank() => Container(
        width: size, height: size, color: Palette.surface3,
        child: Icon(icon, color: Palette.muted, size: size * .42),
      );

  Widget _local() => file != null ? Image.file(File(file!), width: size, height: size, fit: BoxFit.cover, errorBuilder: (_, _, _) => _blank()) : _blank();

  @override
  Widget build(BuildContext context) {
    final picture = url == null
        ? _local()
        : CachedNetworkImage(
            imageUrl: url!,
            cacheKey: _stableKey(url!),
            width: size, height: size, fit: BoxFit.cover,
            fadeInDuration: const Duration(milliseconds: 150),
            placeholder: (_, _) => Container(width: size, height: size, color: Palette.surface2),
            errorWidget: (_, _, _) => _local(),
          );
    return round ? ClipOval(child: picture) : ClipRRect(borderRadius: BorderRadius.circular(radius), child: picture);
  }
}

/// Every request carries a new salt-free signature, but the same session: the address without it names the picture.
String _stableKey(String url) {
  final uri = Uri.parse(url);
  final params = Map.of(uri.queryParameters)..removeWhere((k, _) => const {'u', 't', 's', 'v', 'c', 'f'}.contains(k));
  return uri.replace(queryParameters: params).toString();
}

class SongCover extends StatelessWidget {
  final Song song;
  final double size;
  final double radius;
  const SongCover(this.song, {super.key, this.size = 48, this.radius = 10});

  @override
  Widget build(BuildContext context) => Cover(url: api.songCover(song, size > 120 ? 600 : 160), file: offline.coverPath(song), size: size, radius: radius);
}

/// Favorites' picture: the heart on its gradient.
class FavoritesArt extends StatelessWidget {
  final double size;
  final double radius;
  const FavoritesArt({super.key, this.size = 48, this.radius = 10});

  @override
  Widget build(BuildContext context) => Container(
        width: size, height: size,
        decoration: BoxDecoration(gradient: Palette.fav, borderRadius: BorderRadius.circular(radius)),
        child: Icon(Icons.favorite_rounded, color: Colors.white, size: size * .45),
      );
}

// ---- Layout ----

class Section extends StatelessWidget {
  final String title;
  final Widget? action;
  final Widget child;
  const Section({super.key, required this.title, required this.child, this.action});

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(top: 22),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 0, 12, 10),
            child: Row(children: [
              Expanded(child: Text(title, style: Theme.of(context).textTheme.titleLarge)),
              ?action,
            ]),
          ),
          child,
        ]),
      );
}

class Shelf extends StatelessWidget {
  final List<Widget> children;
  final double height;
  const Shelf({super.key, required this.children, this.height = 206});

  @override
  Widget build(BuildContext context) => SizedBox(
        height: height,
        child: ListView.separated(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: 20),
          itemCount: children.length,
          separatorBuilder: (_, _) => const SizedBox(width: 14),
          itemBuilder: (_, i) => children[i],
        ),
      );
}

class ItemCard extends StatelessWidget {
  final Widget art;
  final String title;
  final String subtitle;
  final VoidCallback onTap;
  final double width;
  final bool center;
  const ItemCard({super.key, required this.art, required this.title, required this.subtitle, required this.onTap, this.width = 150, this.center = false});

  @override
  Widget build(BuildContext context) => SizedBox(
        width: width,
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: onTap,
          child: Column(crossAxisAlignment: center ? CrossAxisAlignment.center : CrossAxisAlignment.start, children: [
            art,
            const SizedBox(height: 8),
            Text(title, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w600)),
            Text(subtitle, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(color: Palette.muted, fontSize: 13)),
          ]),
        ),
      );
}

class AlbumCard extends StatelessWidget {
  final Album album;
  final double width;
  const AlbumCard(this.album, {super.key, this.width = 150});

  @override
  Widget build(BuildContext context) => ItemCard(
        width: width,
        art: Cover(url: api.coverUrl(album.cover, 300), size: width, radius: 18, icon: Icons.album_rounded),
        title: album.name,
        subtitle: [album.artist, if (album.year != null && album.year! > 0) '${album.year}'].join(' · '),
        onTap: () => openAlbum(context, album.id),
      );
}

class ExternalAlbumCard extends StatelessWidget {
  final ExternalAlbum album;
  final double width;
  const ExternalAlbumCard(this.album, {super.key, this.width = 150});

  @override
  Widget build(BuildContext context) => ItemCard(
        width: width,
        art: Stack(children: [
          Cover(url: album.coverUrl, size: width, radius: 18, icon: Icons.album_rounded),
          Positioned(right: 8, top: 8, child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
            decoration: BoxDecoration(color: Colors.black54, borderRadius: BorderRadius.circular(99)),
            child: const Text('Get', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700)),
          )),
        ]),
        title: album.name,
        subtitle: [album.artist, if (album.year != null && album.year! > 0) '${album.year}'].join(' · '),
        onTap: () => openCatalogAlbum(context, album.id),
      );
}

class ArtistCard extends StatelessWidget {
  final Artist artist;
  const ArtistCard(this.artist, {super.key});

  @override
  Widget build(BuildContext context) => ItemCard(
        width: 130,
        center: true,
        art: Cover(url: api.coverUrl(artist.cover, 300), size: 130, round: true, icon: Icons.person_rounded),
        title: artist.name,
        subtitle: artist.albumCount != null ? plural(artist.albumCount!, 'album') : 'Artist',
        onTap: () => openArtist(context, artist.name, artist.id),
      );
}

class EmptyState extends StatelessWidget {
  final String title;
  final String message;
  final Widget? action;
  final IconData icon;
  const EmptyState({super.key, required this.title, this.message = '', this.action, this.icon = Icons.graphic_eq_rounded});

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(32, 48, 32, 32),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Icon(icon, size: 44, color: Theme.of(context).colorScheme.primary),
          const SizedBox(height: 14),
          Text(title, textAlign: TextAlign.center, style: Theme.of(context).textTheme.titleLarge),
          if (message.isNotEmpty) ...[
            const SizedBox(height: 8),
            Text(message, textAlign: TextAlign.center, style: const TextStyle(color: Palette.muted)),
          ],
          if (action != null) ...[const SizedBox(height: 18), action!],
        ]),
      );
}

class Note extends StatelessWidget {
  final String text;
  const Note(this.text, {super.key});
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(20, 14, 20, 0),
        child: Text(text, style: const TextStyle(color: Palette.muted, fontSize: 13)),
      );
}

/// The big title at the top of a tab.
class TabTitle extends StatelessWidget {
  final String title;
  final String? subtitle;
  final Widget? trailing;
  const TabTitle(this.title, {super.key, this.subtitle, this.trailing});

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(20, 12, 12, 4),
        child: Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(title, style: Theme.of(context).textTheme.headlineLarge),
            if (subtitle != null) Text(subtitle!, style: const TextStyle(color: Palette.muted)),
          ])),
          ?trailing,
        ]),
      );
}

// ---- Songs ----

/// Redraws when the song playing or what is saved changes.
class _Watch extends StatelessWidget {
  final Widget Function(BuildContext) builder;
  const _Watch(this.builder);
  @override
  Widget build(BuildContext context) => ListenableBuilder(listenable: Listenable.merge([player.order, offline]), builder: (c, _) => builder(c));
}

class SaveMark extends StatelessWidget {
  final String id;
  const SaveMark(this.id, {super.key});

  @override
  Widget build(BuildContext context) {
    final accent = Theme.of(context).colorScheme.primary;
    return switch (offline.state(id)) {
      SaveState.saved => Icon(Icons.download_done_rounded, size: 16, color: accent),
      SaveState.downloading => SizedBox.square(dimension: 16, child: CircularProgressIndicator(strokeWidth: 2, value: offline.progress(id) > 0 ? offline.progress(id) : null)),
      SaveState.waiting => const Icon(Icons.schedule_rounded, size: 16, color: Palette.muted),
      SaveState.failed => const Icon(Icons.error_outline_rounded, size: 16, color: Palette.danger),
      SaveState.none => const SizedBox.shrink(),
    };
  }
}

class SongTile extends StatelessWidget {
  final Song song;
  final VoidCallback onTap;
  final bool showAlbum;
  final bool showCover;
  final String? leadingText; // a track number instead of the cover
  const SongTile({super.key, required this.song, required this.onTap, this.showAlbum = true, this.showCover = true, this.leadingText});

  @override
  Widget build(BuildContext context) => _Watch((context) {
        final current = player.current?.id == song.id;
        final accent = Theme.of(context).colorScheme.primary;
        final subtitle = [song.artist, if (showAlbum && (song.album ?? '').isNotEmpty) song.album!].join(' · ');
        return InkWell(
          onTap: onTap,
          onLongPress: () => songMenu(context, song),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(20, 7, 4, 7),
            child: Row(children: [
              if (leadingText != null)
                SizedBox(width: 30, child: Text(leadingText!, style: TextStyle(color: current ? accent : Palette.muted, fontFeatures: const [FontFeature.tabularFigures()])))
              else if (showCover)
                Padding(padding: const EdgeInsets.only(right: 14), child: SongCover(song)),
              Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(song.title, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontWeight: FontWeight.w600, color: current ? accent : Palette.text)),
                const SizedBox(height: 2),
                Row(children: [
                  SaveMark(song.id),
                  if (offline.state(song.id) != SaveState.none) const SizedBox(width: 5),
                  Expanded(child: Text(subtitle, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(color: Palette.muted, fontSize: 13))),
                ]),
              ])),
              if (song.duration != null) Text(clock(song.duration), style: const TextStyle(color: Palette.muted, fontSize: 12)),
              IconButton(icon: const Icon(Icons.more_vert_rounded, color: Palette.muted), onPressed: () => songMenu(context, song), tooltip: 'More'),
            ]),
          ),
        );
      });
}

/// A list of songs: tapping one plays the list from there.
class SongList extends StatelessWidget {
  final List<Song> songs;
  final bool showAlbum;
  final bool numbered;
  final void Function(int index)? onPlay;
  const SongList(this.songs, {super.key, this.showAlbum = true, this.numbered = false, this.onPlay});

  @override
  Widget build(BuildContext context) => Column(children: [
        for (var i = 0; i < songs.length; i++)
          SongTile(
            song: songs[i],
            showAlbum: showAlbum,
            leadingText: numbered ? '${i + 1}' : null,
            onTap: () => onPlay != null ? onPlay!(i) : player.playList(songs, i),
          ),
      ]);
}

Future<void> toggleFavorite(BuildContext context, Song song) async {
  final on = !song.isStarred;
  try {
    on ? await api.star(song.id) : await api.unstar(song.id);
    player.starred(song.id, on);
    favoritesChanged.value++;
    if (context.mounted) toast(context, on ? 'Added to Favorites' : 'Removed from Favorites');
  } catch (e) {
    if (context.mounted) toast(context, '$e');
  }
}

/// Bumped when a favourite changes, so Favorites and the player ask again.
final ValueNotifier<int> favoritesChanged = ValueNotifier(0);

Future<void> songMenu(BuildContext context, Song song, {bool fromPlayer = false}) async {
  final saved = offline.isSaved(song.id) || offline.state(song.id) != SaveState.none;
  final direct = offline.isDirect(song.id);
  final artists = splitArtists(song.artist, const {});
  await showModalBottomSheet<void>(
    context: context,
    useRootNavigator: true,
    builder: (sheet) {
      void go(VoidCallback then) {
        Navigator.of(sheet).pop();
        then();
      }

      return SafeArea(
        child: SingleChildScrollView(
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            ListTile(
              leading: SongCover(song),
              title: Text(song.title, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w700)),
              subtitle: Text(song.artist, maxLines: 1, overflow: TextOverflow.ellipsis),
            ),
            const Divider(height: 1),
            if (!fromPlayer) ...[
              ListTile(leading: const Icon(Icons.playlist_play_rounded), title: const Text('Play next'), onTap: () => go(() { player.playNext(song); toast(context, 'Plays next'); })),
              ListTile(leading: const Icon(Icons.queue_music_rounded), title: const Text('Add to queue'), onTap: () => go(() { player.addToQueue(song); toast(context, 'Added to the queue'); })),
            ],
            if (song.mediaId == null) ...[
              ListTile(
                leading: Icon(song.isStarred ? Icons.favorite_rounded : Icons.favorite_border_rounded),
                title: Text(song.isStarred ? 'Remove from Favorites' : 'Add to Favorites'),
                onTap: () => go(() => toggleFavorite(context, song)),
              ),
              ListTile(leading: const Icon(Icons.playlist_add_rounded), title: const Text('Add to playlist'), onTap: () => go(() => addToPlaylistSheet(context, [song]))),
              if (direct || !saved)
                ListTile(
                  leading: Icon(direct ? Icons.delete_outline_rounded : Icons.download_for_offline_outlined),
                  title: Text(direct ? 'Remove from this phone' : 'Save on this phone'),
                  onTap: () => go(() => direct ? quietly(() => offline.removeSong(song.id)) : quietly(() => offline.saveSong(song))),
                ),
              if (song.albumId != null)
                ListTile(leading: const Icon(Icons.album_outlined), title: Text('Go to ${song.album ?? 'album'}', maxLines: 1, overflow: TextOverflow.ellipsis), onTap: () => go(() {
                  if (fromPlayer) Navigator.of(context).pop();
                  openAlbum(context, song.albumId!);
                })),
              for (final name in artists)
                ListTile(leading: const Icon(Icons.person_outline_rounded), title: Text('Go to $name', maxLines: 1, overflow: TextOverflow.ellipsis), onTap: () => go(() {
                  if (fromPlayer) Navigator.of(context).pop();
                  openArtist(context, name, artists.length == 1 ? song.artistId : null);
                })),
            ],
          ]),
        ),
      );
    },
  );
}

Future<void> addToPlaylistSheet(BuildContext context, List<Song> songs) async {
  List<Playlist> lists;
  try {
    lists = (await api.getPlaylists()).where((p) => p.owner == null || p.owner == api.user).where((p) => !p.readonly).toList();
  } catch (e) {
    if (context.mounted) toast(context, '$e');
    return;
  }
  if (!context.mounted) return;
  final chosen = await showModalBottomSheet<String>(
    context: context,
    useRootNavigator: true,
    isScrollControlled: true,
    builder: (sheet) => SafeArea(
      child: ConstrainedBox(
        constraints: BoxConstraints(maxHeight: MediaQuery.of(sheet).size.height * .7),
        child: ListView(shrinkWrap: true, children: [
          const Padding(padding: EdgeInsets.fromLTRB(20, 0, 20, 8), child: Text('Add to playlist', style: TextStyle(fontFamily: titleFont, fontSize: 20, fontWeight: FontWeight.w700))),
          ListTile(leading: const Icon(Icons.add_rounded), title: const Text('New playlist'), onTap: () => Navigator.of(sheet).pop('')),
          for (final p in lists)
            ListTile(
              leading: Cover(url: api.coverUrl(p.cover, 160), size: 44, icon: Icons.queue_music_rounded),
              title: Text(p.name),
              subtitle: Text(plural(p.songCount, 'song')),
              onTap: () => Navigator.of(sheet).pop(p.id),
            ),
        ]),
      ),
    ),
  );
  if (chosen == null || !context.mounted) return;
  try {
    if (chosen.isEmpty) {
      final name = await askText(context, 'New playlist', 'Name');
      if (name == null || name.trim().isEmpty) return;
      await api.createPlaylist(name.trim(), songs.map((s) => s.id).toList());
      if (context.mounted) toast(context, 'Made “${name.trim()}”');
    } else {
      await api.addToPlaylist(chosen, songs.map((s) => s.id).toList());
      if (context.mounted) toast(context, songs.length == 1 ? 'Added to the playlist' : 'Added ${plural(songs.length, 'song')}');
    }
    playlistsChanged.value++;
  } catch (e) {
    if (context.mounted) toast(context, '$e');
  }
}

final ValueNotifier<int> playlistsChanged = ValueNotifier(0);

Future<String?> askText(BuildContext context, String title, String label) {
  final controller = TextEditingController();
  return showDialog<String>(
    context: context,
    useRootNavigator: true,
    builder: (dialog) => AlertDialog(
      backgroundColor: Palette.surface2,
      title: Text(title),
      content: TextField(controller: controller, autofocus: true, decoration: InputDecoration(labelText: label), onSubmitted: (v) => Navigator.of(dialog).pop(v)),
      actions: [
        TextButton(onPressed: () => Navigator.of(dialog).pop(), child: const Text('Cancel')),
        FilledButton(onPressed: () => Navigator.of(dialog).pop(controller.text), child: const Text('Save')),
      ],
    ),
  );
}

// ---- Downloading to the library (the server) ----

class JobRing extends StatelessWidget {
  final Job job;
  const JobRing(this.job, {super.key});

  @override
  Widget build(BuildContext context) {
    final p = job.state == JobState.downloading && job.progress > 0 ? job.progress / (job.progress > 1 ? 100 : 1) : null;
    return SizedBox.square(dimension: 22, child: CircularProgressIndicator(strokeWidth: 2.5, value: p));
  }
}

/// A song the catalogue has and the library does not: Get asks the server to download it.
class ExternalTile extends StatelessWidget {
  final ExternalSong ext;
  const ExternalTile(this.ext, {super.key});

  @override
  Widget build(BuildContext context) => ListenableBuilder(
        listenable: jobs,
        builder: (context, _) {
          final job = jobs.of(ext.id);
          final Widget trailing;
          if (job == null || job.state == JobState.error) {
            trailing = FilledButton.tonal(
              onPressed: () async {
                try {
                  await jobs.request(ext.id);
                } catch (e) {
                  if (context.mounted) toast(context, '$e');
                }
              },
              child: Text(job?.state == JobState.error ? 'Retry' : 'Get'),
            );
          } else if (job.state == JobState.ready) {
            trailing = Icon(Icons.check_circle_rounded, color: Theme.of(context).colorScheme.primary);
          } else {
            trailing = Padding(padding: const EdgeInsets.symmetric(horizontal: 18), child: JobRing(job));
          }
          final status = switch (job?.state) {
            JobState.queued => 'Waiting its turn',
            JobState.searching => 'Finding the song',
            JobState.downloading => 'Downloading',
            JobState.tagging => 'Adding to your library',
            JobState.ready => 'In your library',
            JobState.error => job!.error ?? 'Could not download',
            null => [ext.artist, if (ext.album.isNotEmpty) ext.album].join(' · '),
          };
          return Padding(
            padding: const EdgeInsets.fromLTRB(20, 7, 12, 7),
            child: Row(children: [
              Cover(url: ext.coverUrl, size: 48),
              const SizedBox(width: 14),
              Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(ext.title, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w600)),
                Text(status, maxLines: 2, overflow: TextOverflow.ellipsis, style: TextStyle(color: job?.state == JobState.error ? Palette.danger : Palette.muted, fontSize: 13)),
              ])),
              trailing,
            ]),
          );
        },
      );
}

// ---- A list's buttons ----

/// What saving a list on the phone needs to know about it.
class CollectionSpec {
  final String id; // favorites, playlist:<id>, album:<id>
  final String kind;
  final String title;
  final String subtitle;
  const CollectionSpec(this.id, this.kind, this.title, this.subtitle);
}

class PlayButtons extends StatelessWidget {
  final List<Song> songs;
  final CollectionSpec? save;
  final List<Widget> extra;
  const PlayButtons({super.key, required this.songs, this.save, this.extra = const []});

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 4),
        child: Row(children: [
          FilledButton.icon(onPressed: songs.isEmpty ? null : () => player.playList(songs, 0), icon: const Icon(Icons.play_arrow_rounded), label: const Text('Play')),
          const SizedBox(width: 10),
          FilledButton.tonalIcon(onPressed: songs.isEmpty ? null : () => player.playShuffled(songs), icon: const Icon(Icons.shuffle_rounded), label: const Text('Shuffle')),
          const Spacer(),
          if (save != null) SaveButton(spec: save!, songs: songs),
          ...extra,
        ]),
      );
}

/// Keep a list on the phone, stop it, or let it go. Shows how far it got.
class SaveButton extends StatelessWidget {
  final CollectionSpec spec;
  final List<Song> songs;
  const SaveButton({super.key, required this.spec, required this.songs});

  @override
  Widget build(BuildContext context) => ListenableBuilder(
        listenable: offline,
        builder: (context, _) {
          final record = offline.collection(spec.id);
          final (saved, total, busy) = offline.collectionCount(spec.id);
          final accent = Theme.of(context).colorScheme.primary;
          if (record == null) {
            return IconButton(
              tooltip: 'Save on this phone',
              icon: const Icon(Icons.download_for_offline_outlined),
              onPressed: songs.isEmpty ? null : () {
                quietly(() => offline.saveCollection(spec.id, spec.kind, spec.title, spec.subtitle, songs));
                toast(context, 'Saving ${plural(songs.length, 'song')} on this phone');
              },
            );
          }
          final complete = total > 0 && saved == total;
          return InkWell(
            borderRadius: BorderRadius.circular(99),
            onTap: () => _options(context, record, complete),
            child: Padding(
              padding: const EdgeInsets.all(8),
              child: Row(mainAxisSize: MainAxisSize.min, children: [
                if (complete)
                  Icon(Icons.download_done_rounded, color: accent)
                else if (record.paused)
                  const Icon(Icons.pause_circle_outline_rounded, color: Palette.muted)
                else
                  SizedBox.square(dimension: 22, child: CircularProgressIndicator(strokeWidth: 2.5, value: total > 0 ? saved / total : null)),
                if (!complete) Padding(padding: const EdgeInsets.only(left: 6), child: Text('$saved/$total', style: const TextStyle(color: Palette.muted, fontSize: 12))),
                if (busy && complete) const SizedBox.shrink(),
              ]),
            ),
          );
        },
      );

  void _options(BuildContext context, Collection record, bool complete) {
    showModalBottomSheet<void>(
      context: context,
      useRootNavigator: true,
      builder: (sheet) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          if (!complete && !record.paused)
            ListTile(leading: const Icon(Icons.pause_rounded), title: const Text('Stop downloading'), subtitle: const Text('What arrived stays on the phone'), onTap: () {
              Navigator.of(sheet).pop();
              quietly(() => offline.pauseCollection(spec.id));
            }),
          if (!complete && record.paused)
            ListTile(leading: const Icon(Icons.download_rounded), title: const Text('Download the rest'), onTap: () {
              Navigator.of(sheet).pop();
              quietly(() => offline.resumeCollection(spec.id));
            }),
          ListTile(leading: const Icon(Icons.delete_outline_rounded), title: const Text('Remove from this phone'), onTap: () {
            Navigator.of(sheet).pop();
            quietly(() => offline.removeCollection(spec.id));
          }),
        ]),
      ),
    );
  }
}

/// A page's header: the big picture, the title and what is under it.
class DetailHeader extends StatelessWidget {
  final Widget art;
  final String title;
  final List<Widget> lines;
  const DetailHeader({super.key, required this.art, required this.title, this.lines = const []});

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(20, 4, 20, 0),
        child: Column(children: [
          Center(child: DecoratedBox(
            decoration: BoxDecoration(borderRadius: BorderRadius.circular(24), boxShadow: const [BoxShadow(color: Color(0x73000000), blurRadius: 40, offset: Offset(0, 18))]),
            child: art,
          )),
          const SizedBox(height: 18),
          Align(alignment: Alignment.centerLeft, child: Text(title, style: Theme.of(context).textTheme.headlineMedium)),
          const SizedBox(height: 4),
          for (final line in lines) Align(alignment: Alignment.centerLeft, child: DefaultTextStyle.merge(style: const TextStyle(color: Palette.muted), child: line)),
        ]),
      );
}

/// An artist name you can follow; songs tagged with several artists give one link each.
class ArtistLinks extends StatelessWidget {
  final String name;
  final String? id;
  final TextStyle? style;
  const ArtistLinks(this.name, {super.key, this.id, this.style});

  @override
  Widget build(BuildContext context) {
    final parts = splitArtists(name, const {});
    return Wrap(children: [
      for (var i = 0; i < parts.length; i++)
        GestureDetector(
          onTap: () => openArtist(context, parts[i], parts.length == 1 ? id : null),
          child: Text('${parts[i]}${i < parts.length - 1 ? ', ' : ''}', style: style ?? const TextStyle(color: Palette.text, fontWeight: FontWeight.w600)),
        ),
    ]);
  }
}

/// A screen that scrolls under the system bars, with room at the bottom for the mini player.
class ScrollPage extends StatelessWidget {
  final List<Widget> children;
  final Future<void> Function()? onRefresh;
  final bool back;
  const ScrollPage({super.key, required this.children, this.onRefresh, this.back = false});

  @override
  Widget build(BuildContext context) {
    final list = ListView(
      padding: EdgeInsets.only(top: MediaQuery.of(context).padding.top + (back ? 0 : 8), bottom: 24),
      children: [
        if (back)
          Align(alignment: Alignment.centerLeft, child: Padding(
            padding: const EdgeInsets.only(left: 6),
            child: IconButton(icon: const Icon(Icons.arrow_back_rounded), tooltip: 'Back', onPressed: () => Navigator.of(context).maybePop()),
          )),
        ...children,
      ],
    );
    return onRefresh == null ? list : RefreshIndicator(onRefresh: onRefresh!, child: list);
  }
}
