import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, ApiError, uid } from "../api";
import { useStore } from "../store";
import { dayLabel, money, modifierText, time } from "../format";
import type { Order, Quote, Rewards } from "../types";
import { ProductArt } from "../components/ProductArt";
import { Button, Empty, Icon, Notice, PageHeader, Stepper } from "../components/ui";

type Pickup = { type: "asap" } | { type: "scheduled"; slotStart: string };

interface Problem { index: number; code: string; message: string }

const PENDING_KEY = "bl.pendingCheckout";

export function BagPage() {
  const { cart, menu, user, locationId, updateLine, removeLine, clearCart, config, toast, online } = useStore();
  const nav = useNavigate();
  const [pickup, setPickup] = useState<Pickup>({ type: "asap" });
  const [quote, setQuote] = useState<Quote | null>(null);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [rewards, setRewards] = useState<Rewards | null>(null);
  const [useReward, setUseReward] = useState(false);
  const [method, setMethod] = useState<"demo" | "stripe">("demo");
  const [phase, setPhase] = useState<"idle" | "placing" | "checking" | "uncertain">("idle");
  const [notice, setNotice] = useState<string | null>(null);
  const keyRef = useRef<string | null>(null);

  useEffect(() => {
    if (config) setMethod(config.payments.stripe ? "stripe" : "demo");
  }, [config]);

  useEffect(() => {
    if (user) api<Rewards>("/rewards").then(setRewards).catch(() => null);
  }, [user]);

  const rewardId = useReward && rewards?.available[0] ? rewards.available[0].id : null;
  const lines = useMemo(() => cart.map((l) => ({ productId: l.productId, quantity: l.quantity, selections: l.selections })), [cart]);
  const requestBody = useMemo(() => ({ locationId, lines, pickup, rewardId }), [locationId, lines, pickup, rewardId]);
  const requestSig = JSON.stringify([requestBody, method]);

  // A new idempotency key whenever the order content changes; retries of the same content reuse it.
  const sigRef = useRef<string>("");
  if (sigRef.current !== requestSig) {
    sigRef.current = requestSig;
    try {
      const pending = JSON.parse(localStorage.getItem(PENDING_KEY) ?? "null");
      keyRef.current = pending?.sig === requestSig ? pending.key : uid();
    } catch {
      keyRef.current = uid();
    }
  }

  const refreshQuote = useCallback(async () => {
    if (!lines.length) return setQuote(null);
    try {
      const r = await api<{ quote: Quote }>("/quotes", { body: requestBody });
      setQuote(r.quote);
      setProblems([]);
      setQuoteError(null);
    } catch (e) {
      const err = e as ApiError;
      if (err.code === "CART_INVALID") setProblems(err.details?.problems ?? []);
      else if (err.code === "SLOT_UNAVAILABLE") {
        setPickup({ type: "asap" });
        setNotice(err.message);
      } else if (err.code === "REWARD_UNAVAILABLE") {
        setUseReward(false);
        setNotice(err.message);
      } else setQuoteError(err.message);
      setQuote(null);
    }
  }, [lines.length, requestBody]);

  useEffect(() => {
    const t = setTimeout(refreshQuote, 150);
    return () => clearTimeout(t);
  }, [refreshQuote]);

  const products = new Map(menu?.products.map((p) => [p.id, p]) ?? []);
  const loc = menu?.location;

  const place = async (attempt = 0): Promise<void> => {
    if (!quote || !keyRef.current) return;
    setPhase(attempt ? "checking" : "placing");
    setNotice(null);
    const payload = { ...requestBody, idempotencyKey: keyRef.current, expectedTotalCents: quote.totalCents, paymentMethod: method };
    try {
      localStorage.setItem(PENDING_KEY, JSON.stringify({ key: keyRef.current, sig: requestSig, at: Date.now() }));
    } catch { /* ignore */ }
    try {
      const r = await api<{ order: Order; next: { type: "track" } | { type: "redirect"; url: string } }>("/checkout", { body: payload });
      localStorage.removeItem(PENDING_KEY);
      if (r.next.type === "redirect") {
        window.location.assign(r.next.url);
        return;
      }
      if (r.order.status === "CANCELLED" || r.order.status === "REJECTED") {
        setPhase("idle");
        keyRef.current = uid();
        setNotice("That checkout didn't go through and you weren't charged. Please try again.");
        return;
      }
      clearCart();
      nav(`/order/${r.order.id}`, { replace: true });
    } catch (e) {
      const err = e as ApiError;
      if (err.code === "NETWORK" || err.status >= 500) {
        // Unknown outcome: retry with the SAME key, which returns the original order if it was created.
        if (attempt < 3) {
          await new Promise((res) => setTimeout(res, 1000 * 2 ** attempt));
          return place(attempt + 1);
        }
        setPhase("uncertain");
        return;
      }
      localStorage.removeItem(PENDING_KEY);
      setPhase("idle");
      if (err.code === "PRICE_CHANGED" && err.details?.quote) {
        setQuote(err.details.quote);
        setNotice("Prices changed since you opened your bag. Please check the new total and place your order again.");
      } else if (err.code === "CART_INVALID") {
        setProblems(err.details?.problems ?? []);
      } else if (err.code === "AUTH_REQUIRED") {
        nav("/signin?next=/bag");
      } else {
        setNotice(err.message);
        refreshQuote();
      }
      keyRef.current = uid();
    }
  };

  if (!cart.length)
    return (
      <div className="page">
        <PageHeader title="Your bag" back />
        <Empty icon="bag" title="Your bag is empty" body="Pick a drink or something to eat to get started." action={<Button onClick={() => nav("/menu")}>Start an order</Button>} />
      </div>
    );

  if (phase === "checking" || phase === "uncertain")
    return (
      <div className="page">
        <PageHeader title="Checking your order" />
        <div className="checking">
          {phase === "checking" ? <span className="spinner spinner-dark big" aria-hidden="true" /> : <Icon name="help" size={40} />}
          <h2>{phase === "checking" ? "Checking your order…" : "We couldn't confirm your order yet"}</h2>
          <p className="muted">
            {phase === "checking"
              ? "The connection dropped while placing your order. We're checking whether it went through — you won't be charged twice."
              : "Your connection seems unstable. Tapping “Check again” looks up the same order — it never places a second one."}
          </p>
          {phase === "uncertain" ? (
            <div className="stack">
              <Button full onClick={() => place(1)}>Check again</Button>
              <Button full variant="secondary" onClick={() => nav("/activity")}>View my orders</Button>
            </div>
          ) : null}
        </div>
      </div>
    );

  const blocked = !quote || !!problems.length || !quote.location.acceptingOrders || !quote.pickup.slotStart || !online;
  const anyPayment = !!config && (config.payments.demo || config.payments.stripe);

  return (
    <div className="page bag-page">
      <PageHeader title="Review order" back />

      {loc ? (
        <div className="card pickup-card">
          <div className="row-between">
            <div>
              <div className="eyebrow">Pickup at</div>
              <div className="strong">{loc.name}</div>
              <div className="small muted">{loc.pickupNote}</div>
            </div>
            <Link to="/locations" className="link">Change</Link>
          </div>
          {loc.acceptingOrders ? (
            <div className="pickup-options" role="radiogroup" aria-label="Pickup time">
              <label className={`pill-option${pickup.type === "asap" ? " on" : ""}`}>
                <input type="radio" name="pickup" checked={pickup.type === "asap"} onChange={() => setPickup({ type: "asap" })} />
                <Icon name="clock" size={16} /> As soon as possible{loc.estimateMin ? ` · ~${loc.estimateMin} min` : ""}
              </label>
              <label className={`pill-option${pickup.type === "scheduled" ? " on" : ""}`}>
                <input type="radio" name="pickup" checked={pickup.type === "scheduled"} onChange={() => loc.slots[1] && setPickup({ type: "scheduled", slotStart: loc.slots[1] ?? loc.slots[0] })} disabled={loc.slots.length < 2} />
                Schedule for later
              </label>
              {pickup.type === "scheduled" ? (
                <select aria-label="Pickup window" value={pickup.slotStart} onChange={(e) => setPickup({ type: "scheduled", slotStart: e.target.value })}>
                  {loc.slots.slice(0, 48).map((s) => (
                    <option key={s} value={s}>{dayLabel(s, loc.timezone)} · {time(s, loc.timezone)} – {time(new Date(Date.parse(s) + loc.slotMinutes * 60000).toISOString(), loc.timezone)}</option>
                  ))}
                </select>
              ) : null}
            </div>
          ) : (
            <Notice tone="warn">
              {loc.paused ? `Mobile orders are paused${loc.pauseReason ? `: ${loc.pauseReason}` : ""}. Your bag is saved.` : !loc.open ? "This café is closed right now. Your bag is saved for when it opens." : "All pickup times are full. Please try again in a few minutes."}
            </Notice>
          )}
        </div>
      ) : null}

      {notice ? <Notice tone="warn">{notice}</Notice> : null}
      {quoteError ? <Notice tone="error">{quoteError}</Notice> : null}

      <ul className="bag-lines">
        {cart.map((l, i) => {
          const p = products.get(l.productId);
          const priced = quote?.lines[i];
          const problem = problems.find((x) => x.index === i);
          return (
            <li key={l.key} className={`bag-line${problem ? " has-problem" : ""}`}>
              <ProductArt art={p?.art ?? "latte"} size={56} />
              <div className="bag-line-body">
                <div className="row-between">
                  <span className="strong">{p?.name ?? "Unavailable item"}</span>
                  <span>{priced ? money(priced.lineCents) : ""}</span>
                </div>
                {priced ? <div className="small muted">{modifierText(priced.modifiers)}</div> : null}
                {problem ? <div className="line-problem" role="alert">{problem.message}</div> : null}
                <div className="bag-line-actions">
                  <Stepper label={`${p?.name ?? "item"} quantity`} value={l.quantity} min={1} max={10} onChange={(v) => updateLine(l.key, { quantity: v })} />
                  {p ? <button className="link" onClick={() => nav(`/menu/${p.id}`, { state: { editKey: l.key } })}>Edit</button> : null}
                  <button className="link danger" onClick={() => removeLine(l.key)}>Remove</button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      <Link to="/menu" className="add-more"><Icon name="plus" size={18} /> Add more items</Link>

      {user && rewards ? (
        <div className="card">
          {rewards.available.length ? (
            <label className="toggle-row">
              <div>
                <div className="strong">Use {money(rewards.available[0].value_cents)} reward</div>
                <div className="small muted">Applied before tax. Rewards aren't payment — any unused value on this order isn't kept.</div>
              </div>
              <input type="checkbox" role="switch" checked={useReward} onChange={(e) => setUseReward(e.target.checked)} />
            </label>
          ) : (
            <div className="small muted">
              <Icon name="star" size={14} /> {money(rewards.remainingCents)} more qualifying spend unlocks your next {money(rewards.rewardCents)} reward.
            </div>
          )}
        </div>
      ) : null}

      {quote ? (
        <div className="card totals">
          <div className="row-between"><span>Subtotal</span><span>{money(quote.subtotalCents)}</span></div>
          {quote.discountCents ? <div className="row-between reward-line"><span>Reward</span><span>−{money(quote.discountCents)}</span></div> : null}
          <div className="row-between"><span>Tax ({(quote.taxRateBps / 100).toFixed(2).replace(/\.?0+$/, "")}%)</span><span>{money(quote.taxCents)}</span></div>
          <div className="row-between total"><span>Total</span><span>{money(quote.totalCents)}</span></div>
          {user ? (
            <div className="earn-note"><Icon name="star" size={14} /> This order adds {money(quote.qualifyingCents)} toward your next reward once it's ready.</div>
          ) : null}
        </div>
      ) : null}

      {user && quote && quote.totalCents > 0 && anyPayment ? (
        <div className="card">
          <div className="eyebrow">Pay with</div>
          {config!.payments.stripe ? (
            <label className={`pay-option${method === "stripe" ? " on" : ""}`}>
              <input type="radio" name="pay" checked={method === "stripe"} onChange={() => setMethod("stripe")} />
              <span><strong>Card, Apple Pay or Google Pay</strong><br /><span className="small muted">Secure checkout by Stripe. Authorized now, charged when the café accepts.</span></span>
            </label>
          ) : null}
          {config!.payments.demo ? (
            <label className={`pay-option${method === "demo" ? " on" : ""}`}>
              <input type="radio" name="pay" checked={method === "demo"} onChange={() => setMethod("demo")} />
              <span><strong>Demo card •••• 4242</strong><br /><span className="small muted">Portfolio demo — no real money moves.</span></span>
            </label>
          ) : null}
        </div>
      ) : null}

      <div className="sticky-cta column">
        {!user ? (
          <Button full onClick={() => nav("/signin?next=/bag")}>Sign in to place order</Button>
        ) : (
          <Button full busy={phase === "placing"} disabled={blocked || (quote!.totalCents > 0 && !anyPayment)} onClick={() => place(0)}>
            {!online ? "You're offline" : quote ? `Place order · ${money(quote.totalCents)}` : "Checking prices…"}
          </Button>
        )}
        <p className="tiny muted center">Orders can be cancelled until the café accepts them.</p>
      </div>
    </div>
  );
}
