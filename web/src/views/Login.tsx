import { useState, type FormEvent } from "react";
import { signIn } from "../lib/api";

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
    <div className="login-wrap">
      <form className="login" onSubmit={submit}>
        <img src={__LOGO_URL__} alt="" width="72" height="72" />
        <h1>Eco</h1>
        <p>Your music, wherever you are.</p>
        <input name="user" placeholder="Username" autoComplete="username" autoCapitalize="none" autoCorrect="off" required />
        <input name="password" type="password" placeholder="Password" autoComplete="current-password" required />
        <button type="submit" className="primary" disabled={busy}>Sign in</button>
        <p className="error" role="alert">{error}</p>
      </form>
    </div>
  );
}
