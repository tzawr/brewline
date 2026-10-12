import { useEffect, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useStore } from "../store";

export function Icon({ name, size = 22 }: { name: string; size?: number }) {
  const p = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  switch (name) {
    case "home": return <svg {...p}><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" /></svg>;
    case "cup": return <svg {...p}><path d="M5 8h12l-1.2 11.2A2 2 0 0 1 13.8 21H8.2a2 2 0 0 1-2-1.8z" /><path d="M4 5h14v3H4zM17 11h1.5a2.5 2.5 0 0 1 0 5H16.5" /></svg>;
    case "star": return <svg {...p}><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" /></svg>;
    case "receipt": return <svg {...p}><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6M9 12h6M9 16h3" /></svg>;
    case "user": return <svg {...p}><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></svg>;
    case "bag": return <svg {...p}><path d="M5 8h14l-1 13H6z" /><path d="M9 8V6a3 3 0 0 1 6 0v2" /></svg>;
    case "back": return <svg {...p}><path d="M15 5 8 12l7 7" /></svg>;
    case "close": return <svg {...p}><path d="M6 6l12 12M18 6 6 18" /></svg>;
    case "pin": return <svg {...p}><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></svg>;
    case "clock": return <svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
    case "heart": return <svg {...p}><path d="M12 20s-7.5-4.6-9-9.5C2 6.7 5.6 4 8.6 5.5 10.2 6.3 11.3 7.6 12 9c.7-1.4 1.8-2.7 3.4-3.5C18.4 4 22 6.7 21 10.5c-1.5 4.9-9 9.5-9 9.5z" /></svg>;
    case "heart-fill": return <svg {...p} fill="currentColor"><path d="M12 20s-7.5-4.6-9-9.5C2 6.7 5.6 4 8.6 5.5 10.2 6.3 11.3 7.6 12 9c.7-1.4 1.8-2.7 3.4-3.5C18.4 4 22 6.7 21 10.5c-1.5 4.9-9 9.5-9 9.5z" /></svg>;
    case "search": return <svg {...p}><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>;
    case "check": return <svg {...p}><path d="m5 12 5 5 9-10" /></svg>;
    case "plus": return <svg {...p}><path d="M12 5v14M5 12h14" /></svg>;
    case "minus": return <svg {...p}><path d="M5 12h14" /></svg>;
    case "help": return <svg {...p}><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01" /></svg>;
    case "chevron": return <svg {...p}><path d="m9 6 6 6-6 6" /></svg>;
    case "repeat": return <svg {...p}><path d="M17 2l3 3-3 3" /><path d="M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3" /><path d="M20 13v2a4 4 0 0 1-4 4H4" /></svg>;
    case "gift": return <svg {...p}><rect x="3" y="8" width="18" height="5" rx="1" /><path d="M5 13v8h14v-8M12 8v13M12 8S10.5 3 7.5 4.5 9 8 12 8zM12 8s1.5-5 4.5-3.5S15 8 12 8z" /></svg>;
    case "wifi-off": return <svg {...p}><path d="M2 2l20 20M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 5.2-2.8M19 13a10 10 0 0 0-2.3-1.7M2 8.8a15 15 0 0 1 4.2-2.6M22 8.8A15 15 0 0 0 11 5" /><path d="M12 20h.01" /></svg>;
    case "pause": return <svg {...p}><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>;
    case "logout": return <svg {...p}><path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l-5-5 5-5M5 12h11" /></svg>;
    default: return null;
  }
}

export function Button({
  children, onClick, variant = "primary", type = "button", disabled, busy, full, small, ...rest
}: {
  children: ReactNode; onClick?: () => void; variant?: "primary" | "secondary" | "ghost" | "danger" | "accent"; type?: "button" | "submit";
  disabled?: boolean; busy?: boolean; full?: boolean; small?: boolean; "aria-label"?: string;
}) {
  return (
    <button type={type} className={`btn btn-${variant}${full ? " btn-full" : ""}${small ? " btn-small" : ""}`} onClick={onClick} disabled={disabled || busy} aria-busy={busy} {...rest}>
      {busy ? <span className="spinner" aria-hidden="true" /> : null}
      <span>{children}</span>
    </button>
  );
}

export function PageHeader({ title, back, right, sub }: { title: string; back?: boolean | string; right?: ReactNode; sub?: ReactNode }) {
  const nav = useNavigate();
  return (
    <header className="page-header">
      <div className="page-header-row">
        {back ? (
          <button className="icon-btn" aria-label="Back" onClick={() => (typeof back === "string" ? nav(back) : window.history.length > 1 ? nav(-1) : nav("/"))}>
            <Icon name="back" />
          </button>
        ) : null}
        <h1>{title}</h1>
        <div className="page-header-right">{right}</div>
      </div>
      {sub ? <div className="page-header-sub">{sub}</div> : null}
    </header>
  );
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose}><Icon name="close" /></button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

export function Toasts() {
  const { toasts } = useStore();
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => <div key={t.id} className={`toast toast-${t.tone}`}>{t.text}</div>)}
    </div>
  );
}

export function Empty({ icon, title, body, action }: { icon: string; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon"><Icon name={icon} size={30} /></div>
      <h3>{title}</h3>
      {body ? <p>{body}</p> : null}
      {action}
    </div>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return <div className="center-pad" role="status"><span className="spinner spinner-dark" aria-hidden="true" /><span className="sr-only">{label}</span></div>;
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "error" | "success"; children: ReactNode }) {
  return <div className={`notice notice-${tone}`} role={tone === "error" ? "alert" : undefined}>{children}</div>;
}

export function Stepper({ value, onChange, min = 0, max = 10, label }: { value: number; onChange: (v: number) => void; min?: number; max?: number; label: string }) {
  return (
    <div className="stepper" role="group" aria-label={label}>
      <button aria-label={`Fewer ${label}`} disabled={value <= min} onClick={() => onChange(value - 1)}><Icon name="minus" size={18} /></button>
      <span aria-live="polite">{value}</span>
      <button aria-label={`More ${label}`} disabled={value >= max} onClick={() => onChange(value + 1)}><Icon name="plus" size={18} /></button>
    </div>
  );
}
