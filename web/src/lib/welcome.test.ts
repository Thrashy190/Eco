import { describe, expect, it } from "vitest";
import { siteAddress, welcomeMessage } from "./welcome";

describe("welcome message", () => {
  it("holds the address, the username and the password", () => {
    const text = welcomeMessage({ username: "ana", name: "Ana María López", password: "s3cret-pass", url: "https://eco.example.com/" });
    expect(text).toContain("Hi Ana!");
    expect(text).toContain("Open: https://eco.example.com/");
    expect(text).toContain("Username: ana");
    expect(text).toContain("Password: s3cret-pass");
  });

  it("greets without a name when there is none", () => {
    expect(welcomeMessage({ username: "ana", name: "  ", password: "x", url: "u" }).split("\n")[0]).toBe("Hi! You have an account on Eco, my music server.");
  });

  it("sends the site, not the page it was made on", () => {
    expect(siteAddress("https://eco.example.com", "/")).toBe("https://eco.example.com/");
    expect(siteAddress("https://eco.example.com", "/index.html")).toBe("https://eco.example.com/");
    expect(siteAddress("http://host:8000", "/eco/")).toBe("http://host:8000/eco/");
  });
});
