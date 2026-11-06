// The administrator confirming their password, when an action needs Navidrome's own API (see withPassword in
// stores/admin.ts). The password goes to the server once, which opens a session with it and forgets it.
import { useEffect, useState, type FormEvent } from "react";
import { HttpError, unlockAdmin } from "../lib/api";
import { cx, ui } from "../lib/ui";
import { usePasswordAsk } from "../stores/admin";
import { Icon, Ring } from "./Icon";

export function PasswordPrompt() {
  const { reason, answer } = usePasswordAsk();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const close = (unlocked: boolean) => {
    answer?.(unlocked);
    usePasswordAsk.setState({ reason: "", answer: null });
    setPassword("");
    setError("");
    setBusy(false);
  };

  useEffect(() => {
    if (!answer) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!answer) return null;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await unlockAdmin(password);
      close(true);
    } catch (err) {
      setError(err instanceof HttpError && err.status === 403 ? "That is not your password" : (err as Error).message);
      setPassword(""); // it does not stay on screen
      setBusy(false);
    }
  };
  return (
    <div className="fixed inset-0 z-80 grid place-items-center px-2 bg-black/55" onClick={(e) => { if (e.target === e.currentTarget) close(false); }}>
      <form role="dialog" aria-modal="true" aria-labelledby="password-title" onSubmit={(e) => void submit(e)}
        className="w-full max-w-100 grid gap-3.5 p-5 animate-rise rounded-[26px] bg-surface shadow-[0_24px_60px_rgb(0_0_0/.5),inset_0_0_0_1px_var(--line)]">
        <h2 id="password-title" className="font-title text-[1.25rem] font-bold tracking-[-.02em]">Confirm it is you</h2>
        <p className="text-muted text-[.92rem]">{reason}</p>
        <input className={ui.input} type="password" placeholder="Your password" aria-label="Your password" autoComplete="current-password" autoFocus required
          value={password} onChange={(e) => setPassword(e.target.value)} />
        {error !== "" && <p className="text-danger text-[.9rem]" role="alert">{error}</p>}
        <div className="flex justify-end gap-2.5">
          <button type="button" className={ui.pill} onClick={() => close(false)}>Cancel</button>
          <button type="submit" className={cx(ui.primary, "py-2.5")} disabled={busy}>{busy ? <Ring percent={-1} size={20} /> : <Icon name="check" size={20} />}Continue</button>
        </div>
      </form>
    </div>
  );
}
