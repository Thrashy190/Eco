// The play order: web/src/lib/queue.ts translated (and roku/components/lib/queue.brs). Change all three together, with
// their tests. Songs someone adds ("Play next", "Add to queue") wait in front of the album or playlist that is playing,
// in the order they were added, and stay marked `queued`. They also survive starting another album. When the queue runs
// out and Autoplay is on, random songs follow, marked `auto`. Everything here is pure, so it is tested.
import '../api/models.dart';

class Order {
  final List<Song> queue;
  final int index; // the song playing
  const Order(this.queue, this.index);

  static const empty = Order([], 0);

  Song? get current => index >= 0 && index < queue.length ? queue[index] : null;
  List<Song> get upcoming => index + 1 < queue.length ? queue.sublist(index + 1) : const [];
}

Song _mark(Song s) => s.withOrigin(SongKind.queued);
Song _unmark(Song s) => s.withOrigin(SongKind.list);

/// Where the next added song goes: after the current song and everything added before it.
int queueEnd(Order order) {
  var at = order.index + 1;
  while (at < order.queue.length && order.queue[at].queued) {
    at++;
  }
  return at;
}

List<Song> _insert(List<Song> queue, int at, Song song) => [...queue.take(at), song, ...queue.skip(at)];

/// "Add to queue": after the songs already waiting, before the rest of the album or playlist.
Order addToQueue(Order order, Song song) => Order(_insert(order.queue, queueEnd(order), _mark(song)), order.index);

/// "Play next": straight after the current song, ahead of anything waiting.
Order addNext(Order order, Song song) {
  final at = order.queue.isEmpty ? 0 : order.index + 1;
  return Order(_insert(order.queue, at, _mark(song)), order.index);
}

/// The songs added by hand that have not played yet.
List<Song> waiting(Order order) => order.upcoming.where((s) => s.queued).toList();

/// Start a list (already in play order) at song i. What was waiting in the queue comes right after that song.
Order startList(Order order, List<Song> songs, int i) {
  final list = songs.map(_unmark).toList();
  return Order([...list.take(i + 1), ...waiting(order), ...list.skip(i + 1)], i);
}

/// Jump to a song further down. Added songs it skips over stay waiting, right after it; skipped songs of the album or
/// playlist count as passed. Going back changes nothing but the position.
Order jump(Order order, int to) {
  final queue = order.queue;
  final index = order.index;
  if (to <= index + 1 || to >= queue.length) {
    return Order(queue, queue.isEmpty ? 0 : to.clamp(0, queue.length - 1));
  }
  final skipped = queue.sublist(index + 1, to);
  final kept = skipped.where((s) => s.queued).toList();
  if (kept.isEmpty) return Order(queue, to);
  final before = [...queue.take(index + 1), ...skipped.where((s) => !s.queued)];
  return Order([...before, queue[to], ...kept, ...queue.skip(to + 1)], before.length);
}

/// Shuffle what comes next. Added songs keep their order at the front: they were chosen to play next.
Order shuffleUpcoming(Order order, List<Song> Function(List<Song>) mix) {
  final upcoming = order.upcoming;
  List<Song> of(SongKind kind) => upcoming.where((s) => s.origin == kind).toList();
  return Order([...order.queue.take(order.index + 1), ...of(SongKind.queued), ...mix(of(SongKind.list)), ...of(SongKind.auto)], order.index);
}

/// Move a song that has not played yet from one position to another (both counted in the whole queue, `to` as it reads
/// after the move). It joins whatever it lands among, which keeps the added songs together at the front.
Order move(Order order, int from, int to) {
  final queue = order.queue;
  final index = order.index;
  if (from == to || from <= index || to <= index || from >= queue.length || to >= queue.length) return order;
  final out = [...queue];
  final song = out.removeAt(from);
  out.insert(to, song);
  final above = to - 1 > index ? out[to - 1] : null;
  final below = to + 1 < out.length ? out[to + 1] : null;
  final SongKind kind;
  if (above != null) {
    kind = above.origin;
  } else if (song.queued || (below?.queued ?? false)) {
    kind = SongKind.queued;
  } else {
    kind = below?.origin ?? song.origin;
  }
  out[to] = song.withOrigin(kind);
  return Order(out, index);
}

/// Take a song that has not played out of the queue.
Order removeAt(Order order, int at) {
  if (at <= order.index || at >= order.queue.length) return order;
  return Order([...order.queue.take(at), ...order.queue.skip(at + 1)], order.index);
}

/// What Autoplay adds when the queue runs out: candidates (already in random order) that are not in the queue yet.
/// Podcasts and audiobooks are not music to carry on with. At most `count`.
List<Song> autoplayPick(List<Song> candidates, List<Song> queue, int count) {
  final seen = {for (final s in queue) s.id};
  final out = <Song>[];
  for (final song in candidates) {
    if (out.length >= count) break;
    if (seen.contains(song.id) || song.kind != null) continue;
    seen.add(song.id);
    out.add(song.withOrigin(SongKind.auto));
  }
  return out;
}

/// Turning Autoplay off: the random songs it lined up that have not played go, so the queue ends where it did before.
Order withoutAutoplay(Order order) {
  final upcoming = order.upcoming;
  if (!upcoming.any((s) => s.auto)) return order;
  return Order([...order.queue.take(order.index + 1), ...upcoming.where((s) => !s.auto)], order.index);
}

class QueueSection {
  final SongKind kind;
  final int start; // position in the upcoming list
  final List<Song> songs;
  QueueSection(this.kind, this.start, this.songs);
}

/// What comes next, in runs by where the songs come from, for the queue to show under their own headings.
List<QueueSection> sections(List<Song> upcoming) {
  final out = <QueueSection>[];
  for (var k = 0; k < upcoming.length; k++) {
    final song = upcoming[k];
    if (out.isNotEmpty && out.last.kind == song.origin) {
      out.last.songs.add(song);
    } else {
      out.add(QueueSection(song.origin, k, [song]));
    }
  }
  return out;
}
