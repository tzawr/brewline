import {
  ACTIVE_STATUSES,
  DomainError,
  REWARDS,
  canTransition,
  computeTotals,
  priceLine,
  reversalFor,
  rewardsSummary,
  type CartLineInput,
  type OrderStatus,
  type PricedLine,
} from "./domain";
import { getLocation, loadMenu, locationStatus } from "./menu";
import { newId, nowIso, sha256, type Env, type User } from "./http";
import { capturePayment, demoEnabled, getCheckoutSession, refundPayment, stripeEnabled, voidPayment, expireCheckoutSession } from "./payments";

export interface OrderRow {
  id: string;
  number: string;
  user_id: string;
  location_id: string;
  customer_name: string;
  idempotency_key: string;
  request_hash: string;
  status: OrderStatus;
  state_version: number;
  payment_status: "NONE" | "PROCESSING" | "AUTHORIZED" | "CAPTURED" | "FAILED" | "VOIDED";
  payment_provider: "none" | "demo" | "stripe";
  payment_ref: string | null;
  payment_session_id: string | null;
  tender_label: string | null;
  scheduled: number;
  slot_start: string;
  promised_at: string;
  lines_json: string;
  subtotal_cents: number;
  discount_cents: number;
  tax_cents: number;
  total_cents: number;
  refunded_cents: number;
  reward_id: string | null;
  reject_reason: string | null;
  created_at: string;
  updated_at: string;
  ready_at: string | null;
  completed_at: string | null;
}

export interface PickupChoice {
  type: "asap" | "scheduled";
  slotStart?: string;
}

// ---------------------------------------------------------------- quotes

export async function buildQuote(db: D1Database, user: User | null, input: { locationId: string; lines: CartLineInput[]; pickup: PickupChoice; rewardId?: string | null }) {
  if (!Array.isArray(input.lines) || input.lines.length === 0) throw new DomainError("EMPTY_CART", "Your bag is empty.");
  if (input.lines.length > 20) throw new DomainError("CART_TOO_LARGE", "That's a big order! Please split it into orders of up to 20 items.");
  const loc = await getLocation(db, input.locationId);
  const status = await locationStatus(db, loc);
  const menu = await loadMenu(db, loc.id);
  const byId = new Map(menu.products.map((p) => [p.id, p]));

  const lines: PricedLine[] = [];
  const problems: { index: number; code: string; message: string }[] = [];
  input.lines.forEach((l, index) => {
    try {
      lines.push(priceLine(byId.get(l.productId), l, menu.soldOutIngredients));
    } catch (e) {
      if (e instanceof DomainError) problems.push({ index, code: e.code, message: e.message });
      else throw e;
    }
  });
  if (problems.length) throw new DomainError("CART_INVALID", problems[0].message, 409, { problems });

  let rewardCents = 0;
  if (input.rewardId) {
    if (!user) throw new DomainError("AUTH_REQUIRED", "Sign in to use a reward.", 401);
    const r = await db
      .prepare("SELECT value_cents FROM rewards WHERE id = ? AND user_id = ? AND status = 'AVAILABLE' AND expires_at > ?")
      .bind(input.rewardId, user.id, nowIso())
      .first<{ value_cents: number }>();
    if (!r) throw new DomainError("REWARD_UNAVAILABLE", "That reward is no longer available.", 409);
    rewardCents = r.value_cents;
  }

  const totals = computeTotals(lines, loc.tax_rate_bps, rewardCents);
  let slotStart: string | null;
  if (input.pickup?.type === "scheduled") {
    if (!input.pickup.slotStart || !status.slots.includes(input.pickup.slotStart))
      throw new DomainError("SLOT_UNAVAILABLE", "That pickup time just filled up. Please choose another.", 409);
    slotStart = input.pickup.slotStart;
  } else slotStart = status.asapSlot;

  const reward = rewardsSummary(0);
  return {
    location: { id: loc.id, name: loc.name, pickupNote: loc.pickup_note, acceptingOrders: status.acceptingOrders, paused: status.paused, open: status.open, pauseReason: status.pauseReason, nextOpenAt: status.nextOpenAt },
    lines,
    ...totals,
    taxRateBps: loc.tax_rate_bps,
    rewardId: input.rewardId ?? null,
    pickup: { type: input.pickup?.type === "scheduled" ? "scheduled" : "asap", slotStart, slotMinutes: loc.slot_minutes },
    rewardsEffect: { earnsCents: totals.qualifyingCents, thresholdCents: reward.thresholdCents },
  };
}

export type Quote = Awaited<ReturnType<typeof buildQuote>>;

// ---------------------------------------------------------------- checkout

function orderNumber() {
  // Short, readable pickup code: no ambiguous characters.
  const alphabet = "ACDEFGHJKMNPQRTVWXY";
  const b = crypto.getRandomValues(new Uint8Array(1))[0];
  return `${alphabet[b % alphabet.length]}${String(100 + Math.floor(Math.random() * 900))}`;
}

function displayName(name: string) {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0];
}

export interface CheckoutInput {
  idempotencyKey: string;
  locationId: string;
  lines: CartLineInput[];
  pickup: PickupChoice;
  rewardId?: string | null;
  expectedTotalCents: number;
  paymentMethod: "demo" | "stripe";
}

/**
 * Creates (or returns the existing) order for an idempotency key. Capacity and reward
 * reservation are enforced inside one D1 transaction, so two devices can't spend one reward
 * and a slot can't be overbooked.
 */
export async function checkout(env: Env, user: User, input: CheckoutInput) {
  const db = env.DB;
  if (typeof input.idempotencyKey !== "string" || input.idempotencyKey.length < 8 || input.idempotencyKey.length > 80)
    throw new DomainError("VALIDATION", "Missing idempotency key.");
  const requestHash = await sha256(JSON.stringify([input.locationId, input.lines, input.pickup, input.rewardId ?? null, input.paymentMethod]));

  const existing = await db.prepare("SELECT * FROM orders WHERE user_id = ? AND idempotency_key = ?").bind(user.id, input.idempotencyKey).first<OrderRow>();
  if (existing) {
    if (existing.request_hash !== requestHash) throw new DomainError("IDEMPOTENCY_CONFLICT", "This checkout was already submitted with different items. Please review your bag.", 409);
    return { order: existing, replayed: true };
  }

  const quote = await buildQuote(db, user, input);
  if (!quote.location.acceptingOrders)
    throw new DomainError("CAFE_UNAVAILABLE", quote.location.paused ? `${quote.location.name} has paused mobile orders. ${quote.location.pauseReason ?? ""}`.trim() : `${quote.location.name} isn't taking orders right now.`, 409);
  if (!quote.pickup.slotStart) throw new DomainError("SLOT_UNAVAILABLE", "All pickup times are full right now. Please try again shortly.", 409);
  if (quote.totalCents !== input.expectedTotalCents)
    throw new DomainError("PRICE_CHANGED", "Prices changed since you opened your bag. Please review the new total.", 409, { quote });

  let provider: OrderRow["payment_provider"];
  if (quote.totalCents === 0) provider = "none";
  else if (input.paymentMethod === "stripe" && stripeEnabled(env)) provider = "stripe";
  else if (input.paymentMethod === "demo" && demoEnabled(env)) provider = "demo";
  else throw new DomainError("PAYMENT_METHOD_UNAVAILABLE", "That payment method isn't available here.");

  const loc = await getLocation(db, input.locationId);
  const id = newId("ord");
  const now = nowIso();
  const slotEnd = new Date(Date.parse(quote.pickup.slotStart) + loc.slot_minutes * 60000).toISOString();
  // Demo card authorizes instantly; Stripe waits for the hosted checkout to complete.
  const status: OrderStatus = provider === "stripe" ? "AWAITING_PAYMENT" : "PENDING_ACCEPTANCE";
  const paymentStatus = provider === "stripe" ? "PROCESSING" : provider === "demo" ? "AUTHORIZED" : "NONE";
  const tender = provider === "demo" ? "Demo card •••• 4242" : provider === "none" ? "Reward" : null;
  const rewardId = quote.rewardId;

  const insert = db
    .prepare(
      `INSERT INTO orders (id, number, user_id, location_id, customer_name, idempotency_key, request_hash, status, payment_status,
         payment_provider, tender_label, scheduled, slot_start, promised_at, lines_json, subtotal_cents, discount_cents, tax_cents, total_cents, reward_id, created_at, updated_at)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?21
       WHERE (SELECT COUNT(*) FROM orders WHERE location_id = ?4 AND slot_start = ?13 AND status NOT IN ('REJECTED','CANCELLED')) < ?22
         AND (?20 IS NULL OR EXISTS (SELECT 1 FROM rewards WHERE id = ?20 AND user_id = ?3 AND status = 'AVAILABLE' AND expires_at > ?21))`,
    )
    .bind(
      id, orderNumber(), user.id, loc.id, displayName(user.name), input.idempotencyKey, requestHash, status, paymentStatus, provider, tender,
      quote.pickup.type === "scheduled" ? 1 : 0, quote.pickup.slotStart, slotEnd, JSON.stringify(quote.lines),
      quote.subtotalCents, quote.discountCents, quote.taxCents, quote.totalCents, rewardId, now, loc.orders_per_slot,
    );
  const stmts = [insert];
  if (rewardId) {
    stmts.push(
      db.prepare("UPDATE rewards SET status = 'RESERVED', order_id = ?1 WHERE id = ?2 AND status = 'AVAILABLE' AND EXISTS (SELECT 1 FROM orders WHERE id = ?1)").bind(id, rewardId),
      db
        .prepare(
          `INSERT INTO loyalty_ledger (user_id, kind, reward_id, order_id, unique_key, note, program_version)
           SELECT ?1, 'RESERVE', ?2, ?3, ?4, 'Reward held for your order', ?5 WHERE EXISTS (SELECT 1 FROM orders WHERE id = ?3)`,
        )
        .bind(user.id, rewardId, id, `reserve:${id}`, REWARDS.programVersion),
    );
  }
  stmts.push(
    db.prepare("INSERT INTO order_events (order_id, kind, to_status, actor, note) SELECT ?1, 'CREATED', ?2, 'customer', ?3 WHERE EXISTS (SELECT 1 FROM orders WHERE id = ?1)").bind(id, status, `Payment: ${provider}`),
  );
  try {
    await db.batch(stmts);
  } catch (e) {
    // A concurrent duplicate submit with the same key hit the unique constraint: return the winner.
    const dup = await db.prepare("SELECT * FROM orders WHERE user_id = ? AND idempotency_key = ?").bind(user.id, input.idempotencyKey).first<OrderRow>();
    if (dup) return { order: dup, replayed: true };
    throw e;
  }
  const order = await db.prepare("SELECT * FROM orders WHERE id = ?").bind(id).first<OrderRow>();
  if (!order) {
    if (rewardId) throw new DomainError("REWARD_UNAVAILABLE", "That reward was just used on another order.", 409);
    throw new DomainError("SLOT_UNAVAILABLE", "That pickup time just filled up. Please choose another.", 409);
  }
  return { order, replayed: false };
}

// ---------------------------------------------------------------- transitions

async function transition(db: D1Database, order: OrderRow, to: OrderStatus, actor: string, note: string | null, extra: Record<string, unknown> = {}) {
  if (!canTransition(order.status, to)) throw new DomainError("INVALID_TRANSITION", `Order ${order.number} can't move from ${order.status} to ${to}.`, 409);
  const sets = ["status = ?1", "state_version = state_version + 1", "updated_at = ?2"];
  const vals: unknown[] = [to, nowIso()];
  for (const [k, v] of Object.entries(extra)) {
    vals.push(v);
    sets.push(`${k} = ?${vals.length}`);
  }
  vals.push(order.id, order.state_version);
  const res = await db.batch([
    db.prepare(`UPDATE orders SET ${sets.join(", ")} WHERE id = ?${vals.length - 1} AND state_version = ?${vals.length}`).bind(...vals),
    db
      .prepare("INSERT INTO order_events (order_id, kind, from_status, to_status, actor, note) SELECT ?, 'TRANSITION', ?, ?, ?, ? WHERE changes() = 1")
      .bind(order.id, order.status, to, actor, note),
  ]);
  if (res[0].meta.changes !== 1) throw new DomainError("STALE_ORDER", "This order was just updated by someone else. Refreshing.", 409);
  return (await db.prepare("SELECT * FROM orders WHERE id = ?").bind(order.id).first<OrderRow>())!;
}

async function releaseReward(db: D1Database, order: OrderRow, why: string) {
  if (!order.reward_id) return;
  await db.batch([
    db.prepare("UPDATE rewards SET status = 'AVAILABLE', order_id = NULL WHERE id = ? AND status = 'RESERVED' AND order_id = ?").bind(order.reward_id, order.id),
    db
      .prepare("INSERT OR IGNORE INTO loyalty_ledger (user_id, kind, reward_id, order_id, unique_key, note, program_version) VALUES (?, 'RELEASE', ?, ?, ?, ?, ?)")
      .bind(order.user_id, order.reward_id, order.id, `release:${order.id}`, why, REWARDS.programVersion),
  ]);
}

async function consumeReward(db: D1Database, order: OrderRow) {
  if (!order.reward_id) return;
  await db.batch([
    db.prepare("UPDATE rewards SET status = 'CONSUMED' WHERE id = ? AND status = 'RESERVED' AND order_id = ?").bind(order.reward_id, order.id),
    db
      .prepare("INSERT OR IGNORE INTO loyalty_ledger (user_id, kind, reward_id, order_id, unique_key, note, program_version) VALUES (?, 'REDEEM', ?, ?, ?, ?, ?)")
      .bind(order.user_id, order.reward_id, order.id, `redeem:${order.id}`, `$${(order.discount_cents / 100).toFixed(2)} reward used on order ${order.number}`, REWARDS.programVersion),
  ]);
}

/** Stripe-hosted payment finished (webhook or return-page recovery). Safe to call repeatedly. */
export async function markAuthorized(env: Env, orderId: string, paymentIntent: string) {
  const db = env.DB;
  const order = await db.prepare("SELECT * FROM orders WHERE id = ?").bind(orderId).first<OrderRow>();
  if (!order) return null;
  if (order.status === "AWAITING_PAYMENT") {
    return transition(db, order, "PENDING_ACCEPTANCE", "payment", "Card authorized", { payment_status: "AUTHORIZED", payment_ref: paymentIntent, tender_label: "Card" });
  }
  if (order.status === "CANCELLED" && order.payment_status !== "VOIDED") {
    // Late success after we gave up on the attempt: never reopen production, compensate instead.
    await voidPayment(env, paymentIntent, order.id).catch(() => null);
    await db.prepare("UPDATE orders SET payment_status = 'VOIDED', payment_ref = ?, state_version = state_version + 1 WHERE id = ?").bind(paymentIntent, order.id).run();
    await db.prepare("INSERT INTO order_events (order_id, kind, actor, note) VALUES (?, 'LATE_PAYMENT_VOIDED', 'payment', 'Payment arrived after the order closed; authorization released')").bind(order.id).run();
  }
  return order;
}

export async function failPayment(env: Env, orderId: string, why: string) {
  const db = env.DB;
  const order = await db.prepare("SELECT * FROM orders WHERE id = ?").bind(orderId).first<OrderRow>();
  if (!order || order.status !== "AWAITING_PAYMENT") return order;
  const updated = await transition(db, order, "CANCELLED", "payment", why, { payment_status: "FAILED" });
  await releaseReward(db, updated, "Reward returned — payment wasn't completed");
  return updated;
}

/** If a Stripe order is still awaiting payment, ask Stripe directly (covers lost webhooks). */
export async function reconcileStripe(env: Env, order: OrderRow) {
  if (order.payment_provider !== "stripe" || order.status !== "AWAITING_PAYMENT" || !order.payment_session_id || !stripeEnabled(env)) return order;
  const s = await getCheckoutSession(env, order.payment_session_id);
  if (s.status === "complete" && s.payment_intent) return (await markAuthorized(env, order.id, s.payment_intent)) ?? order;
  if (s.status === "expired") return (await failPayment(env, order.id, "Checkout expired")) ?? order;
  return order;
}

export async function customerCancel(env: Env, user: User, orderId: string) {
  const db = env.DB;
  const order = await db.prepare("SELECT * FROM orders WHERE id = ? AND user_id = ?").bind(orderId, user.id).first<OrderRow>();
  if (!order) throw new DomainError("NOT_FOUND", "Order not found.", 404);
  if (order.status === "AWAITING_PAYMENT") {
    if (order.payment_session_id && stripeEnabled(env)) {
      const s = await getCheckoutSession(env, order.payment_session_id);
      if (s.status === "complete" && s.payment_intent) {
        await markAuthorized(env, order.id, s.payment_intent);
        throw new DomainError("ALREADY_PAID", "Your payment went through, so this order is already with the café.", 409);
      }
      if (s.status === "open") await expireCheckoutSession(env, order.payment_session_id).catch(() => null);
    }
    return failPayment(env, order.id, "Customer left checkout");
  }
  if (order.status !== "PENDING_ACCEPTANCE")
    throw new DomainError("CANCEL_NOT_ALLOWED", "The café has already started your order, so it can't be cancelled here. Tap Get help and we'll sort it out.", 409);
  return rejectOrder(env, order, "CANCELLED", "customer", "Cancelled by customer");
}

async function rejectOrder(env: Env, order: OrderRow, to: "REJECTED" | "CANCELLED", actor: string, reason: string) {
  const db = env.DB;
  let paymentStatus = order.payment_status;
  if (order.payment_status === "AUTHORIZED") {
    if (order.payment_provider === "stripe" && order.payment_ref) await voidPayment(env, order.payment_ref, order.id);
    paymentStatus = "VOIDED";
  }
  const updated = await transition(db, order, to, actor, reason, { payment_status: paymentStatus, reject_reason: reason });
  await releaseReward(db, updated, `Reward returned — order ${order.number} was ${to === "REJECTED" ? "declined by the café" : "cancelled"}`);
  return updated;
}

/** Staff fulfillment commands with optimistic concurrency (expectedVersion). */
export async function staffTransition(env: Env, staff: User, orderId: string, to: OrderStatus, expectedVersion: number, reason?: string) {
  const db = env.DB;
  const order = await db.prepare("SELECT * FROM orders WHERE id = ?").bind(orderId).first<OrderRow>();
  if (!order) throw new DomainError("NOT_FOUND", "Order not found.", 404);
  if (order.state_version !== expectedVersion) {
    // Idempotent replay: the same command already applied by another tap/device.
    if (order.status === to) return order;
    throw new DomainError("STALE_ORDER", "This ticket changed on another screen. Refreshing.", 409);
  }
  const actor = `staff:${staff.id}`;
  if (to === "REJECTED" || to === "CANCELLED") {
    if (!reason) throw new DomainError("VALIDATION", "Please give the customer a reason.");
    if (to === "CANCELLED" && order.status !== "PENDING_ACCEPTANCE") {
      // After acceptance the money is captured, so cancellation is a full refund.
      const updated = await transition(db, order, "CANCELLED", actor, reason, { reject_reason: reason });
      if (updated.total_cents - updated.refunded_cents > 0 || updated.reward_id) await refundOrder(env, staff, updated.id, updated.total_cents - updated.refunded_cents, reason, `cancel-${updated.id}`);
      return (await db.prepare("SELECT * FROM orders WHERE id = ?").bind(order.id).first<OrderRow>())!;
    }
    return rejectOrder(env, order, to, actor, reason);
  }
  if (to === "ACCEPTED") {
    // Capture on acceptance; if capture fails the order is declined and the authorization released.
    let captured = order.payment_status;
    if (order.payment_status === "AUTHORIZED") {
      if (order.payment_provider === "stripe" && order.payment_ref) {
        try {
          await capturePayment(env, order.payment_ref, order.id);
        } catch (e) {
          await rejectOrder(env, order, "REJECTED", "payment", "We couldn't complete the card payment");
          throw e;
        }
      }
      captured = "CAPTURED";
    }
    const updated = await transition(db, order, "ACCEPTED", actor, null, { payment_status: captured });
    await consumeReward(db, updated);
    return updated;
  }
  if (to === "READY") {
    const updated = await transition(db, order, "READY", actor, null, { ready_at: nowIso() });
    await earnForOrder(db, updated);
    return updated;
  }
  if (to === "COMPLETED") return transition(db, order, "COMPLETED", actor, null, { completed_at: nowIso() });
  return transition(db, order, to, actor, null);
}

// ---------------------------------------------------------------- loyalty ledger

export async function progressBalance(db: D1Database, userId: string) {
  const r = await db.prepare("SELECT COALESCE(SUM(progress_cents), 0) AS p FROM loyalty_ledger WHERE user_id = ?").bind(userId).first<{ p: number }>();
  return r?.p ?? 0;
}

/** Posts qualifying spend once (unique key) and converts every full threshold into a reward. */
export async function earnForOrder(db: D1Database, order: OrderRow) {
  const qualifying = order.subtotal_cents - order.discount_cents - order.refunded_cents;
  if (qualifying <= 0) return;
  await db
    .prepare("INSERT OR IGNORE INTO loyalty_ledger (user_id, kind, progress_cents, order_id, unique_key, note, program_version) VALUES (?, 'EARN', ?, ?, ?, ?, ?)")
    .bind(order.user_id, qualifying, order.id, `earn:${order.id}`, `$${(qualifying / 100).toFixed(2)} qualifying spend · order ${order.number}`, REWARDS.programVersion)
    .run();
  await unlockRewards(db, order.user_id, `order:${order.id}`);
}

async function unlockRewards(db: D1Database, userId: string, cause: string) {
  for (let i = 0; i < 10; i++) {
    const rewardId = newId("rwd");
    const key = `unlock:${cause}:${i}`;
    const expires = new Date(Date.now() + REWARDS.rewardLifetimeDays * 864e5).toISOString();
    // Each statement re-checks the balance inside the transaction, so concurrent earns can't double-unlock.
    const res = await db.batch([
      db
        .prepare(
          `INSERT OR IGNORE INTO loyalty_ledger (user_id, kind, progress_cents, reward_id, unique_key, note, program_version)
           SELECT ?1, 'UNLOCK', ?2, ?3, ?4, ?5, ?6 WHERE (SELECT COALESCE(SUM(progress_cents),0) FROM loyalty_ledger WHERE user_id = ?1) >= ?7`,
        )
        .bind(userId, -REWARDS.thresholdCents, rewardId, key, `$${REWARDS.rewardCents / 100} reward unlocked`, REWARDS.programVersion, REWARDS.thresholdCents),
      db
        .prepare("INSERT INTO rewards (id, user_id, value_cents, status, expires_at) SELECT ?, ?, ?, 'AVAILABLE', ? WHERE EXISTS (SELECT 1 FROM loyalty_ledger WHERE unique_key = ? AND reward_id = ?)")
        .bind(rewardId, userId, REWARDS.rewardCents, expires, key, rewardId),
    ]);
    if (res[0].meta.changes !== 1) return;
  }
}

export async function rewardsFor(db: D1Database, userId: string) {
  const now = nowIso();
  const [bal, available, held, activity, pending] = await db.batch([
    db.prepare("SELECT COALESCE(SUM(progress_cents),0) AS p FROM loyalty_ledger WHERE user_id = ?").bind(userId),
    db.prepare("SELECT id, value_cents, expires_at FROM rewards WHERE user_id = ? AND status = 'AVAILABLE' AND expires_at > ? ORDER BY expires_at").bind(userId, now),
    db.prepare("SELECT r.id, r.value_cents, o.number FROM rewards r LEFT JOIN orders o ON o.id = r.order_id WHERE r.user_id = ? AND r.status = 'RESERVED'").bind(userId),
    db.prepare("SELECT kind, progress_cents, note, created_at FROM loyalty_ledger WHERE user_id = ? ORDER BY id DESC LIMIT 40").bind(userId),
    db
      .prepare(`SELECT COALESCE(SUM(subtotal_cents - discount_cents),0) AS p FROM orders WHERE user_id = ? AND status IN ('PENDING_ACCEPTANCE','ACCEPTED','PREPARING')`)
      .bind(userId),
  ]);
  const progress = (bal.results[0] as { p: number }).p;
  return {
    program: {
      name: "Brewline Rewards",
      version: REWARDS.programVersion,
      rules: [
        `Every $${REWARDS.thresholdCents / 100} of qualifying spend unlocks a $${REWARDS.rewardCents / 100} reward.`,
        "Qualifying spend is your item total after rewards, before tax. Extra spend carries over to the next reward.",
        "Progress is added when your order is ready, and reversed if an order is refunded.",
        `Rewards are valid for ${REWARDS.rewardLifetimeDays} days and can be applied to one order. Any unused value on that order isn't kept.`,
        "Rewards have no cash value and can't be combined on a single order.",
      ],
    },
    ...rewardsSummary(progress),
    available: available.results,
    held: held.results,
    pendingCents: (pending.results[0] as { p: number }).p,
    activity: activity.results,
  };
}

// ---------------------------------------------------------------- refunds

export async function refundOrder(env: Env, actor: User, orderId: string, amountCents: number, reason: string, idempotencyKey: string) {
  const db = env.DB;
  const prior = await db.prepare("SELECT * FROM refunds WHERE idempotency_key = ?").bind(idempotencyKey).first();
  if (prior) return prior;
  const order = await db.prepare("SELECT * FROM orders WHERE id = ?").bind(orderId).first<OrderRow>();
  if (!order) throw new DomainError("NOT_FOUND", "Order not found.", 404);
  const refundable = order.payment_status === "CAPTURED" ? order.total_cents - order.refunded_cents : 0;
  if (amountCents < 0 || amountCents > refundable) throw new DomainError("REFUND_TOO_LARGE", `You can refund up to $${(refundable / 100).toFixed(2)} on this order.`, 409);
  if (amountCents === 0 && !order.reward_id) throw new DomainError("VALIDATION", "Enter an amount to refund.");

  const id = newId("ref");
  await db
    .prepare("INSERT INTO refunds (id, order_id, amount_cents, reason, status, actor_id, idempotency_key) VALUES (?, ?, ?, ?, 'PROCESSING', ?, ?)")
    .bind(id, order.id, amountCents, reason, actor.id, idempotencyKey)
    .run();
  let providerRef: string | null = null;
  try {
    if (amountCents > 0 && order.payment_provider === "stripe" && order.payment_ref) providerRef = (await refundPayment(env, order.payment_ref, amountCents, id)).id;
  } catch (e) {
    await db.prepare("UPDATE refunds SET status = 'FAILED' WHERE id = ?").bind(id).run();
    throw e;
  }
  const newRefunded = order.refunded_cents + amountCents;
  await db.batch([
    db.prepare("UPDATE refunds SET status = 'SUCCEEDED', provider_ref = ? WHERE id = ?").bind(providerRef, id),
    db.prepare("UPDATE orders SET refunded_cents = ?, state_version = state_version + 1, updated_at = ? WHERE id = ?").bind(newRefunded, nowIso(), order.id),
    db
      .prepare("INSERT INTO order_events (order_id, kind, actor, note) VALUES (?, 'REFUND', ?, ?)")
      .bind(order.id, `staff:${actor.id}`, `$${(amountCents / 100).toFixed(2)} refunded — ${reason}`),
  ]);

  // Reverse loyalty progress earned on the refunded share, once per refund.
  const earned = await db.prepare("SELECT COALESCE(SUM(progress_cents),0) AS e FROM loyalty_ledger WHERE order_id = ? AND kind = 'EARN'").bind(order.id).first<{ e: number }>();
  const reversed = await db.prepare("SELECT COALESCE(-SUM(progress_cents),0) AS r FROM loyalty_ledger WHERE order_id = ? AND kind = 'REVERSE'").bind(order.id).first<{ r: number }>();
  const reverse = reversalFor(earned?.e ?? 0, order.total_cents, amountCents, reversed?.r ?? 0);
  if (reverse > 0)
    await db
      .prepare("INSERT OR IGNORE INTO loyalty_ledger (user_id, kind, progress_cents, order_id, unique_key, note, program_version) VALUES (?, 'REVERSE', ?, ?, ?, ?, ?)")
      .bind(order.user_id, -reverse, order.id, `reverse:${id}`, `Refund on order ${order.number}`, REWARDS.programVersion)
      .run();

  // A fully refunded order gives back the reward it used, as a fresh reward.
  if (order.reward_id && newRefunded >= order.total_cents) {
    const rid = newId("rwd");
    const key = `reinstate:${order.id}`;
    await db.batch([
      db
        .prepare("INSERT OR IGNORE INTO loyalty_ledger (user_id, kind, reward_id, order_id, unique_key, note, program_version) VALUES (?, 'ADJUST', ?, ?, ?, ?, ?)")
        .bind(order.user_id, rid, order.id, key, `$${(order.discount_cents / 100).toFixed(2)} reward returned after refund`, REWARDS.programVersion),
      db
        .prepare("INSERT INTO rewards (id, user_id, value_cents, status, expires_at) SELECT ?, ?, ?, 'AVAILABLE', ? WHERE EXISTS (SELECT 1 FROM loyalty_ledger WHERE unique_key = ? AND reward_id = ?)")
        .bind(rid, order.user_id, order.discount_cents, new Date(Date.now() + 30 * 864e5).toISOString(), key, rid),
    ]);
  }
  return db.prepare("SELECT * FROM refunds WHERE id = ?").bind(id).first();
}

// ---------------------------------------------------------------- presentation

export async function presentOrder(db: D1Database, order: OrderRow, opts: { events?: boolean } = {}) {
  const loc = await db.prepare("SELECT name, address, pickup_note, timezone FROM locations WHERE id = ?").bind(order.location_id).first<{ name: string; address: string; pickup_note: string; timezone: string }>();
  const refunds = await db.prepare("SELECT id, amount_cents, reason, status, created_at FROM refunds WHERE order_id = ? ORDER BY created_at").bind(order.id).all();
  const events = opts.events
    ? (await db.prepare("SELECT kind, from_status, to_status, note, at FROM order_events WHERE order_id = ? ORDER BY id").bind(order.id).all()).results
    : undefined;
  return {
    id: order.id,
    number: order.number,
    customerName: order.customer_name,
    status: order.status,
    stateVersion: order.state_version,
    paymentStatus: order.payment_status,
    paymentProvider: order.payment_provider,
    tender: order.tender_label,
    scheduled: !!order.scheduled,
    slotStart: order.slot_start,
    promisedAt: order.promised_at,
    lines: JSON.parse(order.lines_json) as PricedLine[],
    subtotalCents: order.subtotal_cents,
    discountCents: order.discount_cents,
    taxCents: order.tax_cents,
    totalCents: order.total_cents,
    refundedCents: order.refunded_cents,
    rejectReason: order.reject_reason,
    createdAt: order.created_at,
    updatedAt: order.updated_at,
    readyAt: order.ready_at,
    completedAt: order.completed_at,
    location: { id: order.location_id, ...loc },
    refunds: refunds.results,
    events,
    active: ACTIVE_STATUSES.includes(order.status),
  };
}
