import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useStore } from "../store";
import { money, modifierText, time } from "../format";
import type { Favorite, Order, PricedLine, Rewards } from "../types";
import { ProductArt } from "../components/ProductArt";
import { Button, Icon } from "../components/ui";
import { CafeStatus, STATUS_COPY } from "../components/common";

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export function Home() {
  const { user, menu, addToCart, toast, config } = useStore();
  const nav = useNavigate();
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [rewards, setRewards] = useState<Rewards | null>(null);
  const [favorites, setFavorites] = useState<Favorite[]>([]);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    const loadAll = () => {
      api<{ orders: Order[] }>("/orders").then((r) => alive && setOrders(r.orders)).catch(() => null);
      api<Rewards>("/rewards").then((r) => alive && setRewards(r)).catch(() => null);
    };
    loadAll();
    api<{ favorites: Favorite[] }>("/favorites").then((r) => alive && setFavorites(r.favorites)).catch(() => null);
    const t = setInterval(loadAll, 10_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [user]);

  const active = (orders ?? []).filter((o) => o.active);
  const products = new Map(menu?.products.map((p) => [p.id, p]) ?? []);

  // Most recent distinct configurations from past orders.
  const recent: PricedLine[] = [];
  for (const o of orders ?? []) {
    if (o.status === "REJECTED" || o.status === "CANCELLED") continue;
    for (const l of o.lines) {
      const k = l.productId + JSON.stringify(l.selections);
      if (!recent.some((r) => r.productId + JSON.stringify(r.selections) === k)) recent.push(l);
    }
    if (recent.length >= 6) break;
  }

  const quickAdd = (productId: string, selections: PricedLine["selections"], name: string) => {
    const p = products.get(productId);
    if (!p || p.sold_out) return toast(`${name} is unavailable right now.`, "error");
    addToCart(productId, selections, 1);
    toast(`${name} added to your bag`, "success");
  };

  const threshold = config?.rewards.thresholdCents ?? 5000;
  const rewardValue = config?.rewards.rewardCents ?? 500;

  return (
    <div className="page home">
      <section className="hero">
        <div className="hero-top">
          <span className="brand-mark">Brewline</span>
          {!user ? <Link to="/signin" className="hero-signin">Sign in</Link> : null}
        </div>
        <h1>{greeting()}{user ? `, ${user.name.split(" ")[0]}` : ""}</h1>
        {menu ? (
          <div className="cafe-card">
            <button className="cafe-card-loc" onClick={() => nav("/locations")} aria-label={`Pickup café: ${menu.location.name}. Change café`}>
              <Icon name="pin" size={18} />
              <span>
                <strong>{menu.location.name}</strong>
                <CafeStatus loc={menu.location} />
              </span>
              <Icon name="chevron" size={18} />
            </button>
            <Button full variant="accent" onClick={() => nav("/menu")}>
              {menu.location.acceptingOrders ? "Start an order" : "Browse the menu"}
            </Button>
          </div>
        ) : (
          <div className="cafe-card skeleton" style={{ height: 118 }} />
        )}
      </section>

      {active.map((o) => (
        <Link key={o.id} to={`/order/${o.id}`} className={`active-order status-${o.status.toLowerCase()}`}>
          <div>
            <div className="eyebrow">Order {o.number} · {o.location.name}</div>
            <div className="active-order-title">{STATUS_COPY[o.status].title}</div>
            <div className="muted small">
              {o.status === "READY" ? o.location.pickup_note : o.scheduled ? `Scheduled for ${time(o.slotStart)}` : `Estimated pickup ${time(o.slotStart)}–${time(o.promisedAt)}`}
            </div>
          </div>
          <Icon name="chevron" />
        </Link>
      ))}

      <section className="card rewards-card">
        <div className="row-between">
          <h2>Brewline Rewards</h2>
          <Link to="/rewards" className="link">Details</Link>
        </div>
        {user && rewards ? (
          <>
            <div className="progress-label">
              <strong>{money(rewards.progressCents)}</strong> of {money(rewards.thresholdCents)} qualifying spend
            </div>
            <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={rewards.thresholdCents} aria-valuenow={rewards.progressCents} aria-label="Progress to next reward">
              <div style={{ width: `${(rewards.progressCents / rewards.thresholdCents) * 100}%` }} />
            </div>
            <div className="muted small">{money(rewards.remainingCents)} more to unlock a {money(rewards.rewardCents)} reward</div>
            <div className="reward-available">
              <Icon name="gift" size={18} />
              <span>
                Available rewards: <strong>{money(rewards.available.reduce((s, r) => s + r.value_cents, 0))}</strong>
                {rewards.available.length > 1 ? ` (${rewards.available.length} rewards)` : ""}
              </span>
            </div>
          </>
        ) : (
          <>
            <p className="muted">Every {money(threshold)} of qualifying spend unlocks a {money(rewardValue)} reward. Progress carries over — nothing resets.</p>
            {!user ? <Button variant="secondary" small onClick={() => nav("/signin?mode=signup")}>Join for free</Button> : null}
          </>
        )}
      </section>

      {user && (recent.length > 0 || favorites.length > 0) ? (
        <section>
          <div className="section-head">
            <h2>Order again</h2>
            {favorites.length ? <Link to="/account/saved" className="link">Saved drinks</Link> : null}
          </div>
          <div className="hscroll">
            {[
              ...favorites.map((f) => ({ key: f.id, productId: f.productId, selections: f.selections, title: f.name, sub: products.get(f.productId)?.name ?? "", fav: true })),
              ...recent.map((l) => ({ key: l.productId + JSON.stringify(l.selections), productId: l.productId, selections: l.selections, title: l.name, sub: modifierText(l.modifiers), fav: false })),
            ]
              .slice(0, 10)
              .map((x) => {
                const p = products.get(x.productId);
                return (
                  <div key={x.key} className="again-card">
                    <ProductArt art={p?.art ?? "latte"} size={64} />
                    <div className="again-title">{x.fav ? <Icon name="heart-fill" size={14} /> : null} {x.title}</div>
                    <div className="again-sub">{x.sub || "Standard"}</div>
                    <button className="again-add" disabled={!p || p.sold_out} onClick={() => quickAdd(x.productId, x.selections, x.title)} aria-label={`Add ${x.title} to bag`}>
                      {p?.sold_out ? "Sold out" : <><Icon name="plus" size={16} /> Add</>}
                    </button>
                  </div>
                );
              })}
          </div>
        </section>
      ) : null}

      {menu?.announcements.length ? (
        <section>
          <div className="section-head"><h2>What's new</h2></div>
          <div className="stack">
            {menu.announcements.map((a) => (
              <div key={a.id} className="announcement">
                <h3>{a.title}</h3>
                <p>{a.body}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
