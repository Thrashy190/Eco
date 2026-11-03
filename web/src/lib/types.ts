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
  songCount: number;
  cover?: string;
}

export interface PlaylistDetail {
  id: string;
  name: string;
  cover?: string;
  songs: Song[];
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
  /** What was asked for: a catalogue ID, media:<video> or import:<hash>. */
  key: string;
  state: JobState;
  progress: number;
  title: string;
  artist: string;
  album: string;
  library_id?: string;
  kind?: MediaKind;
  media_id?: string;
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
}

export interface MediaPreview {
  id: string;
  title: string;
  channel: string;
  duration: number;
  thumbnail?: string;
  live: boolean;
  existing?: MediaItem;
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
}

export type CollectionKind = "favorites" | "playlist" | "album";

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
}

/** A song of a list imported from elsewhere. */
export interface ImportRow {
  title: string;
  artist: string;
  album?: string;
  isrc?: string;
  duration_ms?: number;
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

export interface CleanupReport {
  songs: number;
  duplicates: { keep: string; songs: DuplicateSong[] }[];
  artists: { name: string; parts: string[]; songs: number; sure: boolean }[];
  task: { running: boolean; done: number; total: number; failed: { title: string; error: string }[] | null; backup?: string };
}
