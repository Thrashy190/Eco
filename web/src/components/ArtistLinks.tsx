// An artist's name you can follow. Songs tagged with several artists get one link each.
import { useQuery } from "@tanstack/react-query";
import { Fragment } from "react";
import { Link } from "react-router";
import { getArtists } from "../lib/api";
import { knownArtists, splitArtists } from "../lib/format";
import { queryClient } from "../lib/query";
import type { Artist } from "../lib/types";
import { useOnline } from "../stores/settings";

const INDEX_KEY = ["artists-index"];
const loadIndex = () => getArtists();

function useParts(name: string): string[] {
  const online = useOnline();
  const { data } = useQuery({ queryKey: INDEX_KEY, queryFn: loadIndex, enabled: online && name.includes(", "), staleTime: 10 * 60_000 });
  return data ? splitArtists(name, knownArtists(data.map((a) => a.name))) : [name];
}

export const artistPath = (name: string, id?: string) => (id ? `/artist/${id}` : `/artist/name/${encodeURIComponent(name)}`);

/** Where a song's or album's artist name leads. A known ID is only trusted when the name is one artist. */
export function artistTargets(name: string, id?: string): { name: string; to: string }[] {
  const index = queryClient.getQueryData<Artist[]>(INDEX_KEY);
  const parts = index ? splitArtists(name, knownArtists(index.map((a) => a.name))) : [name];
  return parts.map((part) => ({ name: part, to: artistPath(part, parts.length === 1 && !name.includes(", ") ? id : undefined) }));
}

export function ArtistLinks({ name, id, className }: { name: string; id?: string; className?: string }) {
  const online = useOnline();
  const parts = useParts(name);
  if (!online || !name) return <span className={className}>{name}</span>;
  return (
    <span className={className}>
      {parts.map((part, i) => (
        <Fragment key={part}>
          {i > 0 && ", "}
          <Link className="text-inherit hover:underline focus-visible:underline" to={artistPath(part, parts.length === 1 ? id : undefined)} onClick={(e) => e.stopPropagation()}>{part}</Link>
        </Fragment>
      ))}
    </span>
  );
}
