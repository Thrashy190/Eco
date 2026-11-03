import { useEffect, useState } from "react";
import { closeSheet, useSheet, useToast, type SheetContent } from "../stores/ui";
import { Icon } from "./Icon";

/** The bottom sheet with a menu. It stays mounted long enough to slide away. */
export function SheetHost() {
  const sheet = useSheet((s) => s.sheet);
  const [shown, setShown] = useState<SheetContent | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (sheet) {
      setShown(sheet);
      const frame = requestAnimationFrame(() => setOpen(true));
      return () => cancelAnimationFrame(frame);
    }
    setOpen(false);
    const timer = setTimeout(() => setShown(null), 180);
    return () => clearTimeout(timer);
  }, [sheet]);

  if (!shown) return null;
  return (
    <div className={`backdrop${open ? " show" : ""}`} onClick={(e) => { if (e.target === e.currentTarget) closeSheet(); }}>
      <div className="sheet" role="dialog" aria-label={shown.title}>
        <div className="sheet-head"><b>{shown.title}</b>{shown.subtitle && <span>{shown.subtitle}</span>}</div>
        {shown.items.map((item, i) => (
          <button key={i} className={`sheet-item${item.danger ? " danger" : ""}`} onClick={() => { closeSheet(); item.run(); }}>
            <Icon name={item.icon} size={20} />{item.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ToastHost() {
  const { message, visible } = useToast();
  return <div id="toast" role="status" className={visible ? "show" : undefined}>{message}</div>;
}
