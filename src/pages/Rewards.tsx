import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { useStore } from "../store";
import { dayLabel, money } from "../format";
import type { Rewards } from "../types";
import { Button, Empty, Icon, PageHeader, Spinner } from "../components/ui";

const KIND_LABEL: Record<string, string> = {
  EARN: "Earned", REVERSE: "Refund adjustment", UNLOCK: "Reward unlocked", RESERVE: "Reward held", REDEEM: "Reward used",
  RELEASE: "Reward returned", EXPIRE: "Reward expired", ADJUST: "Adjustment",
};

export function RewardsPage() {
  const { user, config } = useStore();
  const nav = useNavigate();
  const [r, setR] = useState<Rewards | null>(null);

  useEffect(() => {
    if (user) api<Rewards>("/rewards").then(setR).catch(() => null);
  }, [user]);

  if (!user) {
    const t = config?.rewards.thresholdCents ?? 5000;
    const v = config?.rewards.rewardCents ?? 500;
    return (
      <div className="page">
        <PageHeader title="Rewards" />
        <div className="rewards-hero">
          <Icon name="star" size={36} />
          <h2>Spend {money(t)}, get {money(v)}</h2>
          <p>Every {money(t)} of qualifying spend on mobile orders unlocks a {money(v)} reward. Extra spend carries over. No points to convert, no tiers to decode.</p>
          <Button variant="accent" onClick={() => nav("/signin?mode=signup&next=/rewards")}>Join Brewline Rewards</Button>
        </div>
      </div>
    );
  }
  if (!r) return <Spinner label="Loading rewards" />;
  const availableTotal = r.available.reduce((s, x) => s + x.value_cents, 0);

  return (
    <div className="page">
      <PageHeader title="Rewards" />
      <section className="rewards-hero">
        <div className="eyebrow light">{r.program.name}</div>
        <div className="ring" style={{ ["--p" as string]: `${(r.progressCents / r.thresholdCents) * 100}%` }} role="progressbar" aria-valuemin={0} aria-valuemax={r.thresholdCents} aria-valuenow={r.progressCents} aria-label="Progress to next reward">
          <div>
            <strong>{money(r.progressCents)}</strong>
            <span>of {money(r.thresholdCents)}</span>
          </div>
        </div>
        <p className="hero-sub">{money(r.remainingCents)} more qualifying spend to unlock a {money(r.rewardCents)} reward</p>
        {r.adjustmentCents > 0 ? <p className="small light">Includes a {money(r.adjustmentCents)} adjustment from a refunded order that had already counted toward a reward.</p> : null}
        {r.pendingCents > 0 ? <p className="small light">+{money(r.pendingCents)} pending from orders in progress — added when they're ready.</p> : null}
      </section>

      <section className="card">
        <div className="row-between">
          <h2>Available to use</h2>
          <strong className="big-number">{money(availableTotal)}</strong>
        </div>
        {r.available.length ? (
          <ul className="reward-list">
            {r.available.map((x) => (
              <li key={x.id}>
                <Icon name="gift" size={20} />
                <span><strong>{money(x.value_cents)} reward</strong><br /><span className="small muted">Use by {new Date(x.expires_at).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}</span></span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small">No rewards yet. They appear here as soon as you reach {money(r.thresholdCents)}.</p>
        )}
        {r.held.length ? <p className="small muted">{r.held.map((h) => `${money(h.value_cents)} held for order ${h.number ?? ""}`).join(" · ")}</p> : null}
        {r.available.length ? <Button full variant="secondary" onClick={() => nav("/menu")}>Use on an order</Button> : null}
      </section>

      <section className="card">
        <h2>How it works</h2>
        <ul className="rules">{r.program.rules.map((x) => <li key={x}>{x}</li>)}</ul>
        <p className="tiny muted">Program version {r.program.version}</p>
      </section>

      <section>
        <div className="section-head"><h2>Activity</h2></div>
        {r.activity.length ? (
          <ul className="ledger">
            {r.activity.map((a, i) => (
              <li key={i}>
                <div>
                  <div className="strong">{KIND_LABEL[a.kind] ?? a.kind}</div>
                  <div className="small muted">{a.note} · {dayLabel(a.created_at)}</div>
                </div>
                {a.progress_cents ? <span className={a.progress_cents > 0 ? "pos" : "neg"}>{a.progress_cents > 0 ? "+" : "−"}{money(Math.abs(a.progress_cents))}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <Empty icon="star" title="No activity yet" body="Your first order will start your progress." />
        )}
      </section>
    </div>
  );
}
