import { useState, type FormEvent } from "react";
import { Credit } from "../components/common";
import { Logo } from "../components/Logo";
import { signIn } from "../lib/api";
import { cx, ui } from "../lib/ui";

const FIELD = "px-4 py-3.75 rounded-card border border-transparent bg-surface-2 outline-none text-left focus:border-accent";

export function Login() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const data = new FormData(e.currentTarget);
    try {
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
        <h1 className="text-[2.6rem] font-extrabold tracking-[-.04em] wide:font-title wide:text-[3.5rem] wide:font-bold">Eco</h1>
        <p className="text-muted mb-2.5">Your music, wherever you are.</p>
        <input className={FIELD} name="user" placeholder="Username" autoComplete="username" autoCapitalize="none" autoCorrect="off" required />
        <input className={FIELD} name="password" type="password" placeholder="Password" autoComplete="current-password" required />
        <button type="submit" className={cx(ui.primary, "justify-center mt-1")} disabled={busy}>Sign in</button>
        <p className="text-danger min-h-[1.3em] m-0 text-[.9rem]" role="alert">{error}</p>
        <Credit />
      </form>
    </div>
  );
}
