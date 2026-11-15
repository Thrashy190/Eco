// The helpers shared with the web app (web/src/lib/format.ts, lib/color.ts) and the server address the sign-in keeps.
import 'package:eco/api/client.dart';
import 'package:eco/format.dart';
import 'package:eco/ui/theme.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';

void main() {
  test('clock reads minutes and seconds', () {
    expect(clock(0), '0:00');
    expect(clock(65), '1:05');
    expect(clock(null), '0:00');
    expect(clock(-3), '0:00');
  });

  test('listLength is rough and says nothing for an empty list', () {
    expect(listLength(0), '');
    expect(listLength(20), '1 min');
    expect(listLength(42 * 60), '42 min');
    expect(listLength(65 * 60), '1 h 5 min');
    expect(listLength(120 * 60), '2 h');
  });

  test('semicolons in tags read as a list of names', () {
    expect(readableArtists('Bad Bunny; Chuwi'), 'Bad Bunny, Chuwi');
    expect(readableArtists('Tyler, The Creator'), 'Tyler, The Creator');
  });

  test('a comma splits artists only when a piece is a known artist', () {
    final known = knownArtists(['Bad Bunny', 'Offset, Metro Boomin', '21 Savage, Offset, Metro Boomin']);
    expect(splitArtists('Bad Bunny, Jhay Cortez', known), ['Bad Bunny', 'Jhay Cortez']);
    expect(splitArtists('Tyler, The Creator', known), ['Tyler, The Creator']);
    expect(splitArtists('Offset, Metro Boomin', known), ['Offset', 'Metro Boomin']);
  });

  test('initials keep any alphabet', () {
    expect(initials('ana maria'), 'AM');
    expect(initials('Кино'), 'К');
    expect(initials('***'), '?');
  });

  group('the server address', () {
    test('gets https unless it is plainly a home address', () {
      expect(normalizeServer('eco.example.com'), 'https://eco.example.com');
      expect(normalizeServer('192.168.1.20:8000'), 'http://192.168.1.20:8000');
      expect(normalizeServer('localhost:8000'), 'http://localhost:8000');
    });
    test('loses what was copied from the browser after the host', () {
      expect(normalizeServer(' https://eco.example.com/#/library '), 'https://eco.example.com');
      expect(normalizeServer('http://eco.local:8000/album/1'), 'http://eco.local:8000');
    });
    test('refuses what is not an address', () {
      expect(normalizeServer(''), '');
      expect(normalizeServer('https://'), '');
    });
  });

  group('the accent stays readable', () {
    test('a dark cover colour is lifted to 4.5:1 on the page', () {
      final accent = readableOn(const Color(0xFF1A0A40), Palette.bg);
      expect(contrast(accent, Palette.bg), greaterThanOrEqualTo(4.5));
    });
    test('a colour already readable is left alone', () {
      expect(readableOn(Palette.accent, Palette.bg).toARGB32(), Palette.accent.toARGB32());
    });
    test('a grey cover still gives a colour', () {
      final accent = HSLColor.fromColor(readableOn(const Color(0xFF808080), Palette.bg));
      expect(accent.saturation, greaterThan(0.2));
    });
  });
}
