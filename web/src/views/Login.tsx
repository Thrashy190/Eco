import { useEffect, useState, type FormEvent } from "react";
import { Credit } from "../components/common";
import { Logo } from "../components/Logo";
import { signIn } from "../lib/api";
import { isDesktop, serverHost } from "../lib/desktop";
import { cx, ui } from "../lib/ui";
import { chooseServer, useServer } from "../stores/desktop";
import * as offline from "../stores/offline";

const FIELD = "px-5 py-3.5 rounded-full border border-transparent bg-ghost outline-none text-left focus:border-accent";

/** Songs saved on this computer are the saved server's: signing in elsewhere would show them as someone else's music. */
async function keepsSongsFrom(typed: string): Promise<string | null> {
  const saved = useServer.getState().address;
  if (!saved || serverHost(saved) === serverHost(typed)) return null;
  await offline.init();
  return offline.count() > 0 || offline.collectionList().length > 0 ? serverHost(saved) : null;
}

export function Login() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const saved = useServer((s) => s.address);
  const [server, setServer] = useState("");
  // The saved server arrives a moment after the page opens (loadServer in main.tsx)
  useEffect(() => { if (saved) setServer((typed) => typed || saved.replace(/\/$/, "")); }, [saved]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const data = new FormData(e.currentTarget);
    try {
      if (isDesktop) {
        const holder = await keepsSongsFrom(server);
        if (holder) throw new Error(`This computer holds songs saved from ${holder}. Sign in there and use Settings, Server, Change to choose another server.`);
        await chooseServer(server);
      }
      await signIn(String(data.get("user")), String(data.get("password")));
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="min-h-dvh grid place-items-center p-6 bg-[radial-gradient(90%_60%_at_50%_0%,rgb(var(--glow)/.2),transparent_70%)]">
      <form className="w-full max-w-90 grid gap-3 justify-items-stretch text-center" onSubmit={submit}>
        <Logo size={72} className="mx-auto mb-1" />
        <h1 className="font-title text-[3rem] font-bold tracking-[-.04em] wide:text-[3.5rem]">Eco</h1>
        <p className="text-muted mb-2.5">Your music, wherever you are.</p>
        {isDesktop && (
          <input className={FIELD} name="server" value={server} onChange={(e) => setServer(e.target.value)} placeholder="Server, like eco.example.com"
            aria-label="Address of your Eco server" inputMode="url" autoComplete="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} required />
        )}
        <input className={FIELD} name="user" placeholder="Username" autoComplete="username" autoCapitalize="none" autoCorrect="off" required />
        <input className={FIELD} name="password" type="password" placeholder="Password" autoComplete="current-password" required />
        <button type="submit" className={cx(ui.primary, "justify-center mt-1")} disabled={busy}>Sign in</button>
        <p className="text-danger min-h-[1.3em] m-0 text-[.9rem]" role="alert">{error}</p>
        <Credit />
      </form>
    </div>
  );
}
