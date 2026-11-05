// For administrators: who has an account, and adding someone. Accounts stay Navidrome's; Eco asks it to make them. The
// server checks on every request that you may.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { createUser, listUsers, userAvatarUrl } from "../lib/api";
import { initials } from "../lib/format";
import { cx, ui } from "../lib/ui";
import { BackButton, Empty, Section, Skeleton } from "../components/common";
import { Icon, Ring } from "../components/Icon";
import { toast } from "../stores/ui";

const EMPTY = { username: "", name: "", password: "", adminPassword: "" };

function AddUser() {
  const client = useQueryClient();
  const [form, setForm] = useState(EMPTY);
  const add = useMutation({
    mutationFn: () => createUser(form.username, form.name, form.password, form.adminPassword),
    onSuccess: () => {
      toast(`${form.username} can sign in now`);
      setForm(EMPTY); // passwords do not stay on screen
      void client.invalidateQueries({ queryKey: ["users"] });
    },
    onError: () => setForm((now) => ({ ...now, adminPassword: "" })),
  });
  const field = (key: keyof typeof EMPTY) => ({ value: form[key], onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm((now) => ({ ...now, [key]: e.target.value })) });
  const submit = (e: FormEvent) => { e.preventDefault(); add.mutate(); };
  const box = cx(ui.input, "wide:bg-ghost");
  return (
    <Section title="Add someone">
      <form className="grid gap-3 px-5 max-w-120 wide:px-8" onSubmit={submit}>
        <input className={box} placeholder="Username" aria-label="Username" autoComplete="off" autoCapitalize="none" autoCorrect="off" required maxLength={64} {...field("username")} />
        <input className={box} placeholder="Full name (optional)" aria-label="Full name" autoComplete="off" maxLength={120} {...field("name")} />
        <input className={box} type="password" placeholder="Their password, at least 8 characters" aria-label="Their password" autoComplete="new-password" required minLength={8} {...field("password")} />
        <input className={box} type="password" placeholder="Your password, to confirm it is you" aria-label="Your password" autoComplete="current-password" required {...field("adminPassword")} />
        {add.error && <p className="text-danger text-[.9rem]" role="alert">{add.error.message}</p>}
        <div><button type="submit" className={ui.primary} disabled={add.isPending}>{add.isPending ? <Ring percent={-1} size={20} /> : <Icon name="plus" size={20} />}Create account</button></div>
        <p className="text-muted text-[.85rem]">They get a regular account that can sign in here and in any Subsonic app. Eco does not keep either password. To remove someone or change a password, use Navidrome.</p>
      </form>
    </Section>
  );
}

export function Users() {
  const { data: users, error, isPending } = useQuery({ queryKey: ["users"], queryFn: listUsers });
  return (
    <>
      <BackButton />
      <header className={ui.heroCompact}><h1>Users</h1><p>Everyone with an account on this server.</p></header>
      {isPending && <Skeleton rows={3} />}
      {error && <Empty>{error.message}</Empty>}
      <ul className={ui.rows}>
        {users?.map((user) => (
          <li key={user.username} className={cx(ui.row, "cursor-default")}>
            {user.avatar
              ? <img data-art="" className={ui.avatarSmall} src={userAvatarUrl(user.username, user.avatar)} alt="" loading="lazy" />
              : <div data-art="" className={cx(ui.avatarSmall, "grid place-items-center font-extrabold bg-surface-3")}>{initials(user.username)}</div>}
            <div className={ui.text}><b>{user.username}</b><span>{user.admin ? "Administrator" : "Regular account"}</span></div>
          </li>
        ))}
      </ul>
      <AddUser />
    </>
  );
}
