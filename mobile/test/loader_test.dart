// The loader shows what it got, keeps the last answer when coming back, and says when it cannot load.
import 'dart:async';

import 'package:eco/ui/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';

Widget _app(Widget child) => MaterialApp(home: Scaffold(body: child));

void main() {
  testWidgets('shows the answer, and the last one at once when it opens again', (tester) async {
    var calls = 0;
    Widget loader() => Loader<String>(
          cacheKey: 'test-answer',
          load: () async {
            calls++;
            return 'answer $calls';
          },
          builder: (_, data, _) => Text(data),
        );
    await tester.pumpWidget(_app(loader()));
    await tester.pumpAndSettle();
    expect(find.text('answer 1'), findsOneWidget);

    await tester.pumpWidget(_app(const SizedBox()));
    final slow = Completer<void>();
    await tester.pumpWidget(_app(Loader<String>(
      cacheKey: 'test-answer',
      load: () async {
        await slow.future;
        return 'fresh';
      },
      builder: (_, data, _) => Text(data),
    )));
    expect(find.text('answer 1'), findsOneWidget); // no spinner while it asks again
    slow.complete();
    await tester.pumpAndSettle();
    expect(find.text('fresh'), findsOneWidget);
  });

  testWidgets('says why when it cannot load, and offers to try again', (tester) async {
    await tester.pumpWidget(_app(Loader<String>(
      cacheKey: 'test-failing',
      load: () async => throw Exception('No connection to the server'),
      builder: (_, data, _) => Text(data),
    )));
    await tester.pumpAndSettle();
    expect(find.textContaining('No connection to the server'), findsOneWidget);
    expect(find.text('Try again'), findsOneWidget);
  });
}
