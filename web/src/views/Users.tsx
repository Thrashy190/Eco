// For administrators: who has an account, and adding someone. Accounts stay Navidrome's; Eco asks it to show and make them,
// which it only allows after confirming your password. The server checks on every request that you may.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { createUser, listUsers, unlockAdmin, userAvatarUrl, type Account } from "../lib/api";
import { initials } from "../lib/format";
import { generatePassword } from "../lib/password";
import { cx, ui } from "../lib/ui";
import { siteAddress, welcomeMessage, type Welcome } from "../lib/welcome";
import { BackButton, Empty, Section, Skeleton } from "../components/common";
import { Icon, Ring } from "../components/Icon";
import { toast } from "../stores/ui";

const KEY = ["users"];
const FORM = "grid gap-3 px-5 max-w-120 wide:px-8";
const SECONDARY = "tap inline-flex items-center gap-2 px-5 py-3 rounded-full bg-ghost text-text font-bold active:bg-surface-3 hover:bg-surface-3";

function Unlock() {
  const client = useQueryClient();
  const [password, setPassword] = useState("");
  const unlock = useMutation({
    mutationFn: () => unlockAdmin(password),
    onSuccess: () => void client.invalidateQueries({ queryKey: KEY }),
    onSettled: () => setPassword(""), // it does not stay on screen
  });
  const submit = (e: FormEvent) => { e.preventDefault(); unlock.mutate(); };
  return (
    <form className={FORM} onSubmit={submit}>
      <p className="text-muted">Navidrome keeps the accounts, and asks you to confirm it is you before showing them. This stays open for 15 minutes.</p>
      <input className={ui.input} type="password" placeholder="Your password" aria-label="Your password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      {unlock.error && <p className="text-danger text-[.9rem]" role="alert">{unlock.error.message}</p>}
      <div><button type="submit" className={ui.primary} disabled={unlock.isPending}>{unlock.isPending ? <Ring percent={-1} size={20} /> : <Icon name="check" size={20} />}Continue</button></div>
    </form>
  );
}

const EMPTY = { username: "", name: "", password: "" };

/** Copy text, also where the clipboard API is missing (an address that is not https). */
async function copyText(text: string, fallback: HTMLTextAreaElement | null): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    if (!fallback) return false;
    fallback.select();
    return document.execCommand("copy");
  }
}

/**
 * Right after making an account: a message to send the person, with the address, their username and their password.
 * Eco does not keep the password, so it stays on screen only until Done, or until leaving the page.
 */
function ShareAccount({ welcome, onDone }: { welcome: Welcome; onDone: () => void }) {
  const text = welcomeMessage(welcome);
  const [box, setBox] = useState<HTMLTextAreaElement | null>(null);
  const canShare = typeof navigator.share === "function";
  const copy = async () => toast((await copyText(text, box)) ? "Message copied" : "Could not copy. Select the text and copy it");
  return (
    <div className="grid gap-3 p-4 rounded-[22px] bg-surface shadow-[inset_0_0_0_1px_var(--line)]">
      <div className="grid gap-0.5">
        <b>{`${welcome.username} can sign in now`}</b>
        <span className="text-muted text-[.9rem]">Send them this message. Once you close it, Eco cannot show the password again.</span>
      </div>
      <textarea ref={setBox} readOnly value={text} rows={text.split("\n").length + 3} aria-label="Message for the new account"
        className="w-full resize-none [field-sizing:content] px-4 py-3 rounded-2xl bg-ghost text-[.92rem] leading-normal outline-none focus:shadow-[inset_0_0_0_1px_var(--accent)]"
        onFocus={(e) => e.currentTarget.select()} />
      <div className="flex flex-wrap gap-2">
        <button type="button" className={ui.primary} onClick={() => void copy()}><Icon name="check" size={20} />Copy message</button>
        {canShare && <button type="button" className={SECONDARY} onClick={() => void navigator.share({ text }).catch(() => undefined)}><Icon name="upload" size={20} />Share</button>}
        <button type="button" className={SECONDARY} onClick={onDone}>Done</button>
      </div>
    </div>
  );
}

/** The new account's password, with a button to show or hide it and one to make a random one (shown, to be read). */
function NewPassword({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="flex gap-2 items-center">
      <div className="relative flex-1 min-w-0">
        <input className={cx(ui.input, "pr-12")} type={shown ? "text" : "password"} placeholder="Their password, at least 8 characters" aria-label="Their password"
          autoComplete="new-password" autoCapitalize="none" autoCorrect="off" spellCheck={false} required minLength={8} value={value} onChange={(e) => onChange(e.target.value)} />
        <button type="button" className="tap absolute right-1 top-1/2 -translate-y-1/2 grid place-items-center size-10 rounded-full text-muted hover:text-text active:bg-surface-3"
          aria-label={shown ? "Hide password" : "Show password"} aria-pressed={shown} title={shown ? "Hide password" : "Show password"} onClick={() => setShown(!shown)}>
          <Icon name={shown ? "eyeOff" : "eye"} size={20} />
        </button>
      </div>
      <button type="button" className={cx(SECONDARY, "shrink-0 px-4")} title="Make a random password" onClick={() => { onChange(generatePassword()); setShown(true); }}>
        <Icon name="dice" size={20} />Generate
      </button>
    </div>
  );
}

function AddUser() {
  const client = useQueryClient();
  const [form, setForm] = useState(EMPTY);
  const [created, setCreated] = useState<Welcome | null>(null);
  const add = useMutation({
    mutationFn: () => createUser(form.username, form.name, form.password),
    onSuccess: () => {
      setCreated({ ...form, url: siteAddress(location.origin, location.pathname) });
      setForm(EMPTY); // the password stays only in the message to send
    },
    onSettled: () => void client.invalidateQueries({ queryKey: KEY }), // the session may have ended: the page asks again
  });
  const field = (key: keyof typeof EMPTY) => ({ value: form[key], onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm((now) => ({ ...now, [key]: e.target.value })) });
  const submit = (e: FormEvent) => { e.preventDefault(); add.mutate(); };
  if (created) {
    return <Section title="Add someone"><div className={FORM}><ShareAccount welcome={created} onDone={() => setCreated(null)} /></div></Section>;
  }
  return (
    <Section title="Add someone">
      <form className={FORM} onSubmit={submit}>
        <input className={ui.input} placeholder="Username" aria-label="Username" autoComplete="off" autoCapitalize="none" autoCorrect="off" required maxLength={64} {...field("username")} />
        <input className={ui.input} placeholder="Full name (optional)" aria-label="Full name" autoComplete="off" maxLength={120} {...field("name")} />
        <NewPassword value={form.password} onChange={(password) => setForm((now) => ({ ...now, password }))} />
        {add.error && <p className="text-danger text-[.9rem]" role="alert">{add.error.message}</p>}
        <div><button type="submit" className={ui.primary} disabled={add.isPending}>{add.isPending ? <Ring percent={-1} size={20} /> : <Icon name="plus" size={20} />}Create account</button></div>
        <p className="text-muted text-[.85rem]">They get a regular account that can sign in here and in any Subsonic app. Eco does not keep the password. To remove someone or change a password, use Navidrome.</p>
      </form>
    </Section>
  );
}

function lastSeen(date?: string): string {
  const when = date ? new Date(date) : null;
  return when && when.getFullYear() > 2000 ? `Last seen ${when.toLocaleDateString()}` : "Has not signed in yet";
}

function AccountRow({ account }: { account: Account }) {
  return (
    <li className={cx(ui.row, "cursor-default")}>
      {account.avatar
        ? <img data-art="" className={ui.avatarSmall} src={userAvatarUrl(account.username, account.avatar)} alt="" loading="lazy" />
        : <div data-art="" className={cx(ui.avatarSmall, "grid place-items-center font-extrabold bg-surface-3")}>{initials(account.name || account.username)}</div>}
      <div className={ui.text}>
        <b>{account.name && account.name !== account.username ? `${account.name} (${account.username})` : account.username}</b>
        <span>{[account.admin ? "Administrator" : "", lastSeen(account.last_seen)].filter(Boolean).join(" · ")}</span>
      </div>
    </li>
  );
}

export function Users() {
  const { data, error, isPending } = useQuery({ queryKey: KEY, queryFn: listUsers });
  return (
    <>
      <BackButton />
      <header className={ui.heroCompact}><h1>Users</h1><p>Everyone with an account on this server.</p></header>
      {isPending && <Skeleton rows={3} />}
      {error && <Empty>{error.message}</Empty>}
      {data?.locked && <Unlock />}
      {data?.users && (
        <>
          <ul className={ui.rows}>{data.users.map((account) => <AccountRow key={account.username} account={account} />)}</ul>
          <AddUser />
        </>
      )}
    </>
  );
}
