// Settings: who you are, which server, what is on the phone, and signing out. Everything else about the look and the
// library is in Eco on the web for now.
import 'package:material_ui/material_ui.dart';

import '../api/client.dart';
import '../api/models.dart';
import '../format.dart';
import '../offline/offline.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});

  Future<void> _signOut(BuildContext context) async {
    final sure = await showDialog<bool>(
      context: context,
      builder: (dialog) => AlertDialog(
        backgroundColor: Palette.surface2,
        title: const Text('Sign out?'),
        content: const Text('Songs saved on this phone stay, for when you sign in again.'),
        actions: [
          TextButton(onPressed: () => Navigator.of(dialog).pop(false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.of(dialog).pop(true), child: const Text('Sign out')),
        ],
      ),
    );
    if (sure == true) await api.signOut();
  }

  Future<void> _clear(BuildContext context) async {
    final sure = await showDialog<bool>(
      context: context,
      builder: (dialog) => AlertDialog(
        backgroundColor: Palette.surface2,
        title: const Text('Remove everything from this phone?'),
        content: Text('${megabytes(offline.bytes)} of saved songs go. They stay in your library.'),
        actions: [
          TextButton(onPressed: () => Navigator.of(dialog).pop(false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.of(dialog).pop(true), child: const Text('Remove')),
        ],
      ),
    );
    if (sure == true) quietly(offline.removeEverything);
  }

  @override
  Widget build(BuildContext context) => Ambient(
        child: Scaffold(
          appBar: AppBar(title: const Text('Settings')),
          body: ListView(children: [
            Loader<Me>(
              cacheKey: 'me',
              load: api.me,
              builder: (context, me, _) => Column(children: [
                ListTile(
                  leading: CircleAvatar(backgroundColor: Theme.of(context).colorScheme.primary, foregroundColor: inkOn(Theme.of(context).colorScheme.primary), child: Text(initials(me.user))),
                  title: Text(me.user, style: const TextStyle(fontWeight: FontWeight.w700)),
                  subtitle: Text(me.admin ? 'Administrator' : 'Account'),
                ),
                ListTile(leading: const Icon(Icons.dns_outlined), title: const Text('Server'), subtitle: Text(api.server)),
                ListTile(leading: const Icon(Icons.info_outline_rounded), title: const Text('Eco on the server'), subtitle: Text(me.version.isEmpty ? 'unknown' : me.version)),
                if (me.catalog.isNotEmpty) ListTile(leading: const Icon(Icons.travel_explore_rounded), title: const Text('Catalogue'), subtitle: Text(me.catalog)),
              ]),
              fallback: (context, error, _) => ListTile(leading: const Icon(Icons.cloud_off_rounded), title: Text(api.user), subtitle: Text('$error')),
            ),
            const Divider(),
            ListenableBuilder(
              listenable: offline,
              builder: (context, _) => ListTile(
                leading: const Icon(Icons.download_for_offline_outlined),
                title: const Text('On this phone'),
                subtitle: Text(offline.bytes == 0 ? 'Nothing saved' : '${plural(offline.allSongs.length, 'song')} · ${megabytes(offline.bytes)}'),
                trailing: offline.bytes == 0 ? null : TextButton(onPressed: () => _clear(context), child: const Text('Remove all')),
              ),
            ),
            const Divider(),
            ListTile(leading: const Icon(Icons.logout_rounded), title: const Text('Sign out'), onTap: () => _signOut(context)),
            const Padding(
              padding: EdgeInsets.fromLTRB(20, 16, 20, 32),
              child: Text('Appearance, importing lists, adding songs from a link and library clean-up are in Eco on the web.', style: TextStyle(color: Palette.muted, fontSize: 13)),
            ),
          ]),
        ),
      );
}
