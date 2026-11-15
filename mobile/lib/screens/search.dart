// Search: the library answers at once; the catalogue, which is slower and allows few requests, is asked once the
// typing stops. Songs you do not have yet can be fetched with Get. With no connection, it searches the phone.
import 'dart:async';

import 'package:material_ui/material_ui.dart';

import '../api/client.dart';
import '../api/models.dart';
import '../format.dart';
import '../offline/offline.dart';
import '../ui/widgets.dart';

class SearchScreen extends StatefulWidget {
  const SearchScreen({super.key});

  @override
  State<SearchScreen> createState() => _SearchScreenState();
}

class _SearchScreenState extends State<SearchScreen> {
  final _text = TextEditingController();
  Timer? _typing;
  Timer? _settling;
  String _query = '';
  String _settled = '';

  LibrarySearch? _library;
  Object? _libraryError;
  ExternalSearch? _catalog;
  Object? _catalogError;
  bool _lookingInCatalog = false;

  @override
  void dispose() {
    _typing?.cancel();
    _settling?.cancel();
    _text.dispose();
    super.dispose();
  }

  void _changed(String value) {
    _typing?.cancel();
    _settling?.cancel();
    _typing = Timer(const Duration(milliseconds: 250), () => _searchLibrary(value.trim()));
    _settling = Timer(const Duration(milliseconds: 700), () => _searchCatalog(value.trim()));
    setState(() {});
  }

  Future<void> _searchLibrary(String q) async {
    setState(() => _query = q);
    if (q.length < 2) return;
    try {
      final result = await api.search(q);
      if (mounted && q == _query) setState(() { _library = result; _libraryError = null; });
    } catch (e) {
      if (mounted && q == _query) setState(() => _libraryError = e);
    }
  }

  Future<void> _searchCatalog(String q) async {
    _settled = q;
    if (q.length < 2 || isYoutubeLink(q)) return;
    setState(() { _lookingInCatalog = true; _catalog = null; _catalogError = null; });
    try {
      final result = await api.searchExternal(q);
      if (mounted && q == _settled) setState(() => _catalog = result);
    } catch (e) {
      if (mounted && q == _settled) setState(() => _catalogError = e);
    } finally {
      if (mounted && q == _settled) setState(() => _lookingInCatalog = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final top = MediaQuery.of(context).padding.top;
    return Column(children: [
      Padding(
        padding: EdgeInsets.fromLTRB(14, top + 10, 14, 4),
        child: TextField(
          controller: _text,
          onChanged: _changed,
          textInputAction: TextInputAction.search,
          autocorrect: false,
          decoration: InputDecoration(
            hintText: 'Songs, artists, albums',
            prefixIcon: const Icon(Icons.search_rounded),
            suffixIcon: _text.text.isEmpty ? null : IconButton(icon: const Icon(Icons.close_rounded), tooltip: 'Clear', onPressed: () { _text.clear(); _changed(''); }),
            border: OutlineInputBorder(borderRadius: BorderRadius.circular(99), borderSide: BorderSide.none),
            focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(99), borderSide: BorderSide(color: Theme.of(context).colorScheme.primary)),
          ),
        ),
      ),
      Expanded(child: _body(context)),
    ]);
  }

  Widget _body(BuildContext context) {
    final q = _query;
    if (q.length < 2) {
      return const SingleChildScrollView(child: EmptyState(
        title: 'Search everything',
        message: 'Your library first, then songs and albums you do not have yet.',
        icon: Icons.manage_search_rounded,
      ));
    }
    if (isYoutubeLink(q)) {
      return const SingleChildScrollView(child: EmptyState(
        title: 'Links are for the web app, for now',
        message: 'Importing a podcast or adding a song from a YouTube link is in Eco on the web.',
        icon: Icons.link_rounded,
      ));
    }
    if (_libraryError != null && _library == null) return _SavedResults(q, _libraryError!);
    final library = _library;
    if (library == null) return const Center(child: CircularProgressIndicator());

    final catalog = _catalog;
    final hidden = catalog?.hideAlbums ?? const <String>{};
    final albums = library.albums.where((a) => !hidden.contains(a.id)).toList();
    final externalAlbums = catalog?.albums ?? const <ExternalAlbum>[];
    final external = catalog?.external ?? const <ExternalSong>[];
    final warning = catalog?.warning ?? (_catalogError != null ? 'Could not search beyond your library: $_catalogError' : null);
    final looking = _lookingInCatalog || _settled != q;
    final nothing = library.artists.isEmpty && albums.isEmpty && externalAlbums.isEmpty && library.songs.isEmpty && external.isEmpty && warning == null && !looking;

    return ListView(padding: const EdgeInsets.only(bottom: 24), children: [
      if (nothing) EmptyState(title: 'Nothing found', message: 'Nothing matches “$q”.', icon: Icons.search_off_rounded),
      if (library.artists.isNotEmpty) Section(title: 'Artists', child: Shelf(height: 190, children: [for (final a in library.artists) ArtistCard(a)])),
      if (albums.isNotEmpty || externalAlbums.isNotEmpty)
        Section(title: 'Albums', child: Shelf(children: [
          for (final a in albums) AlbumCard(a),
          for (final a in externalAlbums) ExternalAlbumCard(a),
        ])),
      if (library.songs.isNotEmpty) Section(title: 'In your library', child: SongList(library.songs)),
      if (external.isNotEmpty)
        Section(
          title: 'Not in your library yet',
          child: Column(children: [for (final e in external) ExternalTile(e)]),
        ),
      if (looking) const Note('Looking in the catalogue…'),
      if (warning != null) Note(warning),
    ]);
  }
}

/// With no connection, search looks only through what is saved on the phone.
class _SavedResults extends StatelessWidget {
  final String query;
  final Object error;
  const _SavedResults(this.query, this.error);

  @override
  Widget build(BuildContext context) {
    final needle = query.toLowerCase();
    final songs = offline.allSongs.where((s) => [s.title, s.artist, s.album ?? ''].any((t) => t.toLowerCase().contains(needle))).toList();
    return ListView(children: [
      Note('$error. Searching what is saved on this phone.'),
      if (songs.isEmpty)
        EmptyState(title: 'Nothing saved matches', message: '“$query” is not on this phone.', icon: Icons.cloud_off_rounded)
      else
        Section(title: 'Saved on this phone', child: SongList(songs)),
    ]);
  }
}
