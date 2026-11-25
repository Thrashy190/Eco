import { describe, expect, it } from "vitest";
import { generatePassword, PASSWORD_ALPHABET } from "./password";

describe("generatePassword", () => {
  it("makes four groups of four readable characters", () => {
    const password = generatePassword();
    expect(password).toMatch(/^[a-z2-9]{4}(-[a-z2-9]{4}){3}$/);
    expect(password).not.toMatch(/[01lo]/); // "i" stays: with no "l", "1" or capitals it looks like nothing else
    expect(password.length).toBeGreaterThanOrEqual(8); // the server's minimum
  });

  it("favours no character", () => {
    expect(256 % PASSWORD_ALPHABET.length).toBe(0);
    expect(new Set(PASSWORD_ALPHABET).size).toBe(PASSWORD_ALPHABET.length);
  });

  it("uses the random bytes it is given", () => {
    const fixed = (bytes: Uint8Array) => bytes.map((_, i) => i);
    expect(generatePassword(fixed)).toBe("abcd-efgh-ijkm-npqr");
  });

  it("does not repeat itself", () => {
    expect(new Set(Array.from({ length: 50 }, () => generatePassword())).size).toBe(50);
  });
});
