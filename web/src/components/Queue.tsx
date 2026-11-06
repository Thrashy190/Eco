// What plays next, in the full-screen player and the deck. Songs added by hand come first under their own heading and
// stand out from the album or playlist that carries on after them. Each song can be dragged by its handle to another
// place (pointer events, so a finger and a mouse work alike), or moved with the arrow keys from the handle.
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { clock } from "../lib/format";
import { sections } from "../lib/queue";
import type { Song } from "../lib/types";
import { cx, ui } from "../lib/ui";
import * as player from "../stores/player";
import { Icon } from "./Icon";

const grip = "tap flex-none -my-1 w-9 h-10 grid place-items-center rounded-lg text-muted touch-none cursor-grab active:cursor-grabbing hover:text-text focus-visible:opacity-100 can-hover:opacity-0 can-hover:group-hover/row:opacity-100";
const EDGE = 56; // how close to the top or bottom of the list a dragged song starts scrolling it

interface Drag {
  from: number; // position in `upcoming`
  to: number; // where it would land, counted after taking it out
  dy: number; // how far it has been dragged, scrolling included
}

/** Where on screen a scrolling box shows its content. */
const bounds = (el: HTMLElement) => (el === document.scrollingElement ? { top: 0, bottom: innerHeight } : el.getBoundingClientRect());

/** The nearest box that scrolls, which the dragged song scrolls when it reaches an edge. */
function scrollerOf(node: HTMLElement): HTMLElement {
  for (let el = node.parentElement; el; el = el.parentElement) {
    const { overflowY } = getComputedStyle(el);
    if ((overflowY === "auto" || overflowY === "scroll") && el.scrollHeight > el.clientHeight) return el;
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

/**
 * `heading` styles the headings: "Up next", or, once songs were added by hand, "Next in queue" over them and "Next from"
 * the album or playlist over the rest.
 */
export function Queue({ upcoming, index, source, heading }: { upcoming: Song[]; index: number; source: string; heading: string }) {
  const list = useRef<HTMLUListElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  // What a drag needs between pointer events, without redrawing for it
  const live = useRef<{ from: number; to: number; startY: number; lastY: number; startScroll: number; scroller: HTMLElement; rows: { top: number; height: number }[]; frame: number } | null>(null);
  const focusAfterMove = useRef<number | null>(null);

  const anyQueued = upcoming.some((s) => s.queued);
  const parts = sections(upcoming);

  // A song moved with the keyboard keeps the focus on its handle at its new place
  useEffect(() => {
    const at = focusAfterMove.current;
    if (at === null) return;
    focusAfterMove.current = null;
    list.current?.querySelector<HTMLButtonElement>(`[data-q="${at}"] [data-grip]`)?.focus();
  });

  useEffect(() => () => { if (live.current) cancelAnimationFrame(live.current.frame); }, []);

  const update = () => {
    const d = live.current;
    if (!d) return;
    const dy = d.lastY - d.startY + (d.scroller.scrollTop - d.startScroll);
    const own = d.rows[d.from];
    const middle = own.top + own.height / 2 + dy;
    const to = d.rows.filter((r, k) => k !== d.from && r.top + r.height / 2 < middle).length;
    d.to = to;
    setDrag({ from: d.from, to, dy });
  };

  // While held near an edge, keep scrolling, faster the closer it gets
  const autoscroll = () => {
    const d = live.current;
    if (!d) return;
    const box = bounds(d.scroller);
    const speed = d.lastY < box.top + EDGE ? -(box.top + EDGE - d.lastY) : d.lastY > box.bottom - EDGE ? d.lastY - (box.bottom - EDGE) : 0;
    if (speed !== 0) { d.scroller.scrollTop += Math.max(-24, Math.min(24, speed / 3)); update(); }
    d.frame = requestAnimationFrame(autoscroll);
  };

  const start = (e: PointerEvent<HTMLButtonElement>, k: number) => {
    if (e.button !== 0 || !list.current) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const origin = list.current.getBoundingClientRect().top;
    const rows = Array.from(list.current.querySelectorAll<HTMLElement>("[data-q]"), (row) => {
      const r = row.getBoundingClientRect();
      return { top: r.top - origin, height: r.height };
    });
    const scroller = scrollerOf(list.current);
    live.current = { from: k, to: k, startY: e.clientY, lastY: e.clientY, startScroll: scroller.scrollTop, scroller, rows, frame: requestAnimationFrame(autoscroll) };
    setDrag({ from: k, to: k, dy: 0 });
  };
  const follow = (e: PointerEvent<HTMLButtonElement>) => {
    const d = live.current;
    if (!d) return;
    // Held past the edge of the list, the song stays at the edge, where the list scrolls, rather than out of sight
    const box = bounds(d.scroller);
    d.lastY = Math.min(Math.max(e.clientY, box.top), box.bottom);
    update();
  };
  const finish = (drop: boolean) => {
    const d = live.current;
    if (!d) return;
    cancelAnimationFrame(d.frame);
    live.current = null;
    setDrag(null);
    if (drop && d.to !== d.from) player.moveInQueue(index + 1 + d.from, index + 1 + d.to);
  };

  const keys = (e: KeyboardEvent<HTMLButtonElement>, k: number) => {
    const to = e.key === "ArrowUp" ? k - 1 : e.key === "ArrowDown" ? k + 1 : -1;
    if (to < 0 || to >= upcoming.length) return;
    e.preventDefault();
    focusAfterMove.current = to;
    player.moveInQueue(index + 1 + k, index + 1 + to);
  };

  // Where the dragged song would land: a line between two others
  let line: number | null = null;
  if (drag && drag.to !== drag.from && live.current) {
    const others = live.current.rows.filter((_, k) => k !== drag.from);
    line = drag.to === 0 ? others[0].top : others[drag.to - 1].top + others[drag.to - 1].height;
  }

  if (upcoming.length === 0) return <><h3 className={heading}>Up next</h3><ul className={ui.rowsPlain}><li className={ui.empty}>The queue is empty</li></ul></>;
  return (
    <ul ref={list} className={cx(ui.rowsPlain, "relative", drag && "select-none")}>
      {parts.map((part) => [
        (anyQueued || part.start === 0) && (
          <li key={`h-${part.start}`} className={cx(heading, "list-none", part.queued && "text-accent!")} role="presentation">
            {!anyQueued ? "Up next" : part.queued ? "Next in queue" : source ? `Next from ${source}` : "Then"}
          </li>
        ),
        ...part.songs.map((song, j) => {
          const k = part.start + j;
          const dragging = drag?.from === k;
          return (
            <li key={`${song.id}-${k}`} data-q={k} data-queued={song.queued || undefined}
              className={cx(ui.rowCompact, "pl-0 data-queued:bg-accent/10 data-queued:hover:bg-accent/15", dragging && "relative z-10 bg-surface-2! shadow-[0_10px_30px_rgb(0_0_0/.35)] cursor-grabbing")}
              style={dragging ? { transform: `translateY(${drag.dy}px)` } : undefined}
              onClick={() => { if (!drag) player.jumpTo(index + 1 + k); }}>
              <button type="button" data-grip="" className={grip} aria-label={`Move ${song.title}`} title="Drag to move"
                onPointerDown={(e) => start(e, k)} onPointerMove={follow} onPointerUp={() => finish(true)} onPointerCancel={() => finish(false)}
                onClick={(e) => e.stopPropagation()} onKeyDown={(e) => keys(e, k)}>
                <Icon name="grip" size={18} />
              </button>
              <div className={ui.text}><b>{song.title}</b><span>{song.artist}</span></div>
              <span className={ui.time}>{song.duration ? clock(song.duration) : ""}</span>
            </li>
          );
        }),
      ])}
      {line !== null && <li aria-hidden="true" className="absolute inset-x-1 h-0.5 -mt-px rounded-full bg-accent pointer-events-none" style={{ top: line }} />}
    </ul>
  );
}
