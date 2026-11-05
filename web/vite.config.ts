import { createHash } from "node:crypto";
import { copyFileSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

const publicDir = join(import.meta.dirname, "public");

/**
 * Icons keep fixed names in public/, but proxies and browsers hold on to them: Cloudflare, by default, tells browsers to
 * keep images for 4 hours whatever eco says. So each build also writes icon.<hash>.ext and links to that, and a new logo
 * reaches people as soon as they reload. The version is in the file name, not a query string: it is the plainest form of
 * link for whatever fetches icons on its own, such as Safari when it makes a bookmark.
 */
const iconVersion = (() => {
  const hash = createHash("sha256");
  for (const name of readdirSync(publicDir).filter((n) => /^icon.*\.(svg|png)$/.test(n)).sort()) hash.update(readFileSync(join(publicDir, name)));
  return hash.digest("hex").slice(0, 10);
})();
const versioned = (name: string) => name.replace(/(\.[a-z]+)$/, `.${iconVersion}$1`);

function versionedIcons(): Plugin {
  return {
    name: "eco-versioned-icons",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler: (html) => html.replace(/href="(\.?\/)(icon[^"/]*\.(?:svg|png))"/g, (_, prefix: string, name: string) => `href="${prefix}${versioned(name)}"`),
    },
    closeBundle() {
      const dist = join(import.meta.dirname, "dist");
      for (const name of readdirSync(publicDir).filter((n) => /^icon.*\.(svg|png)$/.test(n))) copyFileSync(join(publicDir, name), join(dist, versioned(name)));
      const path = join(dist, "manifest.webmanifest");
      const manifest = JSON.parse(readFileSync(path, "utf8")) as { icons: { src: string }[] };
      for (const icon of manifest.icons) icon.src = versioned(icon.src);
      writeFileSync(path, JSON.stringify(manifest, null, 2));
    },
  };
}

/**
 * File names in dist/assets carry a content hash, so the service worker cannot list them by hand.
 * This fills in the list after the build, along with a cache name that changes whenever any file does.
 * It also leaves dist/.gitkeep in place: `go:embed` needs dist/ to exist even before the first build.
 */
function serviceWorkerShell(): Plugin {
  return {
    name: "eco-service-worker-shell",
    apply: "build",
    closeBundle() {
      const dist = join(import.meta.dirname, "dist");
      const assets = readdirSync(join(dist, "assets")).map((name) => `/assets/${name}`);
      const shell = ["/", "/manifest.webmanifest", `/${versioned("icon.svg")}`, `/${versioned("icon-192.png")}`, "/boot.js", ...assets];
      const version = createHash("sha256").update(assets.join() + iconVersion).digest("hex").slice(0, 12);
      const path = join(dist, "sw.js");
      writeFileSync(path, readFileSync(path, "utf8").replace("__CACHE__", `eco-shell-${version}`).replace('"__SHELL__"', JSON.stringify(shell).slice(1, -1)));
      writeFileSync(join(dist, ".gitkeep"), "");
    },
  };
}

export default defineConfig(({ command }) => ({
  base: "./",
  plugins: [tailwindcss(), react(), versionedIcons(), serviceWorkerShell()],
  define: { __LOGO_URL__: JSON.stringify(command === "build" ? `/${versioned("icon.svg")}` : "/icon.svg") },
  build: { outDir: "dist", emptyOutDir: true, chunkSizeWarningLimit: 900 },
  // `npm run dev` serves the UI with hot reload; the data still comes from a running eco
  server: { proxy: { "/api": "http://127.0.0.1:8000", "/rest": "http://127.0.0.1:8000" } },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
}));
