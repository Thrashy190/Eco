import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { bridge, isDesktop } from "./lib/desktop";
import { queryClient } from "./lib/query";
import { loadServer, nativeDialogs, openLinksOutside, watchUpdates } from "./stores/desktop";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);

// The desktop app has its files on the computer already, and keeping an old copy would hide an update from it
if (isDesktop) {
  if (bridge()?.lite) document.documentElement.dataset.lite = ""; // styles.css
  void loadServer();
  openLinksOutside();
  nativeDialogs();
  watchUpdates();
} else if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => { /* the app works without it */ });
