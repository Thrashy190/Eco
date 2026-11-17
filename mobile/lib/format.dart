// Small formatting helpers with no dependencies, so they are unit tested. They follow web/src/lib/format.ts.

String clock(num? seconds) {
  if (seconds == null || !seconds.isFinite || seconds < 0) return '0:00';
  final s = seconds.floor();
  return '${s ~/ 60}:${(s % 60).toString().padLeft(2, '0')}';
}

String greeting([int? hour]) {
  final h = hour ?? DateTime.now().hour;
  return h < 5
      ? 'Late night'
      : h < 12
          ? 'Good morning'
          : h < 19
              ? 'Good afternoon'
              : 'Good evening';
}

String plural(int n, String one, [String? many]) => '$n ${n == 1 ? one : (many ?? '${one}s')}';

/// How long a list of songs plays, roughly: "42 min", "1 h 5 min". Empty for an empty list.
String listLength(num seconds) {
  if (!(seconds > 0)) return '';
  final minutes = (seconds / 60).round().clamp(1, 1 << 31);
  if (minutes < 60) return '$minutes min';
  final rest = minutes % 60;
  return '${minutes ~/ 60} h${rest > 0 ? ' $rest min' : ''}';
}

String megabytes(int bytes) {
  final mb = bytes / 1048576;
  return '${mb < 10 ? mb.toStringAsFixed(1) : mb.round()} MB';
}

/// Two letters for an avatar when there is no picture.
String initials(String name) {
  final words = RegExp(r'[\p{L}\p{N}]+', unicode: true).allMatches(name).map((m) => m.group(0)!).take(2).toList();
  if (words.isEmpty) return '?';
  return words.map((w) => String.fromCharCode(w.runes.first)).join().toUpperCase();
}

final _youtube = RegExp(r'^https?://(www\.|m\.|music\.)?(youtube\.com|youtu\.be)/', caseSensitive: false);
bool isYoutubeLink(String text) => _youtube.hasMatch(text.trim());

String _nameKey(String name) => name.toLowerCase().trim();

/// People whose tags separated them with a semicolon, which only ever means several artists.
final Set<String> _separated = {};

/// Navidrome splits a tag on "; " into separate artists. On screen it reads like any other list of names.
String readableArtists(String? name) {
  if (name == null || !name.contains('; ')) return name ?? '';
  final parts = name.split('; ').map((p) => p.trim()).where((p) => p.isNotEmpty).toList();
  for (final part in parts) {
    _separated.add(_nameKey(part));
  }
  return parts.join(', ');
}

/// Older songs keep every artist in one tag ("Bad Bunny, Chuwi"), but a comma can also be part of a name ("Tyler,
/// The Creator"). So it only counts as a separator when one of the pieces is a known artist.
List<String> splitArtists(String name, Set<String> known) {
  final parts = name.split(RegExp(r',\s+')).map((p) => p.trim()).where((p) => p.isNotEmpty).toList();
  final split = parts.length > 1 && parts.any((p) => known.contains(_nameKey(p)) || _separated.contains(_nameKey(p)));
  return split ? parts : [name];
}

/// Who counts as an artist in their own right: anyone listed alone, or named in more than one group.
Set<String> knownArtists(Iterable<String> names) {
  final known = <String>{};
  final inGroups = <String, int>{};
  for (final name in names) {
    if (!name.contains(', ')) {
      known.add(_nameKey(name));
      continue;
    }
    for (final part in name.split(RegExp(r',\s+'))) {
      final key = _nameKey(part);
      inGroups[key] = (inGroups[key] ?? 0) + 1;
      if (inGroups[key]! > 1) known.add(key);
    }
  }
  return known;
}
