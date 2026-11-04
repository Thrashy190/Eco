// How a download to the device decides what an answer means and when to try again. No browser storage here, so it can be tested.

const DELAYS = [2, 5, 15];

/** How long to wait, in milliseconds, after a download failed this many times. */
export const retryDelay = (tries: number) => DELAYS[Math.min(Math.max(tries, 0), DELAYS.length - 1)] * 1000;

export type StreamProblem = "gone" | "read-body" | "retry" | null;

/**
 * What the answer to asking for a song's audio means. Navidrome reports failures with HTTP 200 and a JSON body, so the
 * status alone would save that error message as if it were the song.
 */
export function streamProblem(status: number, contentType: string): StreamProblem {
  if (status === 404 || status === 410) return "gone";
  if (status < 200 || status >= 300) return "retry";
  if (/json/i.test(contentType)) return "read-body";
  if (/^text\/|xml|html/i.test(contentType)) return "retry"; // a proxy's error page: the song may still be there
  return null;
}

/** Whether a Subsonic error body says the song does not exist. Any other error, like a bad sign-in, says nothing about the song. */
export function saysNotFound(body: unknown): boolean {
  const answer = (body as { "subsonic-response"?: { error?: { code?: number } } } | null)?.["subsonic-response"];
  return answer?.error?.code === 70;
}

/** A download shorter than announced was cut off. A compressed answer announces a different size, so it cannot be compared. */
export const cutShort = (received: number, announced: number, encoded: boolean) => received === 0 || (!encoded && announced > 0 && received < announced);
