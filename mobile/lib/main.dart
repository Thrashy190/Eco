// Eco for phones: the same server, played by a native app, so music and downloads carry on in the background.
import 'dart:async';

import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import 'api/client.dart';
import 'api/jobs.dart';
import 'offline/offline.dart';
import 'player/player.dart';
import 'ui/shell.dart';
import 'ui/theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
  SystemChrome.setSystemUIOverlayStyle(const SystemUiOverlayStyle(
    statusBarColor: Colors.transparent,
    systemNavigationBarColor: Colors.transparent,
    statusBarIconBrightness: Brightness.light,
    systemNavigationBarIconBrightness: Brightness.light,
  ));
  await api.restore();
  await offline.init();
  await EcoPlayer.init();
  // The accent follows the cover playing, from the small picture the player already shows.
  player.mediaItem.listen((item) => Accent.instance.follow(item?.artUri?.toString().replaceFirst(RegExp(r'size=\d+'), 'size=160')));
  api.session.addListener(() async {
    if (api.session.value == null) {
      jobs.clear();
      await player.clear();
    } else {
      jobs.poll();
      unawaited(offline.resume());
    }
  });
  if (api.session.value != null) jobs.poll();
  runApp(const EcoApp());
}

class EcoApp extends StatefulWidget {
  const EcoApp({super.key});

  @override
  State<EcoApp> createState() => _EcoAppState();
}

class _EcoAppState extends State<EcoApp> with WidgetsBindingObserver {
  final _router = buildRouter();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.paused) unawaited(player.savePosition());
    if (state == AppLifecycleState.resumed && api.session.value != null) {
      jobs.poll();
      unawaited(offline.resume());
    }
  }

  @override
  Widget build(BuildContext context) => ValueListenableBuilder<Color>(
        valueListenable: Accent.instance,
        builder: (context, accent, _) => MaterialApp.router(
          title: 'Eco',
          debugShowCheckedModeBanner: false,
          theme: ecoTheme(accent),
          routerConfig: _router,
        ),
      );
}
