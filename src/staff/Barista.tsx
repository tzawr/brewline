import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../api";
import { useStore } from "../store";
import { time } from "../format";
import type { LocationStatus, Order, OrderStatus } from "../types";
import { Button, Icon, Sheet, Stepper } from "../components/ui";
import { AvailabilityPanel } from "./Availability";

const REJECT_REASONS = ["Item unavailable", "Café closing early", "Too busy to fulfil in time", "Equipment issue"];

function beep() {
  try {
    const ctx = new AudioContext();
    [0, 0.18].forEach((t) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.15);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.16);
    });
  } catch { /* audio unavailable */ }
}

export function BaristaPage() {
  const { user, setUser, toast } = useStore();
  const [locationId, setLocationId] = useState(() => localStorage.getItem("bl.staff.location") ?? "promenade");
  const [orders, setOrders] = useState<Order[]>([]);
  const [recent, setRecent] = useState<Order[]>([]);
  const [loc, setLoc] = useState<LocationStatus | null>(null);
  const [locations, setLocations] = useState<LocationStatus[]>([]);
  const [lastOk, setLastOk] = useState(Date.now());
  const [now, setNow] = useState(Date.now());
  const [sound, setSound] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<Order | null>(null);
  const [rejectReason, setRejectReason] = useState(REJECT_REASONS[0]);
  const [panel, setPanel] = useState<null | "availability" | "pause">(null);
  const [pauseReason, setPauseReason] = useState("Back in 15 minutes");
  const seen = useRef<Set<string> | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api<{ location: LocationStatus; orders: Order[]; recent: Order[] }>(`/staff/queue?location=${locationId}`);
      setOrders(r.orders);
      setRecent(r.recent);
      setLoc(r.location);
      setLastOk(Date.now());
      const newOnes = r.orders.filter((o) => o.status === "PENDING_ACCEPTANCE" && seen.current && !seen.current.has(o.id));
      if (newOnes.length && sound) beep();
      seen.current = new Set(r.orders.map((o) => o.id));
    } catch (e) {
      if ((e as ApiError).status === 401 || (e as ApiError).status === 403) setUser(null);
    }
  }, [locationId, sound, setUser]);

  useEffect(() => {
    seen.current = null;
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    api<{ locations: LocationStatus[] }>("/locations").then((r) => setLocations(r.locations)).catch(() => null);
    const t = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(t);
  }, []);

  const move = async (o: Order, to: OrderStatus, reason?: string) => {
    setBusyId(o.id);
    try {
      const r = await api<{ order: Order }>(`/staff/orders/${o.id}/transition`, { body: { to, expectedVersion: o.stateVersion, reason } });
      setOrders((list) => list.map((x) => (x.id === o.id ? r.order : x)).filter((x) => x.active));
      if (to === "REJECTED" || to === "CANCELLED") toast(`Order ${o.number} ${to === "REJECTED" ? "declined" : "cancelled"} — customer notified, payment released`, "info");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusyId(null);
      load();
    }
  };

  const setPaused = async (paused: boolean) => {
    try {
      const r = await api<{ location: LocationStatus }>(`/staff/locations/${locationId}/pause`, { body: { paused, reason: pauseReason } });
      setLoc(r.location);
      setPanel(null);
      toast(paused ? "Mobile orders paused" : "Mobile orders resumed", "success");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const setCapacity = async (patch: { leadTimeMin?: number; ordersPerSlot?: number }) => {
    try {
      const r = await api<{ location: LocationStatus }>(`/staff/locations/${locationId}/capacity`, { method: "PATCH", body: patch });
      setLoc(r.location);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const signOut = async () => {
    await api("/auth/logout", { body: {} }).catch(() => null);
    setUser(null);
  };

  const cols: { title: string; statuses: OrderStatus[] }[] = [
    { title: "New", statuses: ["PENDING_ACCEPTANCE"] },
    { title: "In progress", statuses: ["ACCEPTED", "PREPARING"] },
    { title: "Ready for pickup", statuses: ["READY"] },
  ];
  const offline = now - lastOk > 12000;

  return (
    <div className="kds">
      <header className="kds-bar">
        <div className="kds-brand">
          <span className="brand-mark">Brewline</span>
          <select value={locationId} onChange={(e) => { setLocationId(e.target.value); localStorage.setItem("bl.staff.location", e.target.value); }} aria-label="Café">
            {(locations.length ? locations : loc ? [loc] : []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          {loc ? (
            <span className={`kds-state ${loc.paused ? "warn" : loc.open ? "ok" : "muted"}`}>
              {loc.paused ? `Paused · ${loc.pauseReason ?? ""}` : loc.open ? "Taking orders" : "Closed"}
            </span>
          ) : null}
          <span className={`kds-conn ${offline ? "bad" : ""}`}>{offline ? "Connection lost — retrying" : "Live"}</span>
        </div>
        <div className="kds-controls">
          {loc ? (
            <>
              <div className="kds-ctl"><span>Lead time</span><Stepper label="lead time minutes" value={loc.leadTimeMin} min={0} max={60} onChange={(v) => setCapacity({ leadTimeMin: v })} /><span>min</span></div>
              <div className="kds-ctl"><span>Orders / {loc.slotMinutes} min</span><Stepper label="orders per slot" value={loc.ordersPerSlot} min={1} max={50} onChange={(v) => setCapacity({ ordersPerSlot: v })} /></div>
            </>
          ) : null}
          <Button small variant="secondary" onClick={() => setPanel("availability")}>Sold out</Button>
          {loc?.paused ? <Button small variant="accent" onClick={() => setPaused(false)}>Resume orders</Button> : <Button small variant="danger" onClick={() => setPanel("pause")}><Icon name="pause" size={16} /> Pause orders</Button>}
          <Button small variant="ghost" onClick={() => { setSound((s) => !s); if (!sound) beep(); }}>{sound ? "🔔 Sound on" : "🔕 Sound off"}</Button>
          {user?.role === "manager" ? <Link className="btn btn-ghost btn-small" to="/manager">Manager</Link> : null}
          <Button small variant="ghost" onClick={signOut}>Sign out</Button>
        </div>
      </header>

      <main className="kds-cols">
        {cols.map((c) => {
          const list = orders.filter((o) => c.statuses.includes(o.status));
          return (
            <section key={c.title} className="kds-col" aria-label={c.title}>
              <h2>{c.title} <span className="count">{list.length}</span></h2>
              {list.length === 0 ? <p className="kds-empty">Nothing here</p> : null}
              {list.map((o) => {
                const age = Math.round((now - Date.parse(o.createdAt)) / 60000);
                const overdue = o.status !== "READY" && now > Date.parse(o.promisedAt);
                const unacked = o.status === "PENDING_ACCEPTANCE" && age >= 2;
                const tz = loc?.timezone;
                const byStation = ["bar", "kitchen"].map((s) => ({ s, items: o.lines.filter((l) => l.station === s) })).filter((x) => x.items.length);
                return (
                  <article key={o.id} className={`ticket${overdue ? " overdue" : ""}${unacked ? " unacked" : ""}`}>
                    <header>
                      <div>
                        <div className="ticket-num">{o.number}</div>
                        <div className="ticket-name">{o.customerName}</div>
                      </div>
                      <div className="ticket-time">
                        {o.scheduled ? <span className="badge">Scheduled</span> : null}
                        <div>Due {time(o.slotStart, tz)}–{time(o.promisedAt, tz)}</div>
                        <div className={overdue ? "late" : "muted"}>{overdue ? "LATE · " : ""}{age} min ago</div>
                      </div>
                    </header>
                    {byStation.map(({ s, items }) => (
                      <div key={s} className="ticket-station">
                        {byStation.length > 1 ? <div className="station-label">{s === "bar" ? "Bar" : "Kitchen"}</div> : null}
                        <ul>
                          {items.map((l, i) => (
                            <li key={i}>
                              <div className="ticket-item"><strong>{l.quantity}×</strong> {l.name}</div>
                              <ul className="ticket-mods">
                                {l.modifiers.map((m, j) => (
                                  <li key={j} className={m.isDefault === false ? "sub" : ""}>
                                    {m.isDefault === false ? "▲ " : ""}{m.quantity > 1 ? `${m.quantity}× ` : ""}{m.option}
                                  </li>
                                ))}
                              </ul>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                    <footer>
                      {o.status === "PENDING_ACCEPTANCE" ? (
                        <>
                          <Button variant="ghost" small onClick={() => { setRejecting(o); setRejectReason(REJECT_REASONS[0]); }}>Decline</Button>
                          <Button busy={busyId === o.id} onClick={() => move(o, "ACCEPTED")}>Accept</Button>
                        </>
                      ) : o.status === "ACCEPTED" ? (
                        <>
                          <Button variant="ghost" small onClick={() => { setRejecting(o); setRejectReason(REJECT_REASONS[0]); }}>Cancel & refund</Button>
                          <Button busy={busyId === o.id} onClick={() => move(o, "PREPARING")}>Start</Button>
                        </>
                      ) : o.status === "PREPARING" ? (
                        <Button busy={busyId === o.id} variant="accent" onClick={() => move(o, "READY")}>Mark ready</Button>
                      ) : (
                        <Button busy={busyId === o.id} variant="secondary" onClick={() => move(o, "COMPLETED")}>Picked up</Button>
                      )}
                    </footer>
                  </article>
                );
              })}
            </section>
          );
        })}
      </main>

      {recent.length ? (
        <details className="kds-recent">
          <summary>Recently closed ({recent.length})</summary>
          <ul>{recent.map((o) => <li key={o.id}><strong>{o.number}</strong> {o.customerName} · {o.status.toLowerCase()}{o.rejectReason ? ` · ${o.rejectReason}` : ""} · {time(o.updatedAt, loc?.timezone)}</li>)}</ul>
        </details>
      ) : null}

      <Sheet open={!!rejecting} onClose={() => setRejecting(null)} title={rejecting?.status === "PENDING_ACCEPTANCE" ? `Decline order ${rejecting?.number}` : `Cancel order ${rejecting?.number}`}>
        <p className="small muted">The customer sees this reason. {rejecting?.status === "PENDING_ACCEPTANCE" ? "Their card hold is released automatically." : "They're refunded in full automatically."} Any reward is returned.</p>
        <div className="stack">
          {REJECT_REASONS.map((r) => (
            <label key={r} className={`pill-option${rejectReason === r ? " on" : ""}`}>
              <input type="radio" name="reason" checked={rejectReason === r} onChange={() => setRejectReason(r)} /> {r}
            </label>
          ))}
          <Button variant="danger" full onClick={() => { const o = rejecting!; setRejecting(null); move(o, o.status === "PENDING_ACCEPTANCE" ? "REJECTED" : "CANCELLED", rejectReason); }}>
            Confirm
          </Button>
        </div>
      </Sheet>

      <Sheet open={panel === "pause"} onClose={() => setPanel(null)} title="Pause mobile orders">
        <p className="small muted">New mobile orders stop immediately. Orders already in the queue stay. Counter service is unaffected.</p>
        <label className="field"><span>Message for customers</span><input value={pauseReason} maxLength={120} onChange={(e) => setPauseReason(e.target.value)} /></label>
        <Button variant="danger" full onClick={() => setPaused(true)}>Pause now</Button>
      </Sheet>

      <Sheet open={panel === "availability"} onClose={() => setPanel(null)} title="Sold out">
        <AvailabilityPanel locationId={locationId} />
      </Sheet>
    </div>
  );
}
