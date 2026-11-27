// What the people on this server play right now, while a screen that shows it is open. One stream serves every such
// screen; it closes when the last one goes.
import { useEffect } from "react";
import { create } from "zustand";
import { listeningEventsUrl } from "../lib/api";
import { nowPlaying, type Heard, type JamRef, type NowPlaying } from "../lib/listening";

const useListening = create<{ now: Record<string, NowPlaying>; jams: Record<string, JamRef> }>(() => ({ now: {}, jams: {} }));

let stream: EventSource | null = null;
let screens = 0;

function heard(list: Heard[], replace: boolean): void {
  const at = Date.now();
  useListening.setState((s) => {
    const now = replace ? {} : { ...s.now };
    const jams = replace ? {} : { ...s.jams };
    for (const one of list) {
      const user = one.user.toLowerCase();
      const playing = nowPlaying(one, at);
      if (playing) now[user] = playing;
      else delete now[user];
      if (one.jam) jams[user] = one.jam;
      else delete jams[user];
    }
    return { now, jams };
  });
}

function open(): void {
  stream = new EventSource(listeningEventsUrl());
  stream.addEventListener("snapshot", (e) => heard(JSON.parse((e as MessageEvent<string>).data) as Heard[], true));
  stream.addEventListener("listening", (e) => heard([JSON.parse((e as MessageEvent<string>).data) as Heard], false));
}

/** Keeps what people play up to date while the calling screen is open. */
export function useLiveListening(): void {
  useEffect(() => {
    if (screens++ === 0) open();
    return () => {
      if (--screens === 0) { stream?.close(); stream = null; }
    };
  }, []);
}

/** The Jam this person is in, when you may see it, or null. */
export const useJamOf = (user: string) => useListening((s) => s.jams[user.toLowerCase()] ?? null);

/** What this person plays now, or null. */
export const useNowPlaying = (user: string) => useListening((s) => s.now[user.toLowerCase()] ?? null);
