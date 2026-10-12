import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, NavLink, Navigate, Route, Routes } from "react-router-dom";
import { api, uid } from "../api";
import { useStore } from "../store";
import { dateTime, money } from "../format";
import type { LocationStatus, Order } from "../types";
import { Button, Notice, Sheet, Spinner } from "../components/ui";
import { AvailabilityPanel } from "./Availability";

export function ManagerPage() {
  const { setUser, user } = useStore();
  const [locationId, setLocationId] = useState(() => localStorage.getItem("bl.staff.location") ?? "promenade");
  const [locations, setLocations] = useState<LocationStatus[]>([]);
  useEffect(() => {
    api<{ locations: LocationStatus[] }>("/locations").then((r) => setLocations(r.locations)).catch(() => null);
  }, []);
  const signOut = async () => {
    await api("/auth/logout", { body: {} }).catch(() => null);
    setUser(null);
  };
  const tabs = [["", "Overview"], ["orders", "Orders"], ["menu", "Menu"], ["availability", "Availability"], ["cafe", "Café settings"], ["support", "Support"], ["team", "Team"], ["audit", "Audit log"]];

  return (
    <div className="mgr">
      <aside className="mgr-nav">
        <div className="brand-mark">Brewline</div>
        <div className="small muted">Manager · {user?.name}</div>
        <select value={locationId} onChange={(e) => { setLocationId(e.target.value); localStorage.setItem("bl.staff.location", e.target.value); }} aria-label="Café">
          {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <nav>
          {tabs.map(([path, label]) => (
            <NavLink key={path} to={`/manager/${path}`} end className={({ isActive }) => (isActive ? "on" : "")}>{label}</NavLink>
          ))}
        </nav>
        <div className="mgr-nav-foot">
          <Link to="/barista" className="link">Barista display →</Link>
          <Link to="/" className="link">Customer app →</Link>
          <button className="link" onClick={signOut}>Sign out</button>
        </div>
      </aside>
      <main className="mgr-main">
        <Routes>
          <Route index element={<Overview locationId={locationId} />} />
          <Route path="orders" element={<Orders locationId={locationId} />} />
          <Route path="menu" element={<MenuEditor locationId={locationId} />} />
          <Route path="availability" element={<><h1>Availability</h1><div className="card"><AvailabilityPanel locationId={locationId} /></div></>} />
          <Route path="cafe" element={<CafeSettings locationId={locationId} />} />
          <Route path="support" element={<Support />} />
          <Route path="team" element={<Team />} />
          <Route path="audit" element={<Audit />} />
          <Route path="*" element={<Navigate to="/manager" replace />} />
        </Routes>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------- overview

interface Report {
  days: number;
  totals: { orders: number; net: number; rewards: number; rejected: number };
  byDay: { day: string; orders: number; net: number }[];
  topItems: { name: string; qty: number; cents: number }[];
  timing: { avg_ready_min: number | null; on_time: number | null };
  rewardsUnlocked: number;
  refunds: { n: number; cents: number };
}

function Overview({ locationId }: { locationId: string }) {
  const [days, setDays] = useState(7);
  const [r, setR] = useState<Report | null>(null);
  useEffect(() => {
    setR(null);
    api<Report>(`/manager/reports?location=${locationId}&days=${days}`).then(setR).catch(() => null);
  }, [locationId, days]);
  const max = Math.max(1, ...(r?.byDay.map((d) => d.net) ?? [1]));
  return (
    <>
      <div className="row-between">
        <h1>Overview</h1>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Period">
          <option value={1}>Last 24 hours</option>
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
        </select>
      </div>
      {!r ? <Spinner /> : (
        <>
          <div className="kpis">
            <Kpi label="Net sales" value={money(r.totals.net)} />
            <Kpi label="Orders" value={String(r.totals.orders)} />
            <Kpi label="Avg. order → ready" value={r.timing.avg_ready_min !== null ? `${r.timing.avg_ready_min.toFixed(1)} min` : "—"} />
            <Kpi label="Ready on time" value={r.timing.on_time !== null ? `${Math.round(r.timing.on_time * 100)}%` : "—"} />
            <Kpi label="Rewards redeemed" value={money(r.totals.rewards)} sub={`${r.rewardsUnlocked} unlocked`} />
            <Kpi label="Declined / cancelled" value={String(r.totals.rejected)} sub={`${r.refunds.n} refunds · ${money(r.refunds.cents)}`} />
          </div>
          <div className="mgr-grid">
            <section className="card">
              <h2>Net sales by day</h2>
              {r.byDay.length ? (
                <div className="bars" role="img" aria-label="Net sales by day">
                  {r.byDay.map((d) => (
                    <div key={d.day} className="bar-col" title={`${d.day}: ${money(d.net)} · ${d.orders} orders`}>
                      <span className="bar-val">{money(d.net)}</span>
                      <div className="bar" style={{ height: `${(d.net / max) * 100}%` }} />
                      <span className="bar-label">{d.day.slice(5)}</span>
                    </div>
                  ))}
                </div>
              ) : <p className="muted">No sales in this period yet.</p>}
            </section>
            <section className="card">
              <h2>Top items</h2>
              {r.topItems.length ? (
                <table className="table">
                  <thead><tr><th>Item</th><th>Qty</th><th>Sales</th></tr></thead>
                  <tbody>{r.topItems.map((t) => <tr key={t.name}><td>{t.name}</td><td>{t.qty}</td><td>{money(t.cents)}</td></tr>)}</tbody>
                </table>
              ) : <p className="muted">No items sold yet.</p>}
            </section>
          </div>
        </>
      )}
    </>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return <div className="kpi"><div className="kpi-label">{label}</div><div className="kpi-value">{value}</div>{sub ? <div className="small muted">{sub}</div> : null}</div>;
}

// ---------------------------------------------------------------- orders & refunds

function Orders({ locationId }: { locationId: string }) {
  const { toast } = useStore();
  const [q, setQ] = useState("");
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [sel, setSel] = useState<Order | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("Item missing");
  const [refundKey, setRefundKey] = useState(uid());
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api<{ orders: Order[] }>(`/manager/orders?location=${locationId}&q=${encodeURIComponent(q)}`).then((r) => {
    setOrders(r.orders);
    setSel((s) => (s ? r.orders.find((o) => o.id === s.id) ?? s : s));
  }), [locationId, q]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  const refund = async (e: FormEvent) => {
    e.preventDefault();
    if (!sel) return;
    const cents = Math.round(parseFloat(amount || "0") * 100);
    if (!window.confirm(`Refund ${money(cents)} on order ${sel.number}?`)) return;
    setBusy(true);
    try {
      await api(`/manager/orders/${sel.id}/refunds`, { body: { amountCents: cents, reason, idempotencyKey: refundKey } });
      toast("Refund issued", "success");
      setRefundKey(uid());
      setAmount("");
      await load();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const refundable = sel && sel.paymentStatus === "CAPTURED" ? sel.totalCents - sel.refundedCents : 0;

  return (
    <>
      <h1>Orders</h1>
      <input className="mgr-search" placeholder="Search by order code, customer name or email" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search orders" />
      {!orders ? <Spinner /> : orders.length === 0 ? <p className="muted">No orders found.</p> : (
        <table className="table clickable">
          <thead><tr><th>Code</th><th>Customer</th><th>Placed</th><th>Status</th><th>Payment</th><th>Total</th></tr></thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id} onClick={() => { setSel(o); setRefundKey(uid()); setAmount(""); }} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && setSel(o)}>
                <td><strong>{o.number}</strong></td>
                <td>{o.customerName}</td>
                <td>{dateTime(o.createdAt, o.location.timezone)}</td>
                <td><span className={`badge status-badge s-${o.status.toLowerCase()}`}>{o.status.replace(/_/g, " ").toLowerCase()}</span></td>
                <td>{o.paymentStatus.toLowerCase()}{o.refundedCents ? ` · refunded ${money(o.refundedCents)}` : ""}</td>
                <td>{money(o.totalCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <Sheet open={!!sel} onClose={() => setSel(null)} title={sel ? `Order ${sel.number} · ${sel.customerName}` : ""}>
        {sel ? (
          <div className="stack">
            <div className="small muted">Ref {sel.id} · {sel.tender ?? "—"} · {sel.paymentStatus.toLowerCase()}</div>
            <ul className="receipt-lines">
              {sel.lines.map((l, i) => (
                <li key={i}><div className="row-between"><span>{l.quantity}× {l.name}</span><span>{money(l.lineCents)}</span></div><div className="small muted">{l.modifiers.map((m) => m.option).join(" · ")}</div></li>
              ))}
            </ul>
            <div className="row-between"><span>Subtotal {sel.discountCents ? `(reward −${money(sel.discountCents)})` : ""} + tax {money(sel.taxCents)}</span><strong>{money(sel.totalCents)}</strong></div>
            <h3>Timeline</h3>
            <ol className="events">
              {sel.events?.map((e, i) => (
                <li key={i}><span className="small muted">{dateTime(e.at, sel.location.timezone)}</span> {e.kind === "TRANSITION" ? `${e.from_status} → ${e.to_status}` : e.kind}{e.note ? ` · ${e.note}` : ""}</li>
              ))}
            </ol>
            <h3>Refund</h3>
            {refundable > 0 ? (
              <form onSubmit={refund} className="form">
                <label className="field"><span>Amount (up to {money(refundable)})</span>
                  <input inputMode="decimal" value={amount} placeholder={(refundable / 100).toFixed(2)} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} />
                </label>
                <label className="field"><span>Reason (shown on the customer's receipt)</span>
                  <select value={reason} onChange={(e) => setReason(e.target.value)}>
                    {["Item missing", "Wrong item made", "Quality issue", "Long wait", "Charged incorrectly", "Goodwill"].map((r) => <option key={r}>{r}</option>)}
                  </select>
                </label>
                <div className="row gap">
                  <Button variant="secondary" onClick={() => setAmount((refundable / 100).toFixed(2))}>Full amount</Button>
                  <Button type="submit" variant="danger" busy={busy} disabled={!amount}>Issue refund</Button>
                </div>
                <p className="tiny muted">Loyalty progress earned on the refunded share is reversed automatically. A full refund returns any reward used.</p>
              </form>
            ) : (
              <p className="small muted">{sel.paymentStatus === "AUTHORIZED" ? "Not charged yet — declining the order releases the hold." : sel.totalCents === 0 ? "Paid entirely with a reward — cancel the order from the barista display to return it." : "Nothing left to refund."}</p>
            )}
          </div>
        ) : null}
      </Sheet>
    </>
  );
}

// ---------------------------------------------------------------- menu editor

interface PRow { id: string; name: string; description: string; category_id: string; base_price_cents: number; active: number; location_price_cents: number | null }

function MenuEditor({ locationId }: { locationId: string }) {
  const { toast, reloadMenu } = useStore();
  const [rows, setRows] = useState<PRow[] | null>(null);
  const [edit, setEdit] = useState<PRow | null>(null);
  const [form, setForm] = useState({ name: "", description: "", price: "", localPrice: "", active: true });
  const load = useCallback(() => api<{ products: PRow[] }>(`/manager/products?location=${locationId}`).then((r) => setRows(r.products)), [locationId]);
  useEffect(() => { load(); }, [load]);

  const open = (p: PRow) => {
    setEdit(p);
    setForm({ name: p.name, description: p.description, price: (p.base_price_cents / 100).toFixed(2), localPrice: p.location_price_cents !== null ? (p.location_price_cents / 100).toFixed(2) : "", active: !!p.active });
  };
  const save = async () => {
    if (!edit) return;
    try {
      await api(`/manager/products/${edit.id}`, {
        method: "PATCH",
        body: {
          name: form.name, description: form.description, basePriceCents: Math.round(parseFloat(form.price) * 100), active: form.active,
          locationId, locationPriceCents: form.localPrice.trim() ? Math.round(parseFloat(form.localPrice) * 100) : null,
        },
      });
      toast("Menu updated — customers see it within a minute", "success");
      setEdit(null);
      load();
      reloadMenu();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  return (
    <>
      <h1>Menu & prices</h1>
      <p className="muted small">Prices are recalculated on the server at checkout, so a change can never be bypassed by an old app screen. Past receipts keep the price the customer paid.</p>
      {!rows ? <Spinner /> : (
        <table className="table clickable">
          <thead><tr><th>Item</th><th>Base price</th><th>This café</th><th>Status</th></tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} onClick={() => open(p)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && open(p)}>
                <td><strong>{p.name}</strong><div className="small muted">{p.description}</div></td>
                <td>{money(p.base_price_cents)}</td>
                <td>{p.location_price_cents !== null ? money(p.location_price_cents) : <span className="muted">same</span>}</td>
                <td>{p.active ? "On menu" : <span className="muted">Hidden</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Sheet open={!!edit} onClose={() => setEdit(null)} title={`Edit ${edit?.name ?? ""}`}>
        <div className="form">
          <label className="field"><span>Name</span><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={60} /></label>
          <label className="field"><span>Description</span><textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={300} /></label>
          <label className="field"><span>Base price ($)</span><input inputMode="decimal" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></label>
          <label className="field"><span>Price at this café ($, blank = base)</span><input inputMode="decimal" value={form.localPrice} onChange={(e) => setForm({ ...form, localPrice: e.target.value })} /></label>
          <label className="check-row"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Show on menu</label>
          <Button full onClick={save}>Save changes</Button>
        </div>
      </Sheet>
    </>
  );
}

// ---------------------------------------------------------------- café settings

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function CafeSettings({ locationId }: { locationId: string }) {
  const { toast } = useStore();
  const [loc, setLoc] = useState<LocationStatus | null>(null);
  const [hours, setHours] = useState<Record<string, [string, string] | null>>({});
  const [note, setNote] = useState("");
  const [tax, setTax] = useState("");
  const [slot, setSlot] = useState(10);
  useEffect(() => {
    api<{ location: LocationStatus }>(`/locations/${locationId}`).then((r) => {
      setLoc(r.location);
      setHours(Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, r.location.hours[d] ?? null])));
      setNote(r.location.pickupNote);
      setTax((r.location.taxRateBps / 100).toString());
      setSlot(r.location.slotMinutes);
    });
  }, [locationId]);

  const save = async () => {
    const clean = Object.fromEntries(Object.entries(hours).filter(([, v]) => v)) as Record<string, [string, string]>;
    try {
      const r = await api<{ location: LocationStatus }>(`/manager/locations/${locationId}`, {
        method: "PATCH",
        body: { hours: clean, pickupNote: note, taxRateBps: Math.round(parseFloat(tax) * 100), slotMinutes: slot },
      });
      setLoc(r.location);
      toast("Café settings saved", "success");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  if (!loc) return <Spinner />;
  return (
    <>
      <h1>{loc.name}</h1>
      <div className="mgr-grid">
        <section className="card">
          <h2>Opening hours</h2>
          <p className="small muted">Times are in the café's timezone ({loc.timezone}). Use 00:00–24:00 for all day.</p>
          <table className="table">
            <tbody>
              {[1, 2, 3, 4, 5, 6, 0].map((d) => {
                const h = hours[d];
                return (
                  <tr key={d}>
                    <td>{DAY_NAMES[d]}</td>
                    <td><label className="check-row"><input type="checkbox" checked={!!h} onChange={(e) => setHours({ ...hours, [d]: e.target.checked ? ["07:00", "17:00"] : null })} /> Open</label></td>
                    <td>{h ? <><input type="time" value={h[0]} onChange={(e) => setHours({ ...hours, [d]: [e.target.value, h[1]] })} /> – <input value={h[1]} onChange={(e) => setHours({ ...hours, [d]: [h[0], e.target.value] })} size={5} aria-label="Closing time" /></> : <span className="muted">Closed</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
        <section className="card form">
          <h2>Pickup & pricing</h2>
          <label className="field"><span>Pickup instructions</span><input value={note} maxLength={160} onChange={(e) => setNote(e.target.value)} /></label>
          <label className="field"><span>Sales tax (%)</span><input inputMode="decimal" value={tax} onChange={(e) => setTax(e.target.value)} /></label>
          <label className="field"><span>Pickup slot length</span>
            <select value={slot} onChange={(e) => setSlot(Number(e.target.value))}>{[5, 10, 15, 20, 30].map((m) => <option key={m} value={m}>{m} minutes</option>)}</select>
          </label>
          <Notice tone="info">Lead time, orders per slot and pausing are on the barista display so the shift lead can react during a rush.</Notice>
        </section>
      </div>
      <Button onClick={save}>Save settings</Button>
    </>
  );
}

// ---------------------------------------------------------------- support, team, audit

function Support() {
  const { toast } = useStore();
  const [rows, setRows] = useState<any[] | null>(null);
  const [resolving, setResolving] = useState<any | null>(null);
  const [text, setText] = useState("");
  const load = () => api<{ requests: any[] }>("/manager/support").then((r) => setRows(r.requests));
  useEffect(() => { load(); }, []);
  const resolve = async () => {
    try {
      await api(`/manager/support/${resolving.id}`, { method: "PATCH", body: { resolution: text } });
      setResolving(null);
      setText("");
      load();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };
  return (
    <>
      <h1>Support requests</h1>
      {!rows ? <Spinner /> : rows.length === 0 ? <p className="muted">No requests yet.</p> : (
        <table className="table">
          <thead><tr><th>Received</th><th>Customer</th><th>Order</th><th>Topic & message</th><th></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{dateTime(r.created_at)}</td>
                <td>{r.name}<div className="small muted">{r.email}</div></td>
                <td>{r.order_number ?? "—"}</td>
                <td><strong>{r.topic}</strong><div className="small">{r.message}</div>{r.resolution ? <div className="small muted">✓ {r.resolution}</div> : null}</td>
                <td>{r.status === "OPEN" ? <Button small onClick={() => setResolving(r)}>Resolve</Button> : <span className="badge">Resolved</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Sheet open={!!resolving} onClose={() => setResolving(null)} title="Resolve request">
        <p className="small muted">Shown to the customer in the app. Issue refunds from the Orders tab first if needed.</p>
        <label className="field"><span>Resolution</span><textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} /></label>
        <Button full onClick={resolve} disabled={!text.trim()}>Mark resolved</Button>
      </Sheet>
    </>
  );
}

function Team() {
  const { toast } = useStore();
  const [staff, setStaff] = useState<{ id: string; name: string; email: string; role: string }[] | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"barista" | "manager" | "customer">("barista");
  const load = () => api<{ staff: any[] }>("/manager/staff").then((r) => setStaff(r.staff));
  useEffect(() => { load(); }, []);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api("/manager/staff", { body: { email, role } });
      toast("Role updated — they'll need to sign in again", "success");
      setEmail("");
      load();
    } catch (err) {
      toast((err as Error).message, "error");
    }
  };
  return (
    <>
      <h1>Team</h1>
      <div className="mgr-grid">
        <section className="card">
          <h2>Staff accounts</h2>
          {!staff ? <Spinner /> : (
            <table className="table"><tbody>{staff.map((s) => <tr key={s.id}><td>{s.name}</td><td className="muted">{s.email}</td><td><span className="badge">{s.role}</span></td></tr>)}</tbody></table>
          )}
        </section>
        <form className="card form" onSubmit={submit}>
          <h2>Give or remove access</h2>
          <p className="small muted">The person signs up in the customer app first, then you assign their role here.</p>
          <label className="field"><span>Email</span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
          <label className="field"><span>Role</span>
            <select value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
              <option value="barista">Barista</option><option value="manager">Manager</option><option value="customer">Remove staff access</option>
            </select>
          </label>
          <Button type="submit" full>Update role</Button>
        </form>
      </div>
    </>
  );
}

function Audit() {
  const [rows, setRows] = useState<{ id: number; action: string; target: string; detail: string; at: string; actor: string }[] | null>(null);
  useEffect(() => { api<{ entries: any[] }>("/manager/audit").then((r) => setRows(r.entries)); }, []);
  return (
    <>
      <h1>Audit log</h1>
      <p className="small muted">Every pause, sold-out change, capacity change, menu edit, refund and role change is recorded.</p>
      {!rows ? <Spinner /> : rows.length === 0 ? <p className="muted">Nothing recorded yet.</p> : (
        <table className="table">
          <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Detail</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id}><td>{dateTime(r.at)}</td><td>{r.actor ?? "—"}</td><td><span className="badge badge-muted">{r.action.replace(/_/g, " ").toLowerCase()}</span> {r.target}</td><td className="small mono">{r.detail.slice(0, 160)}</td></tr>)}</tbody>
        </table>
      )}
    </>
  );
}
