// The full-screen player: the cover, the song, every control, and the queue. Swipe down or Back to close.
import 'package:audio_service/audio_service.dart';
import 'package:material_ui/material_ui.dart';

import '../api/models.dart';
import '../format.dart';
import '../player/player.dart';
import '../player/queue.dart' as q;
import '../ui/theme.dart';
import '../ui/widgets.dart';

class PlayerScreen extends StatelessWidget {
  const PlayerScreen({super.key});

  @override
  Widget build(BuildContext context) => Ambient(
        child: Scaffold(
          body: GestureDetector(
            onVerticalDragEnd: (d) {
              if ((d.primaryVelocity ?? 0) > 300) Navigator.of(context).maybePop();
            },
            child: SafeArea(
              child: ValueListenableBuilder<q.Order>(
                valueListenable: player.order,
                builder: (context, order, _) {
                  final song = order.current;
                  if (song == null) {
                    return Center(child: TextButton(onPressed: () => Navigator.of(context).maybePop(), child: const Text('Nothing is playing')));
                  }
                  return LayoutBuilder(builder: (context, box) {
                    final art = (box.maxWidth - 56).clamp(160.0, box.maxHeight * .46);
                    return Column(children: [
                      Row(children: [
                        IconButton(icon: const Icon(Icons.keyboard_arrow_down_rounded, size: 32), tooltip: 'Close', onPressed: () => Navigator.of(context).maybePop()),
                        const Expanded(child: Text('Now playing', textAlign: TextAlign.center, style: TextStyle(fontWeight: FontWeight.w700))),
                        IconButton(icon: const Icon(Icons.more_vert_rounded), tooltip: 'More', onPressed: () => songMenu(context, song, fromPlayer: true)),
                      ]),
                      const Spacer(),
                      Hero(
                        tag: 'cover',
                        child: DecoratedBox(
                          decoration: BoxDecoration(borderRadius: BorderRadius.circular(28), boxShadow: const [BoxShadow(color: Color(0x80000000), blurRadius: 50, offset: Offset(0, 24))]),
                          child: SongCover(song, size: art, radius: 28),
                        ),
                      ),
                      const Spacer(),
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 28),
                        child: Row(children: [
                          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Text(song.title, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontFamily: titleFont, fontSize: 26, height: 1.1, fontWeight: FontWeight.w700)),
                            const SizedBox(height: 4),
                            GestureDetector(
                              onTap: () {
                                Navigator.of(context).maybePop();
                                openArtist(context, song.artist, song.artistId);
                              },
                              child: Text(song.artist, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(color: Palette.muted, fontSize: 16)),
                            ),
                          ])),
                          if (song.mediaId == null)
                            IconButton(
                              iconSize: 28,
                              tooltip: song.isStarred ? 'Remove from Favorites' : 'Add to Favorites',
                              icon: Icon(song.isStarred ? Icons.favorite_rounded : Icons.favorite_border_rounded, color: song.isStarred ? Theme.of(context).colorScheme.primary : null),
                              onPressed: () => toggleFavorite(context, song),
                            ),
                        ]),
                      ),
                      const SizedBox(height: 14),
                      const _Seek(),
                      const SizedBox(height: 6),
                      const _Controls(),
                      const SizedBox(height: 10),
                      ValueListenableBuilder<String?>(
                        valueListenable: player.problem,
                        builder: (context, problem, _) => problem == null ? const SizedBox(height: 0) : Text(problem, style: const TextStyle(color: Palette.danger)),
                      ),
                      TextButton.icon(
                        onPressed: () => showModalBottomSheet<void>(context: context, isScrollControlled: true, useRootNavigator: true, builder: (_) => const QueueSheet()),
                        icon: const Icon(Icons.queue_music_rounded),
                        label: Text(order.upcoming.isEmpty ? 'Queue' : 'Up next · ${plural(order.upcoming.length, 'song')}'),
                      ),
                      const SizedBox(height: 8),
                    ]);
                  });
                },
              ),
            ),
          ),
        ),
      );
}

class _Seek extends StatefulWidget {
  const _Seek();

  @override
  State<_Seek> createState() => _SeekState();
}

class _SeekState extends State<_Seek> {
  double? _dragging;

  @override
  Widget build(BuildContext context) => StreamBuilder<Duration>(
        stream: player.audio.positionStream,
        builder: (context, snap) {
          final total = (player.audio.duration ?? Duration(seconds: player.current?.duration ?? 0)).inMilliseconds.toDouble();
          final at = (_dragging ?? snap.data?.inMilliseconds.toDouble() ?? 0).clamp(0.0, total > 0 ? total : 1.0);
          return Padding(
            padding: const EdgeInsets.symmetric(horizontal: 28),
            child: Column(children: [
              SizedBox(
                height: 28,
                child: Slider(
                  value: at,
                  max: total > 0 ? total : 1,
                  onChanged: total > 0 ? (v) => setState(() => _dragging = v) : null,
                  onChangeEnd: (v) {
                    player.seek(Duration(milliseconds: v.round()));
                    setState(() => _dragging = null);
                  },
                ),
              ),
              Row(children: [
                Text(clock(at / 1000), style: const TextStyle(color: Palette.muted, fontSize: 12)),
                const Spacer(),
                Text(clock(total / 1000), style: const TextStyle(color: Palette.muted, fontSize: 12)),
              ]),
            ]),
          );
        },
      );
}

class _Controls extends StatelessWidget {
  const _Controls();

  @override
  Widget build(BuildContext context) {
    final accent = Theme.of(context).colorScheme.primary;
    return ListenableBuilder(
      listenable: Listenable.merge([player.shuffle, player.repeat, player.autoplay]),
      builder: (context, _) => Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16),
        child: Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
          IconButton(tooltip: 'Shuffle', icon: Icon(Icons.shuffle_rounded, color: player.shuffle.value ? accent : Palette.muted), onPressed: player.toggleShuffle),
          IconButton(iconSize: 40, tooltip: 'Previous', icon: const Icon(Icons.skip_previous_rounded), onPressed: player.skipToPrevious),
          StreamBuilder<PlaybackState>(
            stream: player.playbackState,
            builder: (context, snap) {
              final playing = snap.data?.playing ?? false;
              final loading = snap.data?.processingState == AudioProcessingState.loading || snap.data?.processingState == AudioProcessingState.buffering;
              return SizedBox.square(
                dimension: 76,
                child: FilledButton(
                  style: FilledButton.styleFrom(shape: const CircleBorder(), padding: EdgeInsets.zero),
                  onPressed: playing ? player.pause : player.play,
                  child: loading && playing
                      ? SizedBox.square(dimension: 28, child: CircularProgressIndicator(strokeWidth: 3, color: inkOn(accent)))
                      : Icon(playing ? Icons.pause_rounded : Icons.play_arrow_rounded, size: 42),
                ),
              );
            },
          ),
          IconButton(iconSize: 40, tooltip: 'Next', icon: const Icon(Icons.skip_next_rounded), onPressed: player.skipToNext),
          IconButton(
            tooltip: switch (player.repeat.value) { Repeat.off => 'Repeat', Repeat.all => 'Repeat all', Repeat.one => 'Repeat one' },
            icon: Icon(player.repeat.value == Repeat.one ? Icons.repeat_one_rounded : Icons.repeat_rounded, color: player.repeat.value == Repeat.off ? Palette.muted : accent),
            onPressed: player.cycleRepeat,
          ),
          IconButton(
            tooltip: player.autoplay.value ? 'Autoplay is on' : 'Autoplay',
            icon: Icon(Icons.auto_awesome_rounded, color: player.autoplay.value ? accent : Palette.muted),
            onPressed: () {
              player.toggleAutoplay();
              toast(context, player.autoplay.value ? 'Autoplay on: random songs follow when the queue ends' : 'Autoplay off');
            },
          ),
        ]),
      ),
    );
  }
}

/// What comes next, under headings by where the songs come from. Drag the handle to reorder, swipe to remove.
class QueueSheet extends StatelessWidget {
  const QueueSheet({super.key});

  static const _headings = {SongKind.queued: 'Added by you', SongKind.list: 'Next from the list', SongKind.auto: 'Autoplay'};

  @override
  Widget build(BuildContext context) => SizedBox(
        height: MediaQuery.of(context).size.height * .8,
        child: ValueListenableBuilder<q.Order>(
          valueListenable: player.order,
          builder: (context, order, _) {
            final current = order.current;
            final upcoming = order.upcoming;
            final groups = q.sections(upcoming);
            final headingAt = {for (final g in groups) g.start: g.kind};
            return Column(children: [
              if (current != null)
                ListTile(
                  leading: SongCover(current),
                  title: Text(current.title, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontWeight: FontWeight.w700, color: Theme.of(context).colorScheme.primary)),
                  subtitle: Text('Now playing · ${current.artist}', maxLines: 1, overflow: TextOverflow.ellipsis),
                ),
              if (upcoming.isEmpty) const Padding(padding: EdgeInsets.all(32), child: Text('Nothing after this song.', style: TextStyle(color: Palette.muted))),
              Expanded(
                child: ReorderableListView.builder(
                  buildDefaultDragHandles: false,
                  itemCount: upcoming.length,
                  // onReorderItem already counts `to` as it reads after the move, like the queue does.
                  onReorderItem: (from, to) => player.moveInQueue(order.index + 1 + from, order.index + 1 + to),
                  itemBuilder: (context, k) {
                    final song = upcoming[k];
                    final heading = headingAt[k];
                    return Dismissible(
                      key: ValueKey('${order.index + 1 + k}:${song.id}:${song.origin.name}'),
                      direction: DismissDirection.endToStart,
                      background: Container(alignment: Alignment.centerRight, padding: const EdgeInsets.only(right: 24), color: Palette.danger.withValues(alpha: .25), child: const Icon(Icons.delete_outline_rounded)),
                      onDismissed: (_) => player.removeFromQueue(order.index + 1 + k),
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        if (heading != null) Padding(padding: const EdgeInsets.fromLTRB(20, 14, 20, 4), child: Text(_headings[heading]!, style: const TextStyle(color: Palette.muted, fontWeight: FontWeight.w700))),
                        ListTile(
                          contentPadding: const EdgeInsets.only(left: 20, right: 8),
                          leading: SongCover(song, size: 44),
                          title: Text(song.title, maxLines: 1, overflow: TextOverflow.ellipsis),
                          subtitle: Text(song.artist, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(color: Palette.muted)),
                          onTap: () => player.jumpTo(order.index + 1 + k),
                          trailing: ReorderableDragStartListener(index: k, child: const Padding(padding: EdgeInsets.all(12), child: Icon(Icons.drag_handle_rounded, color: Palette.muted))),
                        ),
                      ]),
                    );
                  },
                ),
              ),
            ]);
          },
        ),
      );
}
