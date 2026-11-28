// The shapes the UI works with. Raw* types are what the servers send before normalising.

export type MediaKind = "podcast" | "audiobook" | "other";

export interface Song {
  id: string;
  title: string;
  artist: string;
  artistId?: string;
  album?: string;
  albumId?: string;
  duration?: number;
  cover?: string | null;
  starred?: string;
  /** Set on imported audio (podcasts, audiobooks…), which eco serves itself instead of Navidrome. */
  mediaId?: string;
  kind?: MediaKind;
  size?: number;
  /** Imported audio only: the show or book it is in, and the picture to show for it (the book's own, when it has one) */
  collection?: string;
  art?: string;
  /** Only in the player's queue: added by hand ("Play next", "Add to queue"), not part of the album or playlist. */
  queued?: boolean;
  /** Only in the player's queue: picked by Autoplay when the queue ran out. */
  auto?: boolean;
}

export interface RawSong {
  id: string;
  title: string;
  artist: string;
  artistId?: string;
  artist_id?: string;
  album?: string;
  albumId?: string;
  album_id?: string;
  duration?: number;
  coverArt?: string;
  cover?: string;
  starred?: string;
}

export interface Album {
  id: string;
  name: string;
  artist: string;
  artistId?: string;
  cover?: string;
  songCount?: number;
  year?: number;
  added?: number; // milliseconds; missing where Navidrome was not asked
}

export interface RawAlbum {
  id: string;
  name: string;
  artist: string;
  artistId?: string;
  artist_id?: string;
  coverArt?: string;
  cover?: string;
  songCount?: number;
  song_count?: number;
  year?: number;
  created?: string;
}

export interface AlbumDetail extends Album {
  songs: Song[];
}

export interface Artist {
  id: string;
  name: string;
  cover?: string;
  albumCount?: number;
}

export interface ArtistDetail {
  id: string;
  name: string;
  cover?: string;
  albums: Album[];
}

export interface Playlist {
  id: string;
  name: string;
  owner?: string;
  songCount: number;
  cover?: string;
  readonly?: boolean; // its songs cannot be changed, see openAddToPlaylist
  changed?: number; // milliseconds
}

export interface PlaylistDetail {
  id: string;
  name: string;
  owner?: string;
  cover?: string;
  readonly?: boolean;
  public?: boolean; // shown on its owner's profile
  songs: Song[];
}

/** Someone who uses Eco on this server. */
export interface Person {
  user: string;
  name: string; // the name they chose, else their username
  avatar?: number; // when their picture was set; none without one
  banner?: number; // the same for the cover of their profile
  me?: boolean;
}

/** What someone keeps from the others. Nothing hidden by default. */
export interface Privacy {
  hide_profile?: boolean;
  hide_listening?: boolean;
  hide_favorites?: boolean;
  hide_top?: boolean;
}

export interface ProfilePlaylist {
  id: string;
  name: string;
  song_count: number;
  cover?: string;
}

/** Someone's profile: what they play most this month (the order only), public playlists and newest favorites. */
export interface Profile extends Person {
  top: Song[];
  playlists: ProfilePlaylist[];
  favorites: Song[];
  favorite_count: number;
  privacy?: Privacy; // only on your own
}

/** A place in a Jam's queue: a song and who added it. */
export interface JamEntry {
  id: string;
  song: RawSong;
  added_by: string;
}

export interface JamSettings {
  name: string;
  public: boolean;
  guest_control: boolean; // everyone may pause, skip and change the queue
}

/** A Jam as the person signed in sees it. The playback is on the server's clock. */
export interface JamView extends JamSettings {
  id: string;
  host: string;
  members: string[];
  invited: string[]; // only the host's view lists them
  queue: JamEntry[];
  current: number; // the place in queue of what plays; queue.length once it has ended
  playback: { entry: string; position: number; at: number; paused: boolean };
  member: boolean;
  can_control: boolean;
  rev: number;
  server_now: number;
}

/** A Jam someone may join. */
export interface JamSummary {
  id: string;
  name: string;
  host: string;
  public: boolean;
  members: string[];
  playing?: RawSong;
  member: boolean;
  invited: boolean;
}

export interface ProfileSettings {
  display_name: string;
  privacy: Privacy;
  banner?: number;
}

/** A song in the catalogue that is not in the library yet. */
export interface ExternalSong {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  cover_url?: string;
}

/** An album in the catalogue. */
export interface ExternalAlbum {
  id: string;
  name: string;
  artist: string;
  album_type?: string;
  year?: number;
  total_tracks: number;
  cover_url?: string;
}

export interface AlbumTrack {
  id: string;
  title: string;
  artist: string;
  disc: number;
  track: number;
  duration: number;
  library?: RawSong;
}

export interface CatalogAlbumPage {
  album: ExternalAlbum;
  tracks: AlbumTrack[];
}

export interface LibrarySearch {
  songs: RawSong[];
  artists: { id: string; name: string; cover?: string; album_count: number }[];
  albums: RawAlbum[];
}

export interface ExternalSearch {
  external: ExternalSong[];
  external_albums: ExternalAlbum[];
  /** Library albums the catalogue also returned: its page says more, so the library's is not listed too. */
  hide_albums: string[];
  warning?: string;
}

export interface DiscoverResponse {
  external: ExternalSong[];
  albums: ExternalAlbum[];
  warning?: string;
}

export type JobState = "queued" | "searching" | "downloading" | "tagging" | "ready" | "error";

export interface Job {
  id: string;
  /** What was asked for: a catalogue ID, media:<video>, link:<video> (a song added by hand) or import:<hash>. */
  key: string;
  state: JobState;
  progress: number;
  title: string;
  artist: string;
  album: string;
  library_id?: string;
  kind?: MediaKind;
  media_id?: string;
  /** For a media import: the show or book it goes into, when one was chosen. */
  parent?: string;
  error?: string;
  finished_at?: number;
}

export interface HomeResponse {
  newest: RawAlbum[];
  recent: RawAlbum[];
  frequent: RawAlbum[];
  random_songs: RawSong[];
  downloads: Job[];
}

export interface MediaItem {
  id: string;
  kind: MediaKind;
  title: string;
  channel: string;
  duration: number;
  size?: number;
  added_at?: number;
  /** The show or book it is in, and its place in a book */
  parent?: string;
  part?: number;
  added_by?: string;
  description?: string;
  published?: number;
  /** The name of its picture in its folder, when it has one (served at /api/media/{id}/thumb). */
  thumb?: string;
}

/** A podcast show or an audiobook, as /api/shows and /api/books describe one. */
export interface Collection {
  id: string;
  kind: "podcast" | "audiobook";
  title: string;
  author: string;
  narrator?: string;
  series?: string;
  series_index?: number;
  description?: string;
  created_by?: string;
  created_at: number;
  updated_at: number;
  cover?: number;
  count: number;
  duration: number;
  latest: number;
  thumb?: string;
  can_edit: boolean;
  /** Books that go with this one, kept on both sides by the server. */
  related?: string[];
}

export type CollectionEdit = Pick<Collection, "title" | "author" | "narrator" | "series" | "series_index" | "description" | "related">;

/** A bookmark, or a note when it has text. Private unless shared. */
export interface Mark {
  id: string;
  item: string;
  at: number;
  note?: string;
  shared?: boolean;
  created: number;
  updated: number;
}

/** Someone else's shared note. */
export interface SharedMark extends Mark {
  user: string;
  name?: string;
}

export interface ContinueItem {
  item: MediaItem;
  collection?: Omit<Collection, "count" | "duration" | "latest" | "thumb" | "can_edit">;
  progress: { position: number; finished?: boolean; at: number };
}

export interface MediaPreview {
  id: string;
  title: string;
  channel: string;
  duration: number;
  thumbnail?: string;
  live: boolean;
  existing?: MediaItem;
  /** How many chapters its uploader marked (they come with it), and when it was published */
  chapters?: number;
  published?: number;
  /** What YouTube Music says the song is, when the video is one of its songs. */
  music?: { track: string; artists?: string[]; album?: string; year?: number };
}

/** A song added by hand from a YouTube link (POST /api/songs/add). */
export interface AddSongRequest {
  url: string;
  title: string;
  artists: string[];
  track: number;
  disc: number;
  /** One of: an album in the library, one in the catalogue, or a new one. */
  album: { library: string } | { catalog: string } | { name: string; artists: string[]; date: string; cover: "video" | "upload" | ""; picture?: string };
}

/** spotify_album: entries saved when the catalogue was Spotify, whose IDs mean nothing to another catalogue. */
export type EntryType = "playlist" | "album" | "artist" | "song" | "catalog_album" | "spotify_album";

/** One row of the library's Recent view. */
export interface LibraryEntry {
  type: EntryType;
  id: string;
  name: string;
  subtitle?: string;
  cover?: string;
  cover_url?: string;
  artist?: string;
  artist_id?: string;
  album?: string;
  album_id?: string;
  duration?: number;
  at?: number;
}

export interface LibraryState {
  recents: LibraryEntry[];
  pins: LibraryEntry[];
  /** Playlist ID → when its picture was set. */
  covers: Record<string, number>;
  /** When the profile picture was set; none if there is no picture. */
  avatar?: number;
}

export type CollectionKind = "favorites" | "playlist" | "album" | "podcast" | "book";

/** What "Download" remembers about a favorites list, a playlist or an album. */
export interface CollectionSpec {
  id: string;
  kind: CollectionKind;
  title: string;
  subtitle: string;
}

export interface CollectionRecord extends CollectionSpec {
  songIds: string[];
  complete: boolean;
  savedAt: number;
  songs?: Song[]; // what to download, kept until every song has arrived so it can resume after the app closes
  paused?: boolean; // the download was stopped: what arrived stays, and nothing more is fetched until asked
}

/** A song of a list imported from elsewhere. */
export interface ImportRow {
  title: string;
  artist: string;
  album?: string;
  isrc?: string;
  duration_ms?: number;
  added_at?: string; // when it was liked or added to the list, when the file says
}

export interface ImportedList {
  name: string;
  rows: ImportRow[];
  owned: number;
}

export interface ImportSummary {
  id: string;
  name: string;
  playlist_id?: string;
  favorites?: boolean; // its songs go to the favourites, not to a playlist
  total: number;
  owned: number;
  updated_at: number;
}

export interface ImportDetail extends ImportSummary {
  rows: (ImportRow & { key: string; library?: RawSong })[];
}

export interface DuplicateSong {
  id: string;
  title: string;
  artist: string;
  album: string;
  cover?: string;
  duration: number;
  size: number;
  starred: boolean;
}

export type AlbumProblem = "no_cover" | "no_album" | "no_artist" | "no_year" | "no_tracks" | "same_track" | "video_title" | "split";

export interface AlbumIssue {
  id: string;
  name: string;
  artist: string;
  year?: number;
  cover?: string;
  songs: number;
  problems: { code: AlbumProblem; text: string }[];
}

export interface CleanupReport {
  songs: number;
  duplicates: { keep: string; songs: DuplicateSong[] }[];
  artists: { name: string; parts: string[]; songs: number; sure: boolean }[];
  /** Albums with no cover or doubtful tags. Older servers do not send it. */
  albums?: AlbumIssue[];
  task: CleanupTask;
  /** Songs with no genre, and on how many albums. Older servers do not send it. */
  genres?: { songs: number; albums: number };
}

/** A clean-up that rewrites tags. Only one runs at a time. */
export interface CleanupTask {
  /** Older servers only had the artist clean-up, and do not say. */
  kind?: "artists" | "genres";
  running: boolean;
  done: number;
  total: number;
  failed: { title: string; error: string }[] | null;
  backup?: string;
  /** Songs the catalogue knows no genre for. */
  unknown?: number;
  stopped?: boolean;
}

// ---- Statistics (/api/stats) ----
export interface StatsTotals {
  plays: number;
  /** Songs' lengths added up: Eco knows a play counted, not how much of it was heard. */
  minutes: number;
  songs: number;
  artists: number;
  albums: number;
  genres: number;
  listeners: number;
  first_listens: number;
  active_days: number;
  no_genre: number;
}

export interface StatsRanked { id?: string; name: string; artist?: string; cover?: string; plays: number; minutes: number; listeners: number }
export interface StatsBucket { start: string; plays: number; minutes: number }
export interface StatsListener { user: string; plays: number; minutes: number; songs: number; top_song?: string; top_artist?: string; top_genre?: string; last: string }
export interface StatsRecent { at: string; user: string; id: string; title: string; artist: string; cover?: string }

export interface StatsSummary {
  totals: StatsTotals;
  previous?: StatsTotals;
  step: "day" | "week" | "month";
  timeline: StatsBucket[];
  hours: number[];
  /** Monday first. */
  weekdays: number[];
  songs: StatsRanked[];
  artists: StatsRanked[];
  albums: StatsRanked[];
  genres: StatsRanked[];
  /** Only when the numbers are about everyone. */
  listeners?: StatsListener[];
  recent: StatsRecent[];
  /** The first play Eco counted itself. */
  since?: string;
  with_history: boolean;
}

export interface LibraryStats {
  songs: number;
  albums: number;
  artists: number;
  hours: number;
  with_genre: number;
  /** The genres with most songs: `plays` holds how many songs. */
  genres: StatsRanked[];
}

export interface StatsResponse {
  admin: boolean;
  /** Whose numbers these are; empty for everyone. */
  user: string;
  summary: StatsSummary;
  /** Everyone who has played something, for an administrator to choose from. */
  people?: string[];
  library?: LibraryStats;
}
