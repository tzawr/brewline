import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useStore } from "../store";
import { dayLabel, money } from "../format";
import type { Order } from "../types";
import { Button, Notice, PageHeader } from "../components/ui";

const TOPICS = ["Order is late", "Item missing or wrong", "Charged incorrectly", "Missing receipt", "Rewards question", "Account", "Something else"];

export function HelpPage() {
  const [params] = useSearchParams();
  const { user } = useStore();
  const nav = useNavigate();
  const [orders, setOrders] = useState<Order[]>([]);
  const [orderId, setOrderId] = useState(params.get("order") ?? "");
  const [topic, setTopic] = useState(params.get("topic") ?? (params.get("order") ? "Order is late" : TOPICS[0]));
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requests, setRequests] = useState<{ id: string; topic: string; status: string; resolution: string | null; created_at: string }[]>([]);

  useEffect(() => {
    if (!user) return;
    api<{ orders: Order[] }>("/orders").then((r) => setOrders(r.orders)).catch(() => null);
    api<{ requests: typeof requests }>("/support").then((r) => setRequests(r.requests)).catch(() => null);
  }, [user, done]);

  if (!user)
    return (
      <div className="page">
        <PageHeader title="Help" back />
        <p className="muted">Sign in so we can look up your orders and receipts.</p>
        <Button onClick={() => nav(`/signin?next=/help`)}>Sign in</Button>
      </div>
    );

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ reference: string }>("/support", { body: { orderId: orderId || undefined, topic, message } });
      setDone(r.reference);
      setMessage("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <PageHeader title="Get help" back />
      {done ? (
        <Notice tone="success">Thanks — we've got it. Your reference is <strong>{done}</strong>. A café manager will follow up by email.</Notice>
      ) : (
        <form onSubmit={submit} className="form">
          <label className="field">
            <span>Which order?</span>
            <select value={orderId} onChange={(e) => setOrderId(e.target.value)}>
              <option value="">Not about a specific order</option>
              {orders.map((o) => (
                <option key={o.id} value={o.id}>{o.number} · {dayLabel(o.createdAt)} · {money(o.totalCents)}</option>
              ))}
            </select>
            <span className="hint">We attach the order details automatically so you don't have to explain them.</span>
          </label>
          <label className="field">
            <span>Topic</span>
            <select value={topic} onChange={(e) => setTopic(e.target.value)}>{TOPICS.map((t) => <option key={t}>{t}</option>)}</select>
          </label>
          {topic === "Missing receipt" ? (
            <Notice tone="info">Receipts for app orders appear in Activity under the account you ordered with. If you paid at the counter, include the time, café and last 4 digits of the card.</Notice>
          ) : null}
          <label className="field">
            <span>What happened?</span>
            <textarea rows={5} value={message} onChange={(e) => setMessage(e.target.value)} required minLength={5} maxLength={2000} />
          </label>
          {error ? <Notice tone="error">{error}</Notice> : null}
          <Button type="submit" full busy={busy}>Send to the café team</Button>
        </form>
      )}
      {requests.length ? (
        <section>
          <div className="section-head"><h2>Your requests</h2></div>
          <ul className="ledger">
            {requests.map((r) => (
              <li key={r.id}>
                <div>
                  <div className="strong">{r.topic} · {r.id.slice(-6).toUpperCase()}</div>
                  <div className="small muted">{r.resolution ?? "We're looking into it."} · {dayLabel(r.created_at)}</div>
                </div>
                <span className={`badge ${r.status === "RESOLVED" ? "" : "badge-muted"}`}>{r.status === "RESOLVED" ? "Resolved" : "Open"}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
