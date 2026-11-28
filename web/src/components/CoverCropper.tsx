// A window to frame a picture in a square before it becomes a cover: drag it, zoom with the slider, the wheel or two
// fingers. The maths is in lib/crop.ts; the picture is cut and turned into a JPEG by pictureToCover.
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { baseScale, centred, clampCrop, MAX_ZOOM, sourceSquare, zoomAround, type Crop } from "../lib/crop";
import { pictureToCover } from "../lib/image";
import { cx, ui } from "../lib/ui";
import { useCropAsk } from "../stores/ui";
import { Icon, Ring } from "./Icon";

const frameSide = () => Math.max(200, Math.min(340, window.innerWidth - 72));

/** The window cropPicture opens, mounted once by the app. */
export function CropHost() {
  const { file, answer } = useCropAsk();
  if (!file || !answer) return null;
  const done = (jpeg: Blob | null) => {
    useCropAsk.setState({ file: null, answer: null });
    answer(jpeg);
  };
  return <CoverCropper key={String((file as File).name ?? "") + file.size} file={file} onDone={done} />;
}

/** Frame `file` in a square. `onDone` gets the JPEG, or null when the person cancels. */
function CoverCropper({ file, onDone }: { file: Blob; onDone: (jpeg: Blob | null) => void }) {
  const [url] = useState(() => URL.createObjectURL(file));
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [crop, setCrop] = useState<Crop>({ x: 0, y: 0, zoom: 1 });
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const frame = useRef(frameSide()).current;
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ distance: number; zoom: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onDone(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDone]);

  // The wheel zooms the picture, not the page: React's onWheel is passive and cannot stop the scroll
  useEffect(() => {
    const el = box.current;
    if (!el || !size) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      setCrop((c) => zoomAround(c, size.w, size.h, frame, c.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1), e.clientX - rect.left, e.clientY - rect.top));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [size, frame]);

  const loaded = (img: HTMLImageElement) => {
    const s = { w: img.naturalWidth, h: img.naturalHeight };
    if (!s.w || !s.h) { setFailed(true); return; }
    setSize(s);
    setCrop(centred(s.w, s.h, frame));
  };

  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), zoom: crop.zoom };
    }
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    const before = pointers.current.get(e.pointerId);
    if (!before || !size) return;
    const now = { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, now);
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const rect = e.currentTarget.getBoundingClientRect();
      const zoom = pinch.current.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, pinch.current.distance));
      setCrop((c) => zoomAround(c, size.w, size.h, frame, zoom, (a.x + b.x) / 2 - rect.left, (a.y + b.y) / 2 - rect.top));
      return;
    }
    setCrop((c) => clampCrop({ ...c, x: c.x + now.x - before.x, y: c.y + now.y - before.y }, size.w, size.h, frame));
  };
  const up = (e: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  };

  async function confirm() {
    if (!size) return;
    setBusy(true);
    try {
      onDone(await pictureToCover(file, sourceSquare(crop, size.w, size.h, frame)));
    } catch {
      setBusy(false);
      setFailed(true);
    }
  }

  const scale = size ? baseScale(size.w, size.h, frame) * crop.zoom : 0;
  // On the body: inside the page, a transformed panel would hold "fixed" and the phone's tabs would cover the buttons
  return createPortal(
    <div className="fixed inset-0 z-80 grid place-items-center px-2 bg-black/60" onClick={(e) => { if (e.target === e.currentTarget) onDone(null); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="crop-title"
        className="w-full max-w-110 grid gap-4 justify-items-center p-5 animate-rise rounded-[26px] bg-surface shadow-[0_24px_60px_rgb(0_0_0/.5),inset_0_0_0_1px_var(--line)]">
        <div className="w-full grid gap-0.5">
          <h2 id="crop-title" className="font-title text-[1.25rem] font-bold tracking-[-.02em]">Frame the cover</h2>
          <p className="text-muted text-[.88rem]">Drag the picture to move it, and zoom to fill the square with what matters.</p>
        </div>
        {failed ? <p className="text-danger text-[.92rem]">That file is not a picture this browser can read.</p> : (
          <div ref={box} className="relative overflow-hidden rounded-big bg-surface-2 touch-none select-none cursor-grab active:cursor-grabbing shadow-[inset_0_0_0_1px_var(--line)]"
            style={{ width: frame, height: frame }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
            <img src={url} alt="" draggable={false} onLoad={(e) => loaded(e.currentTarget)} onError={() => setFailed(true)}
              className="absolute left-0 top-0 max-w-none origin-top-left pointer-events-none"
              style={size ? { width: size.w * scale, height: size.h * scale, transform: `translate(${crop.x}px, ${crop.y}px)` } : { opacity: 0 }} />
            {!size && <span className="absolute inset-0 grid place-items-center"><Ring percent={-1} size={28} /></span>}
          </div>
        )}
        {size && (
          <label className="w-full flex items-center gap-3 text-muted" aria-label="Zoom">
            <Icon name="image" size={16} />
            <input type="range" className="flex-1" min={1} max={MAX_ZOOM} step={0.01} value={crop.zoom}
              onChange={(e) => setCrop((c) => zoomAround(c, size.w, size.h, frame, Number(e.target.value)))} />
            <Icon name="image" size={24} />
          </label>
        )}
        <div className="w-full flex justify-end gap-2.5">
          <button type="button" className={ui.pill} onClick={() => onDone(null)}>Cancel</button>
          <button type="button" className={cx(ui.primary, "py-2.5")} disabled={!size || busy || failed} onClick={() => void confirm()}>
            {busy ? <Ring percent={-1} size={20} /> : <Icon name="check" size={20} />}Use this
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
