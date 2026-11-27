// The desktop app's Update button (stores/desktop.ts): quiet while Eco is up to date, lit when a newer version is ready,
// and a ring while it downloads and installs. A browser never shows it.
import { updateLook } from "../lib/desktop";
import { cx } from "../lib/ui";
import { checkForUpdates, installUpdate, useUpdate } from "../stores/desktop";
import { toast } from "../stores/ui";
import { Icon, Ring } from "./Icon";

/** Look for a newer version, saying what was found; or install the one already found. */
export async function updateNow(): Promise<void> {
  const status = useUpdate.getState().status;
  if (status?.available) { await installUpdate(); return; }
  const found = await checkForUpdates();
  if (!found) return;
  if (found.error) toast(found.error);
  else if (found.available) await installUpdate();
  else toast(`Eco ${found.current} is the newest version`);
}

export function UpdateButton({ className }: { className?: string }) {
  const status = useUpdate((s) => s.status);
  const look = updateLook(status);
  if (look === "hidden" || !status) return null;
  const label = look === "ready" ? `Update to Eco ${status.available}`
    : look === "busy" ? (status.stage === "installing" ? "Installing the update…" : "Downloading the update…")
    : "Check for updates";
  return (
    <button type="button" className={cx("tap relative flex-none size-10 grid place-items-center rounded-full active:scale-[.94] disabled:opacity-100!", className,
      look === "ready" ? "bg-accent text-accent-ink shadow-[0_0_0_3px_rgb(var(--glow)/.25),0_0_18px_rgb(var(--glow)/.55)]" : "text-muted hover:text-text hover:bg-ghost")}
      aria-label={label} title={label} disabled={look === "busy"} onClick={() => void updateNow()}>
      {look === "busy"
        ? <Ring percent={status.stage === "downloading" && status.progress !== null ? status.progress * 100 : -1} size={20} />
        : <Icon name="download" size={20} />}
      {look === "ready" && <span className="absolute -top-0.5 -right-0.5 size-3 rounded-full bg-love shadow-[0_0_0_2px_var(--bg)] animate-glow-pulse" />}
    </button>
  );
}
