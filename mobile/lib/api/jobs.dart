// Songs being fetched by the server (web/src/stores/downloads.ts). Screens read a job by its key (a catalogue ID) and
// redraw as it moves from queued → searching → downloading → tagging → ready.
import 'dart:async';

import 'package:flutter/foundation.dart';

import 'client.dart';
import 'models.dart';

/// A finished job is history, not state: the server keeps jobs for an hour, and the song may have been deleted since.
/// Only a job that finished moments ago still says something about the song.
Job? liveJob(Job? job, [DateTime? now]) {
  if (job?.state == JobState.ready && (job!.finishedAt ?? 0) * 1000 < (now ?? DateTime.now()).millisecondsSinceEpoch - 2 * 60000) return null;
  return job;
}

class Jobs extends ChangeNotifier {
  Jobs._();
  static final instance = Jobs._();

  final Map<String, Job> _jobs = {};
  Timer? _timer;

  /// Called when a download finishes, so lists can ask again.
  final ValueNotifier<int> finished = ValueNotifier(0);

  Job? of(String key) => liveJob(_jobs[key]);

  Future<void> _tick() async {
    List<Job> list;
    try {
      list = await api.jobs();
    } catch (_) {
      return;
    }
    var done = false;
    for (final job in list) {
      final before = _jobs[job.key];
      if (job.state == JobState.ready && before != null && before.state != JobState.ready) done = true;
      _jobs[job.key] = job;
    }
    notifyListeners();
    if (done) finished.value++;
    if (!_jobs.values.any((j) => j.active)) {
      _timer?.cancel();
      _timer = null;
    }
  }

  /// Follow the server's jobs (also picks up ones started earlier or from another device).
  void poll() {
    _timer ??= Timer.periodic(const Duration(milliseconds: 1200), (_) => _tick());
    _tick();
  }

  Future<Job> request(String catalogId) async {
    final job = await api.requestDownload(catalogId);
    _jobs[job.key] = job;
    notifyListeners();
    poll();
    return job;
  }

  void clear() {
    _timer?.cancel();
    _timer = null;
    _jobs.clear();
    notifyListeners();
  }
}

final jobs = Jobs.instance;
