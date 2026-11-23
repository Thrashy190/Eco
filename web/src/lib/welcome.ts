// The message an administrator sends someone whose account they just made: where Eco is and how to sign in. Eco does
// not keep the password, so this is the only moment it can be written down for them.

export interface Welcome {
  username: string;
  name?: string;
  password: string;
  url: string; // the address this Eco is open at
}

/** The address to send: the page's own, without the screen it is on (hash routes start at /). */
export const siteAddress = (origin: string, path = "/") => origin + (path.endsWith("/") ? path : path.replace(/[^/]*$/, ""));

export function welcomeMessage({ username, name, password, url }: Welcome): string {
  const first = name?.trim().split(/\s+/)[0];
  return [
    `Hi${first ? ` ${first}` : ""}! You have an account on Eco, my music server.`,
    "",
    `Open: ${url}`,
    `Username: ${username}`,
    `Password: ${password}`,
    "",
    "On a phone, open the link and choose Add to Home Screen to install it as an app.",
  ].join("\n");
}
