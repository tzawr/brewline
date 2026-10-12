import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../api";
import { useStore } from "../store";
import { dateTime, minutesAgo, money, time } from "../format";
import type { Order, OrderStatus } from "../types";
import { Button, Icon, Notice, PageHeader, Spinner } from "../components/ui";
import { STATUS_COPY } from "../components/common";

const STEPS: { key: OrderStatus[]; label: string }[] = [
  { key: ["PENDING_ACCEPTANCE"], label: "Sent" },
  { key: ["ACCEPTED"], label: "Confirmed" },
  { key: ["PREPARING"], label: "Preparing" },
  { key: ["READY", "COMPLETED"], label: "Ready" },
];
const ORDER: OrderStatus[] = ["PENDING_ACCEPTANCE", "ACCEPTED", "PREPARING", "READY", "COMPLETED"];

export function OrderPage() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const { clearCart, toast } = useStore();
  const nav = useNavigate();
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<number>(Date.now());
  const [cancelling, setCancelling] = useState(false);
  const [notifyOn, setNotifyOn] = useState(typeof Notification !== "undefined" && Notification.permission === "granted");
  const prevStatus = useRef<OrderStatus | null>(null);
  const checkoutParam = params.get("checkout");

  const load = useCallback(async () => {
    try {
      const r = await api<{ order: Order }>(`/orders/${id}`);
      setOrder((cur) => (cur && cur.stateVersion > r.order.stateVersion ? cur : r.order));
      setLastSync(Date.now());
      setError(null);
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 401) nav(`/signin?next=/order/${id}`);
      else setError(err.message);
    }
  }, [id, nav]);

  // Stripe "back" button: release the hold and keep the bag.
  useEffect(() => {
    if (checkoutParam !== "cancel") return;
    api<{ order: Order | null }>(`/orders/${id}/cancel`, { body: {} })
      .then((r) => r.order && setOrder(r.order))
      .catch((e: ApiError) => (e.code === "ALREADY_PAID" ? load() : null))
      .finally(() => setParams({}, { replace: true }));
  }, [checkoutParam, id, load, setParams]);

  useEffect(() => {
    load();
    const t = setInterval(() => document.visibilityState === "visible" && load(), 4000);
    const vis = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", vis);
    window.addEventListener("focus", vis);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", vis);
      window.removeEventListener("focus", vis);
    };
  }, [load]);

  useEffect(() => {
    if (!order) return;
    const prev = prevStatus.current;
    prevStatus.current = order.status;
    // Card payment confirmed after the Stripe redirect: the bag has become this order.
    if (order.paymentProvider === "stripe" && order.status !== "AWAITING_PAYMENT" && order.status !== "CANCELLED" && checkoutParam === "return") {
      clearCart();
      setParams({}, { replace: true });
    }
    if (prev && prev !== order.status && order.status === "READY") {
      navigator.vibrate?.([200, 100, 200]);
      if (notifyOn) new Notification(`Order ${order.number} is ready`, { body: order.location.pickup_note, tag: order.id });
    }
  }, [order, notifyOn, clearCart, checkoutParam, setParams]);

  const enableNotify = async () => {
    if (typeof Notification === "undefined") return toast("Your browser doesn't support notifications. Keep this page open to see updates.", "info");
    const p = await Notification.requestPermission();
    setNotifyOn(p === "granted");
    if (p !== "granted") toast("Notifications are off. This page still updates on its own.", "info");
  };

  const cancel = async () => {
    if (!order || !window.confirm("Cancel this order? Your payment hold will be released.")) return;
    setCancelling(true);
    try {
      const r = await api<{ order: Order }>(`/orders/${order.id}/cancel`, { body: {} });
      setOrder(r.order);
      toast("Order cancelled", "success");
    } catch (e) {
      toast((e as Error).message, "error");
      load();
    } finally {
      setCancelling(false);
    }
  };

  if (error && !order) return <div className="page"><PageHeader title="Order" back="/activity" /><Notice tone="error">{error}</Notice></div>;
  if (!order) return <Spinner label="Loading order" />;

  const copy = STATUS_COPY[order.status];
  const idx = ORDER.indexOf(order.status);
  const tz = order.location.timezone;
  const failed = order.status === "REJECTED" || order.status === "CANCELLED";
  const waitingTooLong = order.status === "PENDING_ACCEPTANCE" && Date.now() - Date.parse(order.createdAt) > 5 * 60000;
  const stale = Date.now() - lastSync > 20000;

  return (
    <div className="page order-page">
      <PageHeader title={`Order ${order.number}`} back="/activity" />

      <section className={`status-hero status-${order.status.toLowerCase()}`}>
        {order.status === "AWAITING_PAYMENT" ? <span className="spinner big" aria-hidden="true" /> : null}
        <div className="status-number" aria-label={`Pickup code ${order.number}`}>{order.number}</div>
        <h2 aria-live="polite">{copy.title}</h2>
        <p>
          {order.status === "READY"
            ? order.location.pickup_note
            : failed && order.rejectReason
              ? `${order.rejectReason}. ${order.paymentProvider === "none" ? "Your reward has been returned." : order.paymentStatus === "VOIDED" || order.paymentStatus === "FAILED" ? "You haven't been charged." : ""}`
              : order.status === "PENDING_ACCEPTANCE" && order.paymentProvider !== "stripe"
                ? "Your order is waiting for a barista to confirm it."
                : copy.body}
        </p>
        {order.active && order.status !== "READY" ? (
          <div className="status-eta">
            <Icon name="clock" size={16} />
            {order.scheduled ? `Scheduled pickup ${time(order.slotStart, tz)}–${time(order.promisedAt, tz)}` : `Estimated pickup ${time(order.slotStart, tz)}–${time(order.promisedAt, tz)}`}
          </div>
        ) : null}
      </section>

      {!failed && order.status !== "AWAITING_PAYMENT" ? (
        <ol className="timeline" aria-label="Order progress">
          {STEPS.map((s, i) => {
            const stepIdx = ORDER.indexOf(s.key[0]);
            const done = idx >= stepIdx;
            const current = s.key.includes(order.status);
            return (
              <li key={s.label} className={`${done ? "done" : ""}${current ? " current" : ""}`} aria-current={current ? "step" : undefined}>
                <span className="dot">{done ? <Icon name="check" size={14} /> : i + 1}</span>
                <span>{s.label}</span>
              </li>
            );
          })}
        </ol>
      ) : null}

      {waitingTooLong ? (
        <Notice tone="warn">
          The café hasn't confirmed your order yet. It may be busy — if it's not confirmed soon, you can cancel for free or <Link to={`/help?order=${order.id}`}>get help</Link>.
        </Notice>
      ) : null}

      {order.active ? (
        <div className="sync-row">
          <span className={`sync-dot${stale ? " stale" : ""}`} aria-hidden="true" />
          <span className="small muted">{stale ? `Last updated ${minutesAgo(new Date(lastSync).toISOString())} — reconnecting` : "Live — updates automatically"}</span>
          {!notifyOn && order.status !== "READY" ? <button className="link small" onClick={enableNotify}>Notify me when ready</button> : null}
        </div>
      ) : null}

      {failed && order.lines.length ? (
        <Button full variant="secondary" onClick={() => nav("/bag")}>Back to my bag</Button>
      ) : null}

      <section className="card receipt" aria-label="Receipt">
        <div className="row-between">
          <h2>Receipt</h2>
          <button className="link" onClick={() => window.print()}>Print / save</button>
        </div>
        <div className="small muted">{order.location.name} · {dateTime(order.createdAt, tz)}</div>
        <ul className="receipt-lines">
          {order.lines.map((l, i) => (
            <li key={i}>
              <div className="row-between">
                <span>{l.quantity > 1 ? `${l.quantity}× ` : ""}{l.name}</span>
                <span>{money(l.lineCents)}</span>
              </div>
              <div className="small muted">
                {l.modifiers.map((m, j) => (
                  <span key={j}>{j ? " · " : ""}{m.quantity > 1 ? `${m.quantity}× ` : ""}{m.option}{m.priceCents ? ` (+${money(m.priceCents)})` : ""}</span>
                ))}
              </div>
            </li>
          ))}
        </ul>
        <div className="totals">
          <div className="row-between"><span>Subtotal</span><span>{money(order.subtotalCents)}</span></div>
          {order.discountCents ? <div className="row-between reward-line"><span>Reward applied</span><span>−{money(order.discountCents)}</span></div> : null}
          <div className="row-between"><span>Tax</span><span>{money(order.taxCents)}</span></div>
          <div className="row-between total"><span>Total</span><span>{money(order.totalCents)}</span></div>
          {order.refunds.map((r) => (
            <div key={r.id} className="row-between refund-line">
              <span>Refund · {r.reason} <span className="badge badge-muted">{r.status === "SUCCEEDED" ? "Issued" : r.status.toLowerCase()}</span></span>
              <span>−{money(r.amount_cents)}</span>
            </div>
          ))}
          {order.refundedCents ? <div className="row-between strong"><span>Net paid</span><span>{money(order.totalCents - order.refundedCents)}</span></div> : null}
        </div>
        <div className="small muted receipt-foot">
          {order.tender ? <div>Paid with: {order.tender}{order.paymentStatus === "AUTHORIZED" ? " (authorized, not yet charged)" : order.paymentStatus === "VOIDED" ? " (hold released)" : ""}</div> : null}
          {order.refunds.length ? <div>Refunds go back to your original payment method. Banks usually post them within 5–10 business days.</div> : null}
          <div>Order reference: {order.id}</div>
        </div>
      </section>

      <div className="stack">
        {order.status === "PENDING_ACCEPTANCE" ? <Button full variant="secondary" busy={cancelling} onClick={cancel}>Cancel order</Button> : null}
        <Button full variant="ghost" onClick={() => nav(`/help?order=${order.id}`)}><Icon name="help" size={18} /> Get help with this order</Button>
      </div>
    </div>
  );
}
