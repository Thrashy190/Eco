// Reading YouTube links in the browser, before the server is asked. The server checks them again (youtubeURL,
// youtubePlaylist): these only decide what to offer.

/** The video a YouTube link names, or "". */
export const videoIdOf = (link: string) => /(?:[?&]v=|youtu\.be\/|\/shorts\/)([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])/.exec(link)?.[1] ?? "";

/** Whether a YouTube link names a playlist: a playlist page, or a video played from one. */
export const isPlaylistLink = (link: string) => /^https?:\/\/([a-z]+\.)?(youtube\.com|youtu\.be)\/\S*[?&]list=[A-Za-z0-9_-]{10,}/i.test(link.trim());
