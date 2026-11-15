// Eco's look on the phone: the web app's dark theme (web/src/styles.css), its display face in titles, and the colour of
// the music behind everything. The accent follows the cover playing but is kept readable on the page (4.5:1), like
// accentFromCover in web/src/lib/color.ts.
import 'dart:async';
import 'dart:io';
import 'dart:math';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:material_ui/material_ui.dart';

class Palette {
  static const bg = Color(0xFF0B0B0F);
  static const surface = Color(0xFF14141A);
  static const surface2 = Color(0xFF1D1D26);
  static const surface3 = Color(0xFF272733);
  static const line = Color(0x14FFFFFF);
  static const text = Color(0xFFF4F4F7);
  static const muted = Color(0xFF9B9BA8);
  static const accent = Color(0xFF7CF0C0);
  static const danger = Color(0xFFFF6B6B);
  static const fav = LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: [Color(0xFF6A4CFF), Color(0xFFC86BFF), Color(0xFFFF8FB1)], stops: [0, .55, 1]);
}

const titleFont = 'Bricolage';

double _channel(double c) => c <= 0.03928 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4).toDouble();
double luminance(Color c) => 0.2126 * _channel(c.r) + 0.7152 * _channel(c.g) + 0.0722 * _channel(c.b);
double contrast(Color a, Color b) {
  final la = luminance(a), lb = luminance(b);
  return (max(la, lb) + 0.05) / (min(la, lb) + 0.05);
}

/// The colour keeps its hue, but its lightness moves until it reads at 4.5:1 on the page.
Color readableOn(Color color, Color page, [double ratio = 4.5]) {
  var hsl = HSLColor.fromColor(color);
  if (hsl.saturation < 0.25) hsl = hsl.withSaturation(0.25); // a grey cover still gives a colour
  final lighter = luminance(page) < 0.5;
  for (var i = 0; i < 40 && contrast(hsl.toColor(), page) < ratio; i++) {
    hsl = hsl.withLightness((hsl.lightness + (lighter ? 0.025 : -0.025)).clamp(0.0, 1.0));
  }
  return hsl.toColor();
}

/// Text that reads on the accent: near black on a light accent, white on a dark one.
Color inkOn(Color accent) => contrast(accent, const Color(0xFF05241A)) >= contrast(accent, Colors.white) ? const Color(0xFF05241A) : Colors.white;

/// The accent of the song playing. Taken from the small cover the player already shows, so it costs no extra request.
class Accent extends ValueNotifier<Color> {
  Accent() : super(Palette.accent);
  static final instance = Accent();
  String? _for;

  Future<void> follow(String? coverUrl) async {
    if (coverUrl == _for) return;
    _for = coverUrl;
    if (coverUrl == null) {
      value = Palette.accent;
      return;
    }
    try {
      final ImageProvider provider = coverUrl.startsWith('file:') ? FileImage(File.fromUri(Uri.parse(coverUrl))) as ImageProvider : CachedNetworkImageProvider(coverUrl);
      final scheme = await ColorScheme.fromImageProvider(provider: provider, brightness: Brightness.dark).timeout(const Duration(seconds: 8));
      if (_for == coverUrl) value = readableOn(scheme.primary, Palette.bg);
    } catch (_) {
      if (_for == coverUrl) value = Palette.accent;
    }
  }
}

ThemeData ecoTheme(Color accent) {
  final scheme = ColorScheme.fromSeed(seedColor: accent, brightness: Brightness.dark).copyWith(
    primary: accent,
    onPrimary: inkOn(accent),
    secondary: accent,
    surface: Palette.bg,
    onSurface: Palette.text,
    onSurfaceVariant: Palette.muted,
    surfaceContainerLowest: Palette.bg,
    surfaceContainerLow: Palette.surface,
    surfaceContainer: Palette.surface,
    surfaceContainerHigh: Palette.surface2,
    surfaceContainerHighest: Palette.surface3,
    outlineVariant: Palette.line,
    error: Palette.danger,
  );
  const title = TextStyle(fontFamily: titleFont, fontWeight: FontWeight.w700, letterSpacing: -0.6);
  final base = ThemeData(useMaterial3: true, colorScheme: scheme, brightness: Brightness.dark);
  return base.copyWith(
    scaffoldBackgroundColor: Colors.transparent,
    canvasColor: Palette.bg,
    textTheme: base.textTheme.copyWith(
      displaySmall: base.textTheme.displaySmall?.merge(title),
      headlineLarge: base.textTheme.headlineLarge?.merge(title),
      headlineMedium: base.textTheme.headlineMedium?.merge(title),
      headlineSmall: base.textTheme.headlineSmall?.merge(title),
      titleLarge: base.textTheme.titleLarge?.merge(title.copyWith(letterSpacing: -0.3)),
    ).apply(bodyColor: Palette.text, displayColor: Palette.text),
    appBarTheme: const AppBarTheme(backgroundColor: Colors.transparent, surfaceTintColor: Colors.transparent, elevation: 0, scrolledUnderElevation: 0),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: Palette.surface.withValues(alpha: .92),
      indicatorColor: accent.withValues(alpha: .18),
      labelBehavior: NavigationDestinationLabelBehavior.onlyShowSelected,
      height: 64,
      iconTheme: WidgetStateProperty.resolveWith((s) => IconThemeData(color: s.contains(WidgetState.selected) ? accent : Palette.muted)),
    ),
    bottomSheetTheme: const BottomSheetThemeData(backgroundColor: Palette.surface, surfaceTintColor: Colors.transparent, showDragHandle: true),
    snackBarTheme: const SnackBarThemeData(behavior: SnackBarBehavior.floating, backgroundColor: Palette.surface3, contentTextStyle: TextStyle(color: Palette.text)),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: Palette.surface2,
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(18), borderSide: BorderSide.none),
      focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(18), borderSide: BorderSide(color: accent)),
      contentPadding: const EdgeInsets.symmetric(horizontal: 18, vertical: 16),
    ),
    filledButtonTheme: FilledButtonThemeData(style: FilledButton.styleFrom(shape: const StadiumBorder(), padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 14), textStyle: const TextStyle(fontWeight: FontWeight.w700))),
    chipTheme: base.chipTheme.copyWith(shape: const StadiumBorder(), side: BorderSide.none, backgroundColor: Palette.surface2, selectedColor: accent.withValues(alpha: .22)),
    sliderTheme: SliderThemeData(trackHeight: 4, activeTrackColor: accent, inactiveTrackColor: Colors.white24, thumbColor: Palette.text, overlayShape: SliderComponentShape.noOverlay, thumbShape: const RoundSliderThumbShape(enabledThumbRadius: 7)),
    pageTransitionsTheme: const PageTransitionsTheme(builders: {TargetPlatform.android: FadeForwardsPageTransitionsBuilder()}),
  );
}

/// The wash of the music's colour behind every screen (Ambient in the web app).
class Ambient extends StatelessWidget {
  final Widget child;
  const Ambient({super.key, required this.child});

  @override
  Widget build(BuildContext context) {
    final accent = Theme.of(context).colorScheme.primary;
    return AnimatedContainer(
      duration: const Duration(milliseconds: 700),
      decoration: BoxDecoration(
        color: Palette.bg,
        gradient: RadialGradient(center: const Alignment(-0.6, -1.1), radius: 1.3, colors: [accent.withValues(alpha: .22), Palette.bg], stops: const [0, 1]),
      ),
      child: child,
    );
  }
}
