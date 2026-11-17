import 'package:eco/api/jobs.dart';
import 'package:eco/api/models.dart';
import 'package:eco/screens/artist.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test("a song reads both Subsonic's and Eco's names", () {
    final a = Song.fromRaw({'id': '1', 'title': 'T', 'artist': 'A; B', 'albumId': 'x', 'coverArt': 'c', 'duration': 201.4});
    final b = Song.fromRaw({'id': '1', 'title': 'T', 'artist': 'A', 'album_id': 'x', 'cover': 'c', 'duration': 201});
    expect(a.artist, 'A, B');
    expect(a.albumId, b.albumId);
    expect(a.cover, b.cover);
    expect(a.duration, 201);
  });

  test('a song comes back from the phone as it went in, queue marks included', () {
    final s = const Song(id: '1', title: 'T', artist: 'A, B', albumId: 'x', queued: true);
    final back = Song.fromJson(s.toJson());
    expect(back.artist, 'A, B');
    expect(back.queued, isTrue);
    expect(back.albumId, 'x');
  });

  test('an answer cut short is not a library', () {
    expect(LibraryState.tryParse({}), isNull);
    expect(LibraryState.tryParse({'recents': [], 'pins': []}), isNull);
    expect(LibraryState.tryParse({'recents': [], 'pins': [], 'covers': {}}), isNotNull);
  });

  test('a job that finished long ago says nothing about the song', () {
    final now = DateTime.fromMillisecondsSinceEpoch(10000000 * 1000);
    Job job(int finished) => Job(id: 'j', key: 'k', state: JobState.ready, finishedAt: finished);
    expect(liveJob(job(10000000 - 30), now), isNotNull);
    expect(liveJob(job(10000000 - 600), now), isNull);
    expect(liveJob(const Job(id: 'j', key: 'k', state: JobState.downloading), now), isNotNull);
  });

  test("an artist's own songs follow the order of their albums, each album keeping its order", () {
    Song s(String id, String album) => Song(id: id, title: id, artist: 'A', albumId: album);
    final songs = [s('b1', 'B'), s('a1', 'A'), s('x', 'other'), s('b2', 'B'), s('a2', 'A')];
    expect(ownSongs(songs, {'A': 0, 'B': 1}).map((x) => x.id).toList(), ['a1', 'a2', 'b1', 'b2']);
  });
}
