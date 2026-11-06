// For administrators: who has an account, and adding someone. Accounts stay Navidrome's; Eco asks it to show and make them,
// which it only allows after confirming your password. The server checks on every request that you may.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { createUser, listUsers, unlockAdmin, userAvatarUrl, type Account } from "../lib/api";
import { initials } from "../lib/format";
import { cx, ui } from "../lib/ui";
import { BackButton, Empty, Section, Skeleton } from "../components/common";
import { Icon, Ring } from "../components/Icon";
import { toast } from "../stores/ui";

const KEY = ["users"];
const FORM = "grid gap-3 px-5 max-w-120 wide:px-8";

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

function AddUser() {
  const client = useQueryClient();
  const [form, setForm] = useState(EMPTY);
  const add = useMutation({
    mutationFn: () => createUser(form.username, form.name, form.password),
    onSuccess: () => {
      toast(`${form.username} can sign in now`);
      setForm(EMPTY); // the password does not stay on screen
    },
    onSettled: () => void client.invalidateQueries({ queryKey: KEY }), // the session may have ended: the page asks again
  });
  const field = (key: keyof typeof EMPTY) => ({ value: form[key], onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm((now) => ({ ...now, [key]: e.target.value })) });
  const submit = (e: FormEvent) => { e.preventDefault(); add.mutate(); };
  return (
    <Section title="Add someone">
      <form className={FORM} onSubmit={submit}>
        <input className={ui.input} placeholder="Username" aria-label="Username" autoComplete="off" autoCapitalize="none" autoCorrect="off" required maxLength={64} {...field("username")} />
        <input className={ui.input} placeholder="Full name (optional)" aria-label="Full name" autoComplete="off" maxLength={120} {...field("name")} />
        <input className={ui.input} type="password" placeholder="Their password, at least 8 characters" aria-label="Their password" autoComplete="new-password" required minLength={8} {...field("password")} />
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
