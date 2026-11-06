// Tailwind classes more than one screen shares. Unprefixed classes are every screen, with the phone in mind; `wide:` is a
// tablet or a computer, `roomy:` a screen with space for the deck beside the page (see lib/media.ts), and `@2xl:` and up
// look at the width of the page itself, which depends on whether the deck is open.

export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

const pressable = "tap active:scale-[.97]";
const truncated = "[&>b]:truncate [&>span]:truncate";
const title = "[&_h1]:font-title [&_h1]:font-bold [&_h1]:leading-[1.03] [&_h1]:tracking-[-.04em] [&_h1]:text-balance";

export const ui = {
  // ---- Page structure ----
  hero: `rise px-5 pt-3 pb-4 ${title} [&_h1]:text-[clamp(2.4rem,11cqi,3rem)] [&_p]:mt-1.5 [&_p]:min-h-[1.2em] [&_p]:text-muted wide:px-8 wide:pt-4 wide:pb-5 wide:[&_h1]:text-[clamp(2.6rem,5.2cqi,4.75rem)] wide:[&_p]:mt-2`,
  heroCompact: `rise px-5 pt-3 pb-2 ${title} [&_h1]:text-[2.2rem] [&_p]:mt-1 [&_p]:min-h-[1.2em] [&_p]:text-muted wide:px-8 wide:pt-2 wide:pb-3 wide:[&_h1]:text-[clamp(2.2rem,4cqi,3.25rem)]`,
  block: "rise mt-8 nth-of-type-2:[--d:60ms] nth-of-type-3:[--d:120ms] nth-of-type-[n+4]:[--d:180ms] wide:mt-10",
  blockHead: "flex items-center justify-between gap-3 px-5 pb-3 [&_h2]:font-title [&_h2]:text-[1.4rem] [&_h2]:font-semibold [&_h2]:tracking-[-.025em] wide:px-8 wide:pb-4 wide:[&_h2]:text-[1.6rem]",
  empty: "text-muted text-center px-6 py-7",
  note: "text-muted px-5 py-3 text-left text-[.9rem] wide:px-8",
  count: "text-muted text-[.85rem] px-5 pt-1 pb-2 wide:px-8",
  welcome: "rise grid gap-2.5 justify-items-center text-center px-7 py-14 [&_h2]:font-title [&_h2]:text-[1.7rem] [&_h2]:font-semibold [&_h2]:tracking-[-.025em] [&_p]:text-muted [&_p]:max-w-[36ch] wide:[&_h2]:text-[2rem]",
  banner: "flex items-center gap-2.5 mx-4 mt-3 px-3.5 py-3 rounded-card bg-glass-strong text-muted text-[.9rem] wide:mx-8 wide:mt-4",
  actions: "rise flex flex-wrap items-center gap-2.5 px-5 py-3.5 wide:px-8 wide:py-4",
  actionsPlain: "flex flex-wrap items-center gap-2.5 px-3.5 pt-1.5 pb-2.5",
  narrow: "max-w-190",
  more: "h-px",

  // ---- Buttons ----
  primary: `relative overflow-hidden inline-flex items-center gap-2 px-5.5 py-3 rounded-full bg-accent text-accent-ink font-extrabold ${pressable} hover:brightness-110 hover:shadow-[0_8px_24px_rgb(var(--glow)/.3)]`,
  pill: "tap inline-flex items-center gap-1.75 px-3.5 py-2 rounded-full bg-ghost font-bold text-[.85rem] whitespace-nowrap active:bg-surface-3 hover:bg-surface-3 data-on:bg-[rgb(var(--glow)/.18)] data-on:text-accent",
  iconButton: "tap size-10 grid place-items-center rounded-full text-muted flex-none active:bg-surface-2 hover:text-text hover:bg-ghost",
  round: "tap size-9 flex-none grid place-items-center rounded-full bg-ghost text-text active:scale-[.94] hover:bg-surface-3",
  back: "tap sticky top-[calc(var(--safe-top)+8px)] z-20 ml-3 mt-1 -mb-1 size-10 grid place-items-center rounded-full bg-glass-strong backdrop-blur-xl text-text shadow-[0_6px_18px_rgb(0_0_0/.25),inset_0_0_0_1px_var(--line)] active:scale-[.94] wide:hidden",
  dangerLink: "block mx-auto my-6 p-2.5 text-danger font-semibold",
  get: "tap relative overflow-hidden inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-accent text-accent-ink font-extrabold text-[.85rem] active:scale-[.96] disabled:bg-surface-2 disabled:text-muted disabled:opacity-100",
  getRetry: "tap inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-transparent text-danger font-extrabold text-[.85rem] shadow-[inset_0_0_0_1.5px_var(--danger)] active:scale-[.96]",
  chip: "px-4 py-2.25 rounded-full bg-ghost font-bold text-[.9rem] transition-[background-color,color,transform] duration-150 active:scale-95 aria-pressed:bg-accent aria-pressed:text-accent-ink hover:not-aria-pressed:bg-surface-3",
  link: "text-accent cursor-pointer",

  // ---- Pictures. Each one is a whole size: pick one, never two ----
  cover: "size-12 rounded-[10px] object-cover bg-surface-2 flex-none",
  coverBig: "w-full h-auto aspect-square rounded-big object-cover bg-surface-2 flex-none",
  coverHuge: "w-[min(72vw,280px)] h-auto aspect-square rounded-big object-cover bg-surface-2 flex-none shadow-[0_24px_60px_rgb(0_0_0/.4)] wide:w-[clamp(160px,24cqi,220px)] @4xl:w-full",
  noCover: "grid place-items-center text-muted bg-[linear-gradient(135deg,var(--surface-2),var(--surface-3))]",
  favCover: "grid place-items-center text-white bg-[linear-gradient(135deg,#6a4cff,#c86bff_55%,#ff8fb1)]",
  avatar: "w-full aspect-square rounded-full object-cover bg-surface-2",
  avatarBig: "w-[min(56vw,200px)] flex-none aspect-square rounded-full object-cover bg-surface-2 shadow-[0_24px_60px_rgb(0_0_0/.4)] wide:w-[clamp(150px,22cqi,200px)] @4xl:w-full",
  avatarSmall: "size-12 flex-none aspect-square rounded-full object-cover bg-surface-2 text-[.95rem]",
  letters: "grid place-items-center font-extrabold text-[1.6rem] text-white bg-[linear-gradient(135deg,hsl(var(--h)_55%_42%),hsl(calc(var(--h)+40)_60%_28%))]",

  // ---- Cards ----
  card: "group/card tap flex-none w-(--card-w) grid gap-0.5 content-start snap-start active:scale-[.96] [&>b]:mt-1 [&>b]:truncate [&>b]:text-[.95rem] [&>b]:font-semibold [&>span:last-child]:truncate [&>span:last-child]:text-muted [&>span:last-child]:text-[.82rem] wide:[&>b]:mt-1.5 wide:[&>b]:text-[.98rem] wide:[&>span:last-child]:text-[.85rem]",
  // The name sits as far below the picture as on an album's card (its cover's margin plus the name's), so rows line up
  cardArtist: "group/card tap flex-none w-(--artist-w) grid gap-0.5 content-start snap-start text-center active:scale-[.96] [&>b]:truncate [&>b]:text-[.95rem] [&>b]:font-semibold [&>span:last-child]:truncate [&>span:last-child]:text-muted [&>span:last-child]:text-[.82rem] [&>b]:mt-2.5 wide:[&>b]:mt-3",
  // A cover inside a card: it rises towards you under a mouse
  cardCover: "mb-1.5 shadow-[0_12px_28px_rgb(0_0_0/.3)] transition-[transform,box-shadow] duration-300 ease-snap can-hover:group-hover/card:-translate-y-1 can-hover:group-hover/card:shadow-[0_18px_36px_rgb(0_0_0/.4)]",
  cardArt: "relative block",
  shelf: "stagger flex gap-4 overflow-x-auto px-5 pt-0.5 pb-2 snap-x snap-proximity scroll-px-5 no-scrollbar wide:gap-5 wide:px-8 wide:pb-3 wide:scroll-px-8 wide:scroll-smooth",
  // Cards fill their cell: an artist's card is narrower in a shelf, and its fixed width left it to one side of the cell
  grid: "stagger grid grid-cols-[repeat(auto-fill,minmax(var(--grid-min),1fr))] gap-x-4 gap-y-5 px-5 py-2 *:w-auto! wide:gap-x-5 wide:gap-y-7 wide:px-8",

  // ---- Rows ----
  rows: "stagger px-2 wide:px-5",
  rowsPlain: "w-full max-w-110 p-0",
  row: "group/row tap flex items-center gap-3 min-h-16 py-2 pr-2 pl-3 rounded-2xl cursor-pointer active:bg-ghost active:scale-[.985] hover:bg-hover compact:min-h-13 compact:py-1 compact:gap-2.5 compact:[&>[data-art]]:size-9.5 data-playing:[&>[data-art]]:animate-glow-pulse data-playing:[&>[data-art]]:shadow-[0_0_0_2px_var(--accent),0_0_14px_rgb(var(--glow)/.5)] wide:min-h-14 wide:py-1.5",
  rowCompact: "group/row tap flex items-center gap-3 min-h-13.5 py-2 pr-2 pl-1 rounded-xl cursor-pointer active:bg-ghost hover:bg-hover",
  rowLink: "flex items-center gap-3 flex-1 min-w-0 text-inherit",
  // Title and details of a row. Only a row marked data-current shows its title in the accent colour
  text: `flex-1 min-w-0 grid ${truncated} [&>b]:font-[650] [&>span]:text-muted [&>span]:text-[.85rem] group-data-current/row:[&>b]:text-accent`,
  time: "text-muted text-[.85rem] tabular-nums wide:min-w-[3em] wide:text-right",
  num: "w-7 flex-none text-center text-muted tabular-nums",
  status: "inline-flex items-center text-accent",
  download: "inline-flex items-center gap-2 flex-none mr-1",
  downloadLabel: "text-muted text-[.8rem] min-w-[3.4em] tabular-nums",
  done: "inline-flex px-2.5 text-accent [&_svg]:animate-pop",
  // Under a mouse this waits for you to point at the row. A finger cannot point, so on a touch screen it is always there
  rowMore: "tap size-10 grid place-items-center rounded-full text-muted flex-none active:bg-ghost hover:text-text can-hover:wide:opacity-0 can-hover:wide:group-hover/row:opacity-100 focus-visible:opacity-100",
  colAlbum: "hidden @2xl:block flex-[0_0_26%] min-w-0 truncate text-muted text-[.88rem]",
  inLineAlbum: "@2xl:hidden",
  tick: "flex-none size-7 grid place-items-center rounded-lg shadow-[inset_0_0_0_2px_var(--surface-3)] text-accent-ink transition-[background-color,box-shadow] duration-100 data-on:bg-accent data-on:shadow-none",
  pinMark: "inline-flex align-[-1px] mr-1.25 text-accent",
  discTitle: "px-3 pt-4 pb-1.5 text-muted text-[.8rem] font-bold uppercase tracking-[.08em]",
  selectBar: "sticky top-[calc(var(--safe-top)+8px)] z-10 flex flex-wrap items-center justify-between gap-2.5 mx-3 mb-2 px-3 py-2 rounded-[26px] bg-glass-strong backdrop-blur-xl shadow-[inset_0_0_0_1px_var(--line)] wide:top-0 wide:mx-5",
  filter: "block w-[calc(100%-32px)] mx-4 my-2 px-4 py-3 rounded-full border border-transparent bg-ghost outline-none focus:border-accent wide:w-[calc(100%-64px)] wide:max-w-120 wide:mx-8",
  segments: "flex gap-1 overflow-x-auto px-4 py-2.5 no-scrollbar wide:px-8 wide:py-2",
  segment: "tap flex-none whitespace-nowrap px-4 py-2 rounded-full font-bold text-[.9rem] text-muted hover:text-text hover:bg-ghost data-on:bg-text data-on:text-bg [&_small]:ml-1.5 [&_small]:opacity-75",

  // ---- Settings-style groups ----
  group: "grid rounded-[22px] bg-glass-strong overflow-hidden shadow-[inset_0_0_0_1px_var(--line)]",
  groupTitle: "text-[.75rem] uppercase tracking-[.09em] text-muted px-1.5 pb-2 font-bold",
  setting: "flex items-center justify-between gap-3.5 px-4 py-3.5 min-h-14 [&+&]:border-t [&+&]:border-line",
  settingStack: "flex flex-col items-stretch justify-between gap-3.5 px-4 py-3.5 min-h-14 [&+&]:border-t [&+&]:border-line",
  settingLabel: "grid gap-0.5 min-w-0 [&>b]:font-[650] [&>span]:text-muted [&>span]:text-[.82rem]",
  toggle: "relative flex-none w-12.5 h-7.5 rounded-full bg-surface-3 transition-colors duration-200 aria-checked:bg-accent after:content-[''] after:absolute after:top-0.75 after:left-0.75 after:size-6 after:rounded-full after:bg-white after:shadow-[0_2px_6px_rgb(0_0_0/.3)] after:transition-transform after:duration-200 after:ease-spring aria-checked:after:translate-x-5",
  input: "w-full px-4 py-2.75 rounded-full border border-transparent bg-ghost outline-none focus:border-accent",
};

/** The picture, title and details at the top of an album, playlist or artist. */
export const detail = {
  header: "rise flex flex-col max-sm:items-start sm:flex-row sm:items-end gap-5 px-5 pt-2 pb-1 [&>:first-child]:max-sm:self-center wide:gap-7 wide:px-8 wide:pb-4 @4xl:flex-col @4xl:items-stretch @4xl:gap-5 @4xl:px-0 @4xl:pt-0",
  info: "min-w-0 grid gap-1 max-sm:w-full [&_h1]:font-title [&_h1]:font-bold [&_h1]:tracking-[-.035em] [&_h1]:leading-[1.04] [&_h1]:text-balance [&_h1]:wrap-break-word [&_h1]:text-[clamp(1.9rem,8.5cqi,2.6rem)] [&_p]:text-muted [&_p_a]:text-text [&_p_a]:font-semibold wide:[&_h1]:text-[clamp(2rem,4.6cqi,3.25rem)] @4xl:[&_h1]:text-[clamp(1.9rem,2.6cqi,2.5rem)]",
};
