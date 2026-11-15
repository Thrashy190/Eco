// Signing in: the address of Eco and a Navidrome account. The password is never kept, only a token made from it.
import 'package:material_ui/material_ui.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../api/client.dart';
import '../ui/theme.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _server = TextEditingController();
  final _user = TextEditingController();
  final _password = TextEditingController();
  String? _error;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    SharedPreferences.getInstance().then((p) {
      final last = p.getString('eco.server');
      if (last != null && _server.text.isEmpty) _server.text = last;
    });
  }

  Future<void> _submit() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await api.signIn(_server.text, _user.text, _password.text);
      (await SharedPreferences.getInstance()).setString('eco.server', normalizeServer(_server.text));
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Ambient(
        child: Scaffold(
          body: SafeArea(
            child: Center(
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(28),
                child: AutofillGroup(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                    const _Logo(size: 72),
                    const SizedBox(height: 18),
                    Text('Eco', textAlign: TextAlign.center, style: Theme.of(context).textTheme.displaySmall),
                    const SizedBox(height: 6),
                    const Text('Sign in with your Navidrome account', textAlign: TextAlign.center, style: TextStyle(color: Palette.muted)),
                    const SizedBox(height: 28),
                    TextField(
                      controller: _server,
                      keyboardType: TextInputType.url,
                      autocorrect: false,
                      textInputAction: TextInputAction.next,
                      decoration: const InputDecoration(labelText: 'Server', hintText: 'eco.example.com', prefixIcon: Icon(Icons.dns_outlined)),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: _user,
                      autocorrect: false,
                      autofillHints: const [AutofillHints.username],
                      textInputAction: TextInputAction.next,
                      decoration: const InputDecoration(labelText: 'Username', prefixIcon: Icon(Icons.person_outline_rounded)),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: _password,
                      obscureText: true,
                      autofillHints: const [AutofillHints.password],
                      onSubmitted: (_) => _busy ? null : _submit(),
                      decoration: const InputDecoration(labelText: 'Password', prefixIcon: Icon(Icons.lock_outline_rounded)),
                    ),
                    if (_error != null) Padding(padding: const EdgeInsets.only(top: 14), child: Text(_error!, style: const TextStyle(color: Palette.danger))),
                    const SizedBox(height: 22),
                    FilledButton(
                      onPressed: _busy ? null : _submit,
                      child: _busy ? const SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2.5)) : const Text('Sign in'),
                    ),
                  ]),
                ),
              ),
            ),
          ),
        ),
      );
}

/// The logo: the same bars as web/public/icon.svg, with the mark in the accent.
class _Logo extends StatelessWidget {
  final double size;
  const _Logo({required this.size});

  @override
  Widget build(BuildContext context) => Center(child: CustomPaint(size: Size.square(size), painter: LogoPainter(Theme.of(context).colorScheme.primary)));
}

class LogoPainter extends CustomPainter {
  final Color mark;
  LogoPainter(this.mark);

  static const _bars = [
    [94, 175, 163], [136, 125, 263], [178, 101, 86], [178, 229, 55], [178, 326, 86], [220, 90, 75], [220, 229, 55], [220, 348, 75],
    [262, 90, 75], [262, 229, 55], [262, 348, 75], [304, 101, 86], [304, 229, 55], [304, 326, 86], [346, 125, 159], [346, 351, 37], [388, 175, 109],
  ];

  @override
  void paint(Canvas canvas, Size size) {
    final k = size.width / 512;
    canvas.drawRRect(RRect.fromRectAndRadius(Offset.zero & size, Radius.circular(112 * k)), Paint()..color = const Color(0xFF101116));
    final paint = Paint()..color = mark;
    for (final b in _bars) {
      canvas.drawRRect(RRect.fromRectAndRadius(Rect.fromLTWH(b[0] * k, b[1] * k, 30 * k, b[2] * k), Radius.circular(15 * k)), paint);
    }
  }

  @override
  bool shouldRepaint(LogoPainter old) => old.mark != mark;
}
