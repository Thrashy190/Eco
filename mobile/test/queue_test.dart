// The same cases as web/src/lib/queue.test.ts: the three queues must agree.
import 'package:eco/api/models.dart';
import 'package:eco/player/queue.dart';
import 'package:flutter_test/flutter_test.dart';

Song song(String id, {bool queued = false, bool auto = false, String? kind}) =>
    Song(id: id, title: id, artist: 'Someone', queued: queued, auto: auto, kind: kind);
List<Song> list(List<String> ids) => ids.map(song).toList();
Song autoSong(String id) => song(id, auto: true);

/// The queue as text: added songs as `+id`, Autoplay's as `~id`, the one playing in brackets.
String read(Order o) => [
      for (var k = 0; k < o.queue.length; k++)
        '${k == o.index ? '[' : ''}${o.queue[k].queued ? '+' : o.queue[k].auto ? '~' : ''}${o.queue[k].id}${k == o.index ? ']' : ''}',
    ].join(' ');

Order at(Order o, int index) => Order(o.queue, index);

void main() {
  final playlist = Order(list(['p1', 'p2', 'p3', 'p4']), 0);

  group('adding songs while a playlist plays', () {
    test('plays an added song next, ahead of the playlist', () {
      expect(read(addToQueue(playlist, song('a'))), '[p1] +a p2 p3 p4');
    });
    test('keeps added songs in the order they were added', () {
      expect(read(addToQueue(addToQueue(playlist, song('a')), song('b'))), '[p1] +a +b p2 p3 p4');
    });
    test('puts Play next ahead of what was added before', () {
      expect(read(addNext(addToQueue(playlist, song('a')), song('n'))), '[p1] +n +a p2 p3 p4');
    });
    test('adds behind the added songs still waiting while one of them plays', () {
      final order = addToQueue(addToQueue(playlist, song('a')), song('b'));
      expect(read(addToQueue(at(order, 1), song('c'))), 'p1 [+a] +b +c p2 p3 p4');
    });
    test('lets a song be added twice', () {
      expect(read(addToQueue(addToQueue(playlist, song('a')), song('a'))), '[p1] +a +a p2 p3 p4');
    });
    test('starts an empty queue with the added song', () {
      expect(read(addNext(Order.empty, song('a'))), '[+a]');
    });
  });

  group('starting another list', () {
    test('keeps what was waiting right after the first song', () {
      final order = addToQueue(addToQueue(playlist, song('a')), song('b'));
      expect(read(startList(order, list(['x1', 'x2', 'x3']), 1)), 'x1 [x2] +a +b x3');
    });
    test('forgets added songs that already played', () {
      final order = at(addToQueue(playlist, song('a')), 2);
      expect(read(startList(order, list(['x1', 'x2']), 0)), '[x1] x2');
    });
    test("does not mark the new list's songs as added, even when one came from the queue", () {
      expect(read(startList(playlist, [song('x1', queued: true), song('x2')], 0)), '[x1] x2');
    });
  });

  group('jumping to a song in the queue', () {
    final order = addToQueue(addToQueue(playlist, song('a')), song('b')); // [p1] +a +b p2 p3 p4
    test('keeps added songs it skips waiting after it', () {
      expect(read(jump(order, 4)), 'p1 p2 [p3] +a +b p4');
    });
    test('counts skipped playlist songs as passed', () {
      expect(read(jump(order, 5)), 'p1 p2 p3 [p4] +a +b');
    });
    test('keeps added songs above an added song it jumps to', () {
      expect(read(jump(order, 2)), 'p1 [+b] +a p2 p3 p4');
    });
    test('only moves the position when going back', () {
      expect(read(jump(at(order, 4), 1)), 'p1 [+a] +b p2 p3 p4');
    });
  });

  group('dragging songs in the queue', () {
    final order = addToQueue(addToQueue(playlist, song('a')), song('b')); // [p1] +a +b p2 p3 p4
    test('reorders the added songs', () {
      expect(read(move(order, 2, 1)), '[p1] +b +a p2 p3 p4');
    });
    test('makes a playlist song dragged among the added ones an added one', () {
      expect(read(move(order, 4, 1)), '[p1] +p3 +a +b p2 p4');
      expect(read(move(order, 5, 2)), '[p1] +a +p4 +b p2 p3');
    });
    test('makes an added song dragged into the playlist part of it', () {
      expect(read(move(order, 1, 4)), '[p1] +b p2 p3 a p4');
    });
    test('reorders the playlist without marking anything', () {
      expect(read(move(playlist, 3, 1)), '[p1] p4 p2 p3');
    });
    test('never moves the song playing or one that played', () {
      final later = at(order, 2);
      expect(identical(move(later, 1, 4), later), isTrue);
      expect(identical(move(later, 4, 2), later), isTrue);
      expect(identical(move(order, 1, 9), order), isTrue);
    });
  });

  group('removing', () {
    test('takes out a song that has not played, and nothing else', () {
      final order = addToQueue(playlist, song('a'));
      expect(read(removeAt(order, 1)), '[p1] p2 p3 p4');
      expect(identical(removeAt(order, 0), order), isTrue);
    });
  });

  test('shuffling keeps added songs first, in order, and mixes the rest', () {
    final order = addToQueue(addToQueue(playlist, song('a')), song('b'));
    expect(read(shuffleUpcoming(order, (s) => s.reversed.toList())), '[p1] +a +b p4 p3 p2');
  });

  group('sections', () {
    test('groups added songs apart from the list', () {
      final order = addToQueue(addToQueue(playlist, song('a')), song('b'));
      final out = sections([...order.queue.skip(1), autoSong('r1')]);
      expect(out.map((s) => '${s.kind.name} ${s.start} ${s.songs.map((x) => x.id).join(',')}').toList(),
          ['queued 0 a,b', 'list 2 p2,p3,p4', 'auto 5 r1']);
    });
    test('has nothing to show for an empty queue', () {
      expect(sections([]), isEmpty);
    });
  });

  group('autoplay', () {
    test('picks songs that are not in the queue yet, marked as its own', () {
      final picked = autoplayPick(list(['p2', 'x1', 'x2', 'x3']), playlist.queue, 2);
      expect(picked.map((s) => s.id).toList(), ['x1', 'x2']);
      expect(picked.every((s) => s.auto && !s.queued), isTrue);
    });
    test('leaves podcasts and audiobooks out, and never picks a song twice', () {
      expect(autoplayPick([song('e1', kind: 'podcast'), song('x1'), song('x1')], [], 5).map((s) => s.id).toList(), ['x1']);
    });
    test('forgets its marks when a list is started from those songs', () {
      expect(read(startList(playlist, [autoSong('x1'), autoSong('x2')], 0)), '[x1] x2');
    });
    test('keeps its songs after the list when shuffling', () {
      final order = Order([...playlist.queue, autoSong('r1')], 0);
      expect(read(shuffleUpcoming(order, (s) => s.reversed.toList())), '[p1] p4 p3 p2 ~r1');
    });
    test('makes one of its songs dragged among the added ones an added one', () {
      final order = Order([...addToQueue(playlist, song('a')).queue, autoSong('r1')], 0); // [p1] +a p2 p3 p4 ~r1
      expect(read(move(order, 5, 2)), '[p1] +a +r1 p2 p3 p4');
    });
    test('takes away what it lined up when turned off, but not the song playing', () {
      final order = Order([...playlist.queue, autoSong('r1'), autoSong('r2'), autoSong('r3')], 5);
      expect(read(withoutAutoplay(order)), 'p1 p2 p3 p4 ~r1 [~r2]');
      expect(read(withoutAutoplay(at(order, 0))), '[p1] p2 p3 p4');
    });
    test('keeps one of its songs that was dragged among the added ones', () {
      final order = move(Order([...addToQueue(playlist, song('a')).queue, autoSong('r1'), autoSong('r2')], 0), 5, 2);
      expect(read(withoutAutoplay(order)), '[p1] +a +r1 p2 p3 p4');
    });
    test('leaves a queue without its songs as it was', () {
      expect(identical(withoutAutoplay(playlist), playlist), isTrue);
    });
  });
}
