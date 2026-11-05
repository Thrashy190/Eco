// The orders each section of the Library offers. Recent has none: its order is the point of it.

/** What an item can be sorted by. Something it does not have goes last, and items that tie keep the order they came in. */
export interface SortKeys {
  name?: string;
  artist?: string;
  when?: number;
  year?: number;
  count?: number;
  length?: number;
}

export interface SortOption {
  id: string;
  label: string;
  by?: keyof SortKeys; // none: as the list already comes
  descending?: boolean;
}

const MEDIA: SortOption[] = [
  { id: "added", label: "Recently added", by: "when", descending: true },
  { id: "title", label: "Title", by: "name" },
  { id: "channel", label: "Channel", by: "artist" },
  { id: "length", label: "Longest", by: "length", descending: true },
];

/** The first of each is what a section starts with. */
export const SORTS: Record<string, SortOption[]> = {
  playlists: [
    { id: "name", label: "Name", by: "name" },
    { id: "changed", label: "Recently changed", by: "when", descending: true },
    { id: "songs", label: "Most songs", by: "count", descending: true },
  ],
  albums: [
    { id: "name", label: "Name", by: "name" },
    { id: "added", label: "Recently added", by: "when", descending: true },
    { id: "artist", label: "Artist", by: "artist" },
    { id: "newest", label: "Newest release", by: "year", descending: true },
    { id: "oldest", label: "Oldest release", by: "year" },
    { id: "songs", label: "Most songs", by: "count", descending: true },
  ],
  artists: [
    { id: "name", label: "Name", by: "name" },
    { id: "albums", label: "Most albums", by: "count", descending: true },
  ],
  // The server sorts these: the IDs must match orderSongs in internal/server/library.go
  songs: [
    { id: "added", label: "Recently added" },
    { id: "title", label: "Title" },
    { id: "artist", label: "Artist" },
    { id: "album", label: "Album" },
    { id: "length", label: "Longest" },
  ],
  podcast: MEDIA,
  audiobook: MEDIA,
  other: MEDIA,
  offline: [
    { id: "saved", label: "Recently saved" },
    { id: "name", label: "Name", by: "name" },
    { id: "artist", label: "Artist", by: "artist" },
  ],
};

/** The chosen order of a section, or its first one if that choice no longer exists. */
export const sortOption = (section: string, chosen?: string): SortOption => {
  const options = SORTS[section] ?? [{ id: "", label: "" }];
  return options.find((one) => one.id === chosen) ?? options[0];
};

// Ignores capitals and accents, and puts "Track 2" before "Track 10"
const text = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

const missing = (value: unknown) => value === undefined || value === "" || Number.isNaN(value);

/** A sorted copy. The list it was given is left as it was. */
export function sorted<T>(items: readonly T[], option: SortOption, keys: (item: T) => SortKeys): T[] {
  const { by, descending } = option;
  if (!by) return [...items];
  const decorated = items.map((item) => ({ item, value: keys(item)[by] }));
  decorated.sort((a, b) => {
    if (missing(a.value) || missing(b.value)) return Number(missing(a.value)) - Number(missing(b.value));
    const order = typeof a.value === "string" ? text.compare(a.value, b.value as string) : (a.value as number) - (b.value as number);
    return descending ? -order : order;
  });
  return decorated.map(({ item }) => item);
}
