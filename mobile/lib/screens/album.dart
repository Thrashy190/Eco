// An album looks the same however it is reached (AlbumPage in web/src/views/CatalogAlbum.tsx). A library album shows
// its songs at once and becomes the catalogue's whole album when /api/albums/match finds it, keeping songs the catalogue
// does not list under "Also in your library". With no match it stays what the library holds, so it never depends on
// the catalogue to play. Tracks you lack can be chosen and downloaded.
import 'dart:async';

import 'package:material_ui/material_ui.dart';

import '../api/client.dart';
import '../api/jobs.dart';
import '../api/models.dart';
import '../format.dart';
import '../offline/offline.dart';
import '../player/player.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

class LibraryAlbumScreen extends StatelessWidget {
  final String id;
  const LibraryAlbumScreen({super.key, required this.id});

  @override
  Widget build(BuildContext context) => Scaffold(
        body: Loader<AlbumDetail>(
          cacheKey: 'album:$id',
          load: () async {
            final detail = await api.getAlbum(id);
            final a = detail.album;
            unawaited(api.touchRecent(LibraryEntry(type: 'album', id: a.id, name: a.name, subtitle: 'Album · ${a.artist}', cover: a.cover)));
            quietly(() => offline.updateCollection('album:$id', detail.songs));
            return detail;
          },
          builder: (context, detail, reload) => _LibraryAlbum(detail: detail, reload: reload),
          fallback: (context, error, reload) => _SavedAlbum(id: id, error: error, reload: reload),
        ),
      );
}

class _LibraryAlbum extends StatefulWidget {
  final AlbumDetail detail;
  final Future<void> Function() reload;
  const _LibraryAlbum({required this.detail, required this.reload});

  @override
  State<_LibraryAlbum> createState() => _LibraryAlbumState();
}

class _LibraryAlbumState extends State<_LibraryAlbum> {
  CatalogAlbumPage? _match;
  bool _asking = true;
  int _tries = 0;
  Timer? _again;

  @override
  void initState() {
    super.initState();
    _ask();
    jobs.finished.addListener(_ask);
  }

  @override
  void dispose() {
    _again?.cancel();
    jobs.finished.removeListener(_ask);
    super.dispose();
  }

  /// 503 means the catalogue could not say in time, which is not "no such album": ask again, each answer is cached.
  Future<void> _ask() async {
    final a = widget.detail.album;
    try {
      final page = await api.matchAlbum(a.name, a.artist);
      if (mounted) setState(() { _match = page; _asking = false; });
    } on CatalogBusy {
      if (!mounted) return;
      if (++_tries < 6) {
        _again = Timer(const Duration(seconds: 3), _ask);
      } else {
        setState(() => _asking = false);
      }
    } catch (_) {
      if (mounted) setState(() => _asking = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final a = widget.detail.album;
    final songs = widget.detail.songs;
    final art = Cover(url: api.coverUrl(a.cover, 600), size: 240, radius: 24, icon: Icons.album_rounded);
    final save = CollectionSpec('album:${a.id}', 'album', a.name, a.artist);
    final match = _match;
    if (match != null) {
      final listed = {for (final t in match.tracks) if (t.library != null) t.library!.id};
      final extra = songs.where((s) => !listed.contains(s.id)).toList();
      return CatalogTracks(page: match, art: art, artistId: a.artistId, extra: extra, save: save, onRefresh: () async { await widget.reload(); await _ask(); });
    }
    final length = songs.fold<int>(0, (sum, s) => sum + (s.duration ?? 0));
    return ScrollPage(back: true, onRefresh: widget.reload, children: [
      DetailHeader(art: art, title: a.name, lines: [
        ArtistLinks(a.artist, id: a.artistId),
        Text([if (a.year != null && a.year! > 0) '${a.year}', plural(songs.length, 'song'), listLength(length)].where((s) => s.isNotEmpty).join(' · ')),
      ]),
      PlayButtons(songs: songs, save: save),
      SongList(songs, showAlbum: false, numbered: true),
      if (_asking) const Note('Looking for the whole album in the catalogue…'),
    ]);
  }
}

/// No connection: the album as saved on the phone.
class _SavedAlbum extends StatelessWidget {
  final String id;
  final Object error;
  final Future<void> Function() reload;
  const _SavedAlbum({required this.id, required this.error, required this.reload});

  @override
  Widget build(BuildContext context) => ListenableBuilder(
        listenable: offline,
        builder: (context, _) {
          final record = offline.collection('album:$id');
          final songs = offline.collectionSongs('album:$id');
          if (record == null || songs.isEmpty) {
            return ScrollPage(back: true, onRefresh: reload, children: [EmptyState(title: 'Could not open this album', message: '$error', icon: Icons.cloud_off_rounded)]);
          }
          return ScrollPage(back: true, onRefresh: reload, children: [
            DetailHeader(art: SongCover(songs.first, size: 240, radius: 24), title: record.title, lines: [Text(record.subtitle), Text('Saved on this phone · ${plural(songs.length, 'song')}')]),
            PlayButtons(songs: songs),
            SongList(songs, showAlbum: false),
          ]);
        },
      );
}

class CatalogAlbumScreen extends StatelessWidget {
  final String id;
  const CatalogAlbumScreen({super.key, required this.id});

  @override
  Widget build(BuildContext context) => Scaffold(
        body: Loader<CatalogAlbumPage>(
          cacheKey: 'catalog-album:$id',
          load: () async {
            final page = await api.catalogAlbum(id);
            final a = page.album;
            unawaited(api.touchRecent(LibraryEntry(type: 'catalog_album', id: a.id, name: a.name, subtitle: 'Album · ${a.artist}', coverUrl: a.coverUrl)));
            return page;
          },
          builder: (context, page, reload) {
            final owned = page.tracks.where((t) => t.library != null).map((t) => t.library!).toList();
            final albumIds = owned.map((s) => s.albumId).toSet();
            final libraryAlbum = albumIds.length == 1 ? albumIds.first : null;
            return CatalogTracks(
              page: page,
              art: Cover(url: page.album.coverUrl, size: 240, radius: 24, icon: Icons.album_rounded),
              artistId: page.tracks.where((t) => t.library != null && t.artist == page.album.artist).firstOrNull?.library?.artistId,
              save: libraryAlbum == null ? null : CollectionSpec('album:$libraryAlbum', 'album', page.album.name, page.album.artist),
              onRefresh: reload,
            );
          },
        ),
      );
}

enum _Status { owned, busy, indexing, failed, missing }

/// What a track is doing. The library has the last word: a job only speaks for songs it does not list yet.
_Status _status(AlbumTrack t, Job? job) {
  if (t.library != null) return _Status.owned;
  if (job == null) return _Status.missing;
  if (job.state == JobState.error) return _Status.failed;
  return job.active ? _Status.busy : _Status.indexing; // downloaded a moment ago; Navidrome has not listed it yet
}

/// The catalogue's album: every track in order, what you have marked, and a choice of the others to fetch.
class CatalogTracks extends StatefulWidget {
  final CatalogAlbumPage page;
  final Widget art;
  final String? artistId;
  final List<Song> extra;
  final CollectionSpec? save;
  final Future<void> Function() onRefresh;
  const CatalogTracks({super.key, required this.page, required this.art, this.artistId, this.extra = const [], this.save, required this.onRefresh});

  @override
  State<CatalogTracks> createState() => _CatalogTracksState();
}

class _CatalogTracksState extends State<CatalogTracks> {
  final Set<String> _chosen = {};
  Timer? _indexing;

  @override
  void dispose() {
    _indexing?.cancel();
    super.dispose();
  }

  Future<void> _download(List<AlbumTrack> tracks) async {
    setState(_chosen.clear);
    toast(context, 'Downloading ${plural(tracks.length, 'song')}');
    for (final t in tracks) {
      try {
        await jobs.request(t.id);
      } catch (e) {
        if (mounted) toast(context, '$e');
        break;
      }
    }
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
        listenable: jobs,
        builder: (context, _) {
          final album = widget.page.album;
          final tracks = widget.page.tracks;
          final statuses = {for (final t in tracks) t.id: _status(t, jobs.of(t.id))};
          // A song just downloaded waits for Navidrome to list it: look again soon.
          if (statuses.values.contains(_Status.indexing)) {
            _indexing ??= Timer(const Duration(seconds: 8), () { _indexing = null; widget.onRefresh(); });
          }
          final owned = [...tracks.where((t) => t.library != null).map((t) => t.library!), ...widget.extra];
          final selectable = tracks.where((t) => statuses[t.id] == _Status.missing || statuses[t.id] == _Status.failed).toList();
          final chosen = selectable.where((t) => _chosen.contains(t.id)).toList();
          final allChosen = selectable.isNotEmpty && chosen.length == selectable.length;
          final discs = {for (final t in tracks) t.disc}.toList()..sort();
          final have = tracks.where((t) => t.library != null).length;

          return ScrollPage(back: true, onRefresh: widget.onRefresh, children: [
            DetailHeader(art: widget.art, title: album.name, lines: [
              ArtistLinks(album.artist, id: widget.artistId),
              Text([if (album.year != null && album.year! > 0) '${album.year}', '$have of ${plural(tracks.length, 'song')} downloaded'].join(' · ')),
            ]),
            if (owned.isNotEmpty) PlayButtons(songs: owned, save: widget.save),
            if (selectable.isNotEmpty)
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
                child: Row(children: [
                  TextButton(
                    onPressed: () => setState(() => allChosen ? _chosen.clear() : _chosen.addAll(selectable.map((t) => t.id))),
                    child: Text(allChosen ? 'Clear selection' : 'Select all ${selectable.length}'),
                  ),
                  const Spacer(),
                  FilledButton.icon(
                    onPressed: chosen.isEmpty ? null : () => _download(chosen),
                    icon: const Icon(Icons.download_rounded),
                    label: Text(chosen.isEmpty ? 'Tap songs to choose' : 'Download ${plural(chosen.length, 'song')}'),
                  ),
                ]),
              ),
            for (final disc in discs) ...[
              if (discs.length > 1) Padding(padding: const EdgeInsets.fromLTRB(20, 16, 20, 4), child: Text('Disc $disc', style: const TextStyle(color: Palette.muted, fontWeight: FontWeight.w700))),
              for (final t in tracks.where((t) => t.disc == disc))
                _TrackRow(
                  track: t,
                  status: statuses[t.id]!,
                  job: jobs.of(t.id),
                  showArtist: t.artist != album.artist,
                  selected: _chosen.contains(t.id),
                  onTap: () {
                    final s = statuses[t.id]!;
                    if (s == _Status.owned) {
                      player.playList(owned, owned.indexWhere((x) => x.id == t.library!.id));
                    } else if (s == _Status.missing || s == _Status.failed) {
                      setState(() => _chosen.contains(t.id) ? _chosen.remove(t.id) : _chosen.add(t.id));
                    }
                  },
                ),
            ],
            if (widget.extra.isNotEmpty) Section(title: 'Also in your library', child: SongList(widget.extra, showAlbum: false, onPlay: (i) => player.playList(owned, tracks.where((t) => t.library != null).length + i))),
          ]);
        },
      );
}

class _TrackRow extends StatelessWidget {
  final AlbumTrack track;
  final _Status status;
  final Job? job;
  final bool showArtist;
  final bool selected;
  final VoidCallback onTap;
  const _TrackRow({required this.track, required this.status, required this.job, required this.showArtist, required this.selected, required this.onTap});

  @override
  Widget build(BuildContext context) => ListenableBuilder(
        listenable: Listenable.merge([player.order, offline]),
        builder: (context, _) {
          final accent = Theme.of(context).colorScheme.primary;
          final song = track.library;
          final current = song != null && player.current?.id == song.id;
          final selectable = status == _Status.missing || status == _Status.failed;
          final label = switch (status) {
            _Status.owned => 'Downloaded',
            _Status.indexing => 'Adding to your library…',
            _Status.failed => job?.error ?? 'Could not download. Tap to choose it and try again.',
            _Status.busy => switch (job?.state) { JobState.queued => 'Waiting its turn', JobState.searching => 'Finding the song', JobState.tagging => 'Tagging', _ => 'Downloading' },
            _Status.missing => 'Not downloaded',
          };
          return InkWell(
            onTap: onTap,
            onLongPress: song == null ? null : () => songMenu(context, song),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(20, 8, 4, 8),
              child: Row(children: [
                SizedBox(
                  width: 34,
                  child: selectable
                      ? Icon(selected ? Icons.check_circle_rounded : Icons.radio_button_unchecked_rounded, color: selected ? accent : Palette.muted, size: 22)
                      : Text('${track.track}', style: TextStyle(color: current ? accent : Palette.muted)),
                ),
                Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(track.title, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontWeight: FontWeight.w600, color: current ? accent : (status == _Status.owned || selectable ? Palette.text : Palette.muted))),
                  Row(children: [
                    if (song != null) ...[SaveMark(song.id), if (offline.state(song.id) != SaveState.none) const SizedBox(width: 5)],
                    Expanded(child: Text('$label${showArtist ? ' · ${track.artist}' : ''}', maxLines: 1, overflow: TextOverflow.ellipsis,
                        style: TextStyle(color: status == _Status.failed ? Palette.danger : Palette.muted, fontSize: 13))),
                  ]),
                ])),
                if (status == _Status.busy && job != null) Padding(padding: const EdgeInsets.only(right: 8), child: JobRing(job!)),
                if (status == _Status.indexing) const Padding(padding: EdgeInsets.only(right: 8), child: SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2))),
                Text(clock(track.duration), style: const TextStyle(color: Palette.muted, fontSize: 12)),
                if (song != null)
                  IconButton(icon: const Icon(Icons.more_vert_rounded, color: Palette.muted), tooltip: 'More', onPressed: () => songMenu(context, song))
                else
                  const SizedBox(width: 16),
              ]),
            ),
          );
        },
      );
}
