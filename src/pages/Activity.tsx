import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useStore } from "../store";
import { dayLabel, money, time } from "../format";
import type { Order } from "../types";
import { Button, Empty, Icon, PageHeader, Spinner } from "../components/ui";
import { STATUS_COPY } from "../components/common";

export function ActivityPage() {
  const { user, userLoaded } = useStore();
  const nav = useNavigate();
  const [orders, setOrders] = useState<Order[] | null>(null);

  useEffect(() => {
    if (!user) return;
    const load = () => api<{ orders: Order[] }>("/orders").then((r) => setOrders(r.orders)).catch(() => null);
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [user]);

  if (!userLoaded) return <Spinner />;
  if (!user)
    return (
      <div className="page">
        <PageHeader title="Activity" />
        <Empty icon="receipt" title="Your orders and receipts live here" body="Sign in to see current orders, itemized receipts and refunds." action={<Button onClick={() => nav("/signin?next=/activity")}>Sign in</Button>} />
      </div>
    );
  if (!orders) return <Spinner label="Loading orders" />;

  const active = orders.filter((o) => o.active);
  const past = orders.filter((o) => !o.active);

  return (
    <div className="page">
      <PageHeader title="Activity" />
      {orders.length === 0 ? (
        <Empty
          icon="receipt"
          title="No orders yet"
          body="When you place an order, its live status and receipt will show up here."
          action={
            <div className="stack">
              <Button onClick={() => nav("/menu")}>Start an order</Button>
              <Link to="/help?topic=Missing%20receipt" className="link">Missing a receipt?</Link>
            </div>
          }
        />
      ) : null}
      {active.length ? (
        <section>
          <div className="section-head"><h2>In progress</h2></div>
          <ul className="order-list">{active.map((o) => <OrderRow key={o.id} o={o} />)}</ul>
        </section>
      ) : null}
      {past.length ? (
        <section>
          <div className="section-head"><h2>Past orders & receipts</h2></div>
          <ul className="order-list">{past.map((o) => <OrderRow key={o.id} o={o} />)}</ul>
          <p className="center small"><Link to="/help?topic=Missing%20receipt" className="link">Missing a receipt?</Link></p>
        </section>
      ) : null}
    </div>
  );
}

function OrderRow({ o }: { o: Order }) {
  const items = o.lines.reduce((s, l) => s + l.quantity, 0);
  return (
    <li>
      <Link to={`/order/${o.id}`} className="order-row">
        <div>
          <div className="strong">{o.lines.map((l) => l.name).slice(0, 2).join(", ")}{o.lines.length > 2 ? ` +${o.lines.length - 2} more` : ""}</div>
          <div className="small muted">
            {dayLabel(o.createdAt, o.location.timezone)} · {time(o.createdAt, o.location.timezone)} · {o.location.name} · {items} item{items > 1 ? "s" : ""}
          </div>
          <span className={`badge status-badge s-${o.status.toLowerCase()}`}>{STATUS_COPY[o.status].title}</span>
          {o.refundedCents ? <span className="badge badge-muted">Refunded {money(o.refundedCents)}</span> : null}
        </div>
        <div className="order-row-right">
          <span className="strong">{money(o.totalCents)}</span>
          <Icon name="chevron" size={18} />
        </div>
      </Link>
    </li>
  );
}
