// A first guess at what a YouTube video's song is, for the form that adds a song by hand. YouTube Music's songs say it
// themselves; anything else is read from the usual "Artist - Title (Official Video)". It is only a guess: the person
// sees it and corrects it before anything is saved.

export interface Guess {
  title: string;
  artists: string[];
}

// Words in brackets that describe the video, not the song: "(Official Video)", "[Lyrics]", "(Audio HD)"
const VIDEO_WORDS = /\b(official|video|videoclip|audio|lyrics?|letra|visuali[sz]er|hd|hq|4k|mv|clip|oficial|music)\b/i;

/** The title without what describes the video, keeping what describes the song ("(Remix)", "(feat. X)"). */
function withoutVideoWords(title: string): string {
  return title
    .replace(/\s*[([]([^)\]]*)[)\]]/g, (whole, inside: string) => (VIDEO_WORDS.test(inside) ? "" : whole))
    .replace(/\s*[|｜].*$/, "") // "Song | Album Out Now"
    .replace(/\s+/g, " ")
    .trim();
}

/** "Song (feat. B)", "Song ft. B": the title, and who is featured. */
function featured(title: string): { title: string; featured: string[] } {
  const found = title.match(/\s*[([]?\s*\b(?:feat\.?|ft\.?|featuring)\s+([^)\]]+)[)\]]?\s*$/i);
  if (!found) return { title, featured: [] };
  return { title: title.slice(0, found.index).trim(), featured: found[1].split(/\s*(?:,|&)\s*/).filter(Boolean) };
}

const unique = (names: string[]) => names.filter((n, i) => n && names.findIndex((m) => m.toLowerCase() === n.toLowerCase()) === i);

export function guessSong(video: { title: string; channel: string; music?: { track?: string; artists?: string[] } }): Guess {
  if (video.music?.track) return { title: video.music.track, artists: unique(video.music.artists ?? []) };
  const channel = video.channel.replace(/\s*-\s*Topic$/i, "").replace(/VEVO$/i, "").trim();
  let title = withoutVideoWords(video.title);
  let artists: string[] = [];
  const dash = title.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (dash) {
    artists = [dash[1].trim()];
    title = dash[2].trim();
  } else if (channel) {
    artists = [channel];
  }
  const feat = featured(title);
  return { title: feat.title || title, artists: unique([...artists, ...feat.featured]) };
}
