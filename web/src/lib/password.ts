// Passwords for new accounts. They are read off a screen and typed on a phone, so the alphabet leaves out characters
// that look alike (0/O, 1/l/I) and capitals, and the groups make them easy to copy by eye.

export const PASSWORD_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";
const GROUPS = 4;
const GROUP_LENGTH = 4;

/** A random password like "k7mq-x3pa-9rtd-h2wn": 16 characters from 32, 80 bits. */
export function generatePassword(random: (bytes: Uint8Array<ArrayBuffer>) => Uint8Array = (bytes) => crypto.getRandomValues(bytes)): string {
  // 32 divides 256, so taking each byte modulo the alphabet's length favours no character.
  const bytes = random(new Uint8Array(GROUPS * GROUP_LENGTH));
  const chars = Array.from(bytes, (byte) => PASSWORD_ALPHABET[byte % PASSWORD_ALPHABET.length]);
  const groups: string[] = [];
  for (let i = 0; i < chars.length; i += GROUP_LENGTH) groups.push(chars.slice(i, i + GROUP_LENGTH).join(""));
  return groups.join("-");
}
