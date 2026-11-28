// A window that asks for a line or a paragraph: the name of a chapter, a note on a moment of an audiobook (askText in
// stores/ui.ts). Enter confirms a single line; a note takes several, so there it is the button.
import { useEffect, useState, type FormEvent } from "react";
import { cx, ui } from "../lib/ui";
import { useTextAsk } from "../stores/ui";
import { Icon } from "./Icon";

export function TextPrompt() {
  const { ask, answer } = useTextAsk();
  const [text, setText] = useState("");
  const [option, setOption] = useState(false);

  useEffect(() => {
    setText(ask?.initial ?? "");
    setOption(ask?.option?.on ?? false);
  }, [ask]);

  useEffect(() => {
    if (!answer) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!ask || !answer) return null;
  function close(value: { text: string; option: boolean } | null) {
    answer?.(value);
    useTextAsk.setState({ ask: null, answer: null });
  }
  const submit = (e: FormEvent) => { e.preventDefault(); close({ text: text.trim(), option }); };
  const field = ask.multiline
    ? <textarea className={cx(ui.input, "rounded-[18px] min-h-32 resize-y py-3")} aria-label={ask.label} placeholder={ask.label} autoFocus maxLength={ask.maxLength ?? 5000} value={text} onChange={(e) => setText(e.target.value)} />
    : <input className={ui.input} aria-label={ask.label} placeholder={ask.label} autoFocus maxLength={ask.maxLength ?? 120} value={text} onChange={(e) => setText(e.target.value)} />;
  return (
    <div className="fixed inset-0 z-80 grid place-items-center px-2 bg-black/55" onClick={(e) => { if (e.target === e.currentTarget) close(null); }}>
      <form role="dialog" aria-modal="true" aria-labelledby="text-ask-title" onSubmit={submit}
        className="w-full max-w-110 grid gap-3.5 p-5 animate-rise rounded-[26px] bg-surface shadow-[0_24px_60px_rgb(0_0_0/.5),inset_0_0_0_1px_var(--line)]">
        <h2 id="text-ask-title" className="font-title text-[1.25rem] font-bold tracking-[-.02em]">{ask.title}</h2>
        {field}
        {ask.option && (
          <label className="flex items-center gap-2.5 text-[.92rem] font-semibold cursor-pointer">
            <input type="checkbox" className="size-4.5 accent-(--accent)" checked={option} onChange={(e) => setOption(e.target.checked)} />
            {ask.option.label}
          </label>
        )}
        <div className="flex justify-end gap-2.5">
          <button type="button" className={ui.pill} onClick={() => close(null)}>Cancel</button>
          <button type="submit" className={cx(ui.primary, "py-2.5")} disabled={!ask.multiline && text.trim() === ""}><Icon name="check" size={20} />{ask.confirm ?? "Save"}</button>
        </div>
      </form>
    </div>
  );
}
