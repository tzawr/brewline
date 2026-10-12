import { Hono } from "hono";
import { DomainError, REWARDS, type OrderStatus } from "./lib/domain";
import { audit, body, fail, handleError, int, newId, nowIso, requireRole, requireUser, str, type AppEnv, type Env, type User } from "./lib/http";
import { createSession, destroySession, hashPassword, loadUser, rateLimit, verifyPassword } from "./lib/auth";
import { allIngredients, getLocation, loadMenu, locationStatus, type LocationRow } from "./lib/menu";
import {
  buildQuote,
  checkout,
  customerCancel,
  failPayment,
  markAuthorized,
  presentOrder,
  reconcileStripe,
  refundOrder,
  rewardsFor,
  staffTransition,
  type CheckoutInput,
  type OrderRow,
} from "./lib/orders";
import { createCheckoutSession, demoEnabled, getCheckoutSession, stripeEnabled, verifyStripeSignature } from "./lib/payments";

const app = new Hono<AppEnv>().basePath("/api");

app.onError(handleError);
app.notFound((c) => fail(c, 404, "NOT_FOUND", "Not found."));

app.use("*", async (c, next) => {
  c.set("correlationId", c.req.header("cf-ray") ?? crypto.randomUUID());
  // CSRF defence: state-changing requests must be JSON (browsers can't send that cross-site without CORS).
  const m = c.req.method;
  if (m !== "GET" && m !== "HEAD" && !c.req.path.startsWith("/api/stripe/") && !(c.req.header("content-type") ?? "").includes("application/json"))
    return fail(c, 415, "UNSUPPORTED", "Requests must be sent as JSON.");
  c.set("user", await loadUser(c));
  await next();
  c.header("Cache-Control", "no-store");
  c.header("X-Correlation-Id", c.get("correlationId"));
});

const appUrl = (c: { env: Env; req: { url: string } }) => c.env.APP_URL || new URL(c.req.url).origin;

// ---------------------------------------------------------------- config & auth

app.get("/config", (c) =>
  c.json({
    demoMode: demoEnabled(c.env),
    payments: { demo: demoEnabled(c.env), stripe: stripeEnabled(c.env) },
    rewards: { thresholdCents: REWARDS.thresholdCents, rewardCents: REWARDS.rewardCents },
  }),
);

const publicUser = (u: User) => ({ id: u.id, email: u.email, name: u.name, role: u.role, marketingOptIn: !!u.marketing_opt_in, createdAt: u.created_at });

app.get("/me", (c) => {
  const u = c.get("user");
  return c.json({ user: u ? publicUser(u) : null });
});

app.post("/auth/register", async (c) => {
  const b = await body<{ name: string; email: string; password: string; marketingOptIn?: boolean }>(c);
  const name = str(b.name, "name", { max: 60 });
  const email = str(b.email, "email", { max: 120 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new DomainError("VALIDATION", "Please enter a valid email.", 400, { field: "email" });
  if (typeof b.password !== "string" || b.password.length < 8 || b.password.length > 200)
    throw new DomainError("VALIDATION", "Use a password with at least 8 characters.", 400, { field: "password" });
  await rateLimit(c.env.DB, `register:${c.req.header("cf-connecting-ip") ?? "local"}`, 10, 3600);
  const exists = await c.env.DB.prepare("SELECT 1 FROM users WHERE email = ?").bind(email).first();
  if (exists) throw new DomainError("EMAIL_TAKEN", "An account with this email already exists. Try signing in.", 409, { field: "email" });
  const id = newId("usr");
  await c.env.DB.prepare("INSERT INTO users (id, email, name, password_hash, marketing_opt_in) VALUES (?,?,?,?,?)")
    .bind(id, email, name, await hashPassword(b.password), b.marketingOptIn ? 1 : 0)
    .run();
  await createSession(c, id);
  const user = await c.env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(id).first<User>();
  return c.json({ user: publicUser(user!) }, 201);
});

app.post("/auth/login", async (c) => {
  const b = await body<{ email: string; password: string }>(c);
  const email = str(b.email, "email", { max: 120 }).toLowerCase();
  await rateLimit(c.env.DB, `login:${email}`, 8, 900);
  const row = await c.env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first<User & { password_hash: string }>();
  if (!row || typeof b.password !== "string" || !(await verifyPassword(b.password, row.password_hash)))
    throw new DomainError("INVALID_LOGIN", "That email and password don't match.", 401);
  await createSession(c, row.id);
  return c.json({ user: publicUser(row) });
});

app.post("/auth/logout", async (c) => {
  await destroySession(c);
  return c.json({ ok: true });
});

app.post("/auth/demo", async (c) => {
  if (!demoEnabled(c.env)) throw new DomainError("NOT_FOUND", "Not found.", 404);
  const { role } = await body<{ role: "barista" | "manager" }>(c);
  const id = role === "manager" ? "staff_manager" : "staff_barista";
  const user = await c.env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(id).first<User>();
  if (!user) throw new DomainError("NOT_FOUND", "Demo staff account missing — run the seed.", 404);
  await createSession(c, id);
  return c.json({ user: publicUser(user) });
});

app.patch("/me", async (c) => {
  const u = requireUser(c);
  const b = await body<{ name?: string; marketingOptIn?: boolean }>(c);
  const name = b.name !== undefined ? str(b.name, "name", { max: 60 }) : u.name;
  await c.env.DB.prepare("UPDATE users SET name = ?, marketing_opt_in = ? WHERE id = ?").bind(name, b.marketingOptIn ?? !!u.marketing_opt_in ? 1 : 0, u.id).run();
  return c.json({ user: publicUser({ ...u, name, marketing_opt_in: (b.marketingOptIn ?? !!u.marketing_opt_in) ? 1 : 0 }) });
});

app.post("/me/password", async (c) => {
  const u = requireUser(c);
  const b = await body<{ current: string; next: string }>(c);
  const row = await c.env.DB.prepare("SELECT password_hash FROM users WHERE id = ?").bind(u.id).first<{ password_hash: string }>();
  if (!row || !(await verifyPassword(b.current ?? "", row.password_hash))) throw new DomainError("INVALID_LOGIN", "Your current password is incorrect.", 401);
  if (typeof b.next !== "string" || b.next.length < 8) throw new DomainError("VALIDATION", "Use a password with at least 8 characters.");
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind(await hashPassword(b.next), u.id),
    c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(u.id),
  ]);
  await createSession(c, u.id);
  return c.json({ ok: true });
});

/** Account deletion: personal data is removed; order records stay (anonymised) for receipts and accounting. */
app.delete("/me", async (c) => {
  const u = requireUser(c);
  if (u.role !== "customer") throw new DomainError("FORBIDDEN", "Staff accounts are removed by a manager.", 403);
  const active = await c.env.DB.prepare("SELECT 1 FROM orders WHERE user_id = ? AND status IN ('AWAITING_PAYMENT','PENDING_ACCEPTANCE','ACCEPTED','PREPARING','READY')").bind(u.id).first();
  if (active) throw new DomainError("ACTIVE_ORDER", "Please wait until your current order is picked up before deleting your account.", 409);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE users SET email = ?, name = 'Deleted customer', password_hash = 'deleted', marketing_opt_in = 0 WHERE id = ?").bind(`deleted+${u.id}@invalid`, u.id),
    c.env.DB.prepare("UPDATE orders SET customer_name = 'Customer' WHERE user_id = ?").bind(u.id),
    c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(u.id),
    c.env.DB.prepare("DELETE FROM favorites WHERE user_id = ?").bind(u.id),
    c.env.DB.prepare("UPDATE rewards SET status = 'EXPIRED' WHERE user_id = ? AND status = 'AVAILABLE'").bind(u.id),
  ]);
  await destroySession(c);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- locations & menu

app.get("/locations", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM locations ORDER BY name").all<LocationRow>();
  return c.json({ locations: await Promise.all(results.map((l) => locationStatus(c.env.DB, l))) });
});

app.get("/locations/:id", async (c) => c.json({ location: await locationStatus(c.env.DB, await getLocation(c.env.DB, c.req.param("id"))) }));

app.get("/locations/:id/menu", async (c) => {
  const loc = await getLocation(c.env.DB, c.req.param("id"));
  const [menu, status, ann] = await Promise.all([
    loadMenu(c.env.DB, loc.id),
    locationStatus(c.env.DB, loc),
    c.env.DB.prepare("SELECT id, title, body FROM announcements WHERE active = 1 ORDER BY sort").all(),
  ]);
  return c.json({
    location: status,
    categories: menu.categories,
    products: menu.products.filter((p) => p.active).map(({ ingredients, ...p }) => p),
    announcements: ann.results,
    fetchedAt: nowIso(),
  });
});

// ---------------------------------------------------------------- favorites

app.get("/favorites", async (c) => {
  const u = requireUser(c);
  const { results } = await c.env.DB.prepare("SELECT id, name, product_id, selections_json, created_at FROM favorites WHERE user_id = ? ORDER BY created_at DESC").bind(u.id).all<{
    id: string; name: string; product_id: string; selections_json: string; created_at: string;
  }>();
  return c.json({ favorites: results.map((f) => ({ id: f.id, name: f.name, productId: f.product_id, selections: JSON.parse(f.selections_json), createdAt: f.created_at })) });
});

app.post("/favorites", async (c) => {
  const u = requireUser(c);
  const b = await body<{ name: string; productId: string; selections: Record<string, Record<string, number>> }>(c);
  const name = str(b.name, "name", { max: 40 });
  const product = await c.env.DB.prepare("SELECT id FROM products WHERE id = ?").bind(b.productId).first();
  if (!product) throw new DomainError("NOT_FOUND", "Product not found.", 404);
  const count = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM favorites WHERE user_id = ?").bind(u.id).first<{ n: number }>();
  if ((count?.n ?? 0) >= 30) throw new DomainError("LIMIT", "You can save up to 30 drinks.");
  const id = newId("fav");
  await c.env.DB.prepare("INSERT INTO favorites (id, user_id, name, product_id, selections_json) VALUES (?,?,?,?,?)").bind(id, u.id, name, b.productId, JSON.stringify(b.selections ?? {})).run();
  return c.json({ id }, 201);
});

app.delete("/favorites/:id", async (c) => {
  const u = requireUser(c);
  await c.env.DB.prepare("DELETE FROM favorites WHERE id = ? AND user_id = ?").bind(c.req.param("id"), u.id).run();
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- quote & checkout

app.post("/quotes", async (c) => {
  const b = await body<Parameters<typeof buildQuote>[2]>(c);
  return c.json({ quote: await buildQuote(c.env.DB, c.get("user"), b) });
});

app.post("/checkout", async (c) => {
  const user = requireUser(c);
  const b = await body<CheckoutInput>(c);
  let { order, replayed } = await checkout(c.env, user, b);

  let next: { type: "track" } | { type: "redirect"; url: string } = { type: "track" };
  if (order.payment_provider === "stripe" && order.status === "AWAITING_PAYMENT") {
    if (order.payment_session_id) {
      const s = await getCheckoutSession(c.env, order.payment_session_id);
      if (s.status === "open" && s.url) next = { type: "redirect", url: s.url };
      else order = await reconcileStripe(c.env, order);
    } else {
      const loc = await getLocation(c.env.DB, order.location_id);
      try {
        const s = await createCheckoutSession(c.env, { orderId: order.id, orderNumber: order.number, amountCents: order.total_cents, email: user.email, appUrl: appUrl(c), cafeName: loc.name });
        await c.env.DB.prepare("UPDATE orders SET payment_session_id = ? WHERE id = ?").bind(s.id, order.id).run();
        next = { type: "redirect", url: s.url! };
      } catch (e) {
        await failPayment(c.env, order.id, "Couldn't start card checkout");
        throw e;
      }
    }
  }
  return c.json({ order: await presentOrder(c.env.DB, order), next, replayed }, replayed ? 200 : 201);
});

// ---------------------------------------------------------------- orders

app.get("/orders", async (c) => {
  const u = requireUser(c);
  const { results } = await c.env.DB.prepare("SELECT * FROM orders WHERE user_id = ? AND status <> 'AWAITING_PAYMENT' ORDER BY created_at DESC LIMIT 50").bind(u.id).all<OrderRow>();
  return c.json({ orders: await Promise.all(results.map((o) => presentOrder(c.env.DB, o))) });
});

app.get("/orders/:id", async (c) => {
  const u = requireUser(c);
  let order = await c.env.DB.prepare("SELECT * FROM orders WHERE id = ? AND (user_id = ? OR ? IN ('barista','manager'))").bind(c.req.param("id"), u.id, u.role).first<OrderRow>();
  if (!order) throw new DomainError("NOT_FOUND", "We couldn't find that order on your account.", 404);
  if (order.status === "AWAITING_PAYMENT") order = await reconcileStripe(c.env, order);
  return c.json({ order: await presentOrder(c.env.DB, order, { events: true }) });
});

app.post("/orders/:id/cancel", async (c) => {
  const u = requireUser(c);
  const order = await customerCancel(c.env, u, c.req.param("id"));
  return c.json({ order: order ? await presentOrder(c.env.DB, order) : null });
});

app.get("/rewards", async (c) => c.json(await rewardsFor(c.env.DB, requireUser(c).id)));

app.post("/support", async (c) => {
  const u = requireUser(c);
  const b = await body<{ orderId?: string; topic: string; message: string }>(c);
  const topic = str(b.topic, "topic", { max: 60 });
  const message = str(b.message, "message", { min: 5, max: 2000 });
  if (b.orderId) {
    const own = await c.env.DB.prepare("SELECT 1 FROM orders WHERE id = ? AND user_id = ?").bind(b.orderId, u.id).first();
    if (!own) throw new DomainError("NOT_FOUND", "Order not found.", 404);
  }
  await rateLimit(c.env.DB, `support:${u.id}`, 10, 3600);
  const id = newId("sup");
  await c.env.DB.prepare("INSERT INTO support_requests (id, user_id, order_id, topic, message) VALUES (?,?,?,?,?)").bind(id, u.id, b.orderId ?? null, topic, message).run();
  return c.json({ id, reference: id.slice(-6).toUpperCase() }, 201);
});

app.get("/support", async (c) => {
  const u = requireUser(c);
  const { results } = await c.env.DB.prepare("SELECT id, order_id, topic, message, status, resolution, created_at FROM support_requests WHERE user_id = ? ORDER BY created_at DESC").bind(u.id).all();
  return c.json({ requests: results });
});

// ---------------------------------------------------------------- Stripe webhook

app.post("/stripe/webhook", async (c) => {
  if (!c.env.STRIPE_WEBHOOK_SECRET) return fail(c, 404, "NOT_FOUND", "Not found.");
  const payload = await c.req.text();
  if (!(await verifyStripeSignature(payload, c.req.header("stripe-signature"), c.env.STRIPE_WEBHOOK_SECRET))) return fail(c, 400, "BAD_SIGNATURE", "Invalid signature.");
  const event = JSON.parse(payload) as { id: string; type: string; data: { object: { id: string; metadata?: { order_id?: string }; payment_intent?: string } } };
  // Deduplicate deliveries; handlers are idempotent too.
  const seen = await c.env.DB.prepare("INSERT OR IGNORE INTO idempotency_keys (scope, key, response_json) VALUES ('stripe-event', ?, '{}')").bind(event.id).run();
  if (seen.meta.changes === 0) return c.json({ received: true, duplicate: true });
  const obj = event.data.object;
  const orderId = obj.metadata?.order_id;
  if (orderId) {
    if (event.type === "checkout.session.completed" && obj.payment_intent) await markAuthorized(c.env, orderId, obj.payment_intent);
    if (event.type === "checkout.session.expired") await failPayment(c.env, orderId, "Checkout expired");
  }
  return c.json({ received: true });
});

// ---------------------------------------------------------------- staff (barista + manager)

app.get("/staff/queue", async (c) => {
  requireRole(c, "barista", "manager");
  const locationId = c.req.query("location") ?? "promenade";
  const loc = await getLocation(c.env.DB, locationId);
  const since = new Date(Date.now() - 12 * 3600e3).toISOString();
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM orders WHERE location_id = ? AND (status IN ('PENDING_ACCEPTANCE','ACCEPTED','PREPARING','READY')
     OR (status IN ('COMPLETED','REJECTED','CANCELLED') AND updated_at > ?)) ORDER BY slot_start, created_at LIMIT 200`,
  )
    .bind(loc.id, since)
    .all<OrderRow>();
  const visible = results.filter((o) => o.status !== "COMPLETED" && o.status !== "REJECTED" && o.status !== "CANCELLED");
  const recent = results.filter((o) => !visible.includes(o)).sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 15);
  return c.json({
    location: await locationStatus(c.env.DB, loc),
    orders: await Promise.all(visible.map((o) => presentOrder(c.env.DB, o))),
    recent: await Promise.all(recent.map((o) => presentOrder(c.env.DB, o))),
    serverTime: nowIso(),
  });
});

app.post("/staff/orders/:id/transition", async (c) => {
  const staff = requireRole(c, "barista", "manager");
  const b = await body<{ to: OrderStatus; expectedVersion: number; reason?: string }>(c);
  const order = await staffTransition(c.env, staff, c.req.param("id"), b.to, b.expectedVersion, b.reason?.slice(0, 200));
  return c.json({ order: await presentOrder(c.env.DB, order) });
});

app.post("/staff/locations/:id/pause", async (c) => {
  const staff = requireRole(c, "barista", "manager");
  const b = await body<{ paused: boolean; reason?: string }>(c);
  const loc = await getLocation(c.env.DB, c.req.param("id"));
  await c.env.DB.prepare("UPDATE locations SET paused = ?, pause_reason = ?, version = version + 1 WHERE id = ?")
    .bind(b.paused ? 1 : 0, b.paused ? (b.reason?.slice(0, 120) || "We'll be back shortly.") : null, loc.id)
    .run();
  await audit(c.env.DB, staff.id, b.paused ? "PAUSE_ORDERS" : "RESUME_ORDERS", loc.id, { reason: b.reason ?? null });
  return c.json({ location: await locationStatus(c.env.DB, await getLocation(c.env.DB, loc.id)) });
});

app.patch("/staff/locations/:id/capacity", async (c) => {
  const staff = requireRole(c, "barista", "manager");
  const b = await body<{ leadTimeMin?: number; ordersPerSlot?: number }>(c);
  const loc = await getLocation(c.env.DB, c.req.param("id"));
  const lead = b.leadTimeMin === undefined ? loc.lead_time_min : int(b.leadTimeMin, "Lead time", 0, 120);
  const per = b.ordersPerSlot === undefined ? loc.orders_per_slot : int(b.ordersPerSlot, "Orders per slot", 1, 100);
  await c.env.DB.prepare("UPDATE locations SET lead_time_min = ?, orders_per_slot = ?, version = version + 1 WHERE id = ?").bind(lead, per, loc.id).run();
  await audit(c.env.DB, staff.id, "SET_CAPACITY", loc.id, { from: { lead: loc.lead_time_min, per: loc.orders_per_slot }, to: { lead, per } });
  return c.json({ location: await locationStatus(c.env.DB, await getLocation(c.env.DB, loc.id)) });
});

app.get("/staff/locations/:id/availability", async (c) => {
  requireRole(c, "barista", "manager");
  const loc = await getLocation(c.env.DB, c.req.param("id"));
  const menu = await loadMenu(c.env.DB, loc.id);
  const { results: overrides } = await c.env.DB.prepare("SELECT product_id, sold_out FROM location_products WHERE location_id = ?").bind(loc.id).all<{ product_id: string; sold_out: number }>();
  const manual = new Map(overrides.map((o) => [o.product_id, !!o.sold_out]));
  return c.json({
    products: menu.products.map((p) => ({ id: p.id, name: p.name, categoryId: p.categoryId, soldOut: manual.get(p.id) ?? false, unavailable: p.sold_out, active: p.active })),
    ingredients: await allIngredients(c.env.DB, loc.id),
  });
});

app.post("/staff/locations/:id/availability", async (c) => {
  const staff = requireRole(c, "barista", "manager");
  const b = await body<{ productId?: string; ingredient?: string; soldOut: boolean }>(c);
  const loc = await getLocation(c.env.DB, c.req.param("id"));
  if (b.productId) {
    await c.env.DB.prepare(
      "INSERT INTO location_products (location_id, product_id, sold_out) VALUES (?,?,?) ON CONFLICT(location_id, product_id) DO UPDATE SET sold_out = excluded.sold_out",
    ).bind(loc.id, b.productId, b.soldOut ? 1 : 0).run();
  } else if (b.ingredient) {
    await c.env.DB.prepare(
      "INSERT INTO location_ingredients (location_id, ingredient, sold_out) VALUES (?,?,?) ON CONFLICT(location_id, ingredient) DO UPDATE SET sold_out = excluded.sold_out",
    ).bind(loc.id, b.ingredient, b.soldOut ? 1 : 0).run();
  } else throw new DomainError("VALIDATION", "Choose a product or ingredient.");
  await audit(c.env.DB, staff.id, b.soldOut ? "MARK_SOLD_OUT" : "MARK_AVAILABLE", loc.id, { productId: b.productId, ingredient: b.ingredient });
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- manager

app.get("/manager/orders", async (c) => {
  requireRole(c, "manager");
  const q = (c.req.query("q") ?? "").trim();
  const locationId = c.req.query("location") ?? "promenade";
  const stmt = q
    ? c.env.DB.prepare(
        `SELECT o.* FROM orders o JOIN users u ON u.id = o.user_id WHERE o.location_id = ?1 AND o.status <> 'AWAITING_PAYMENT'
         AND (o.number LIKE ?2 OR u.email LIKE ?2 OR o.customer_name LIKE ?2 OR o.id = ?3) ORDER BY o.created_at DESC LIMIT 50`,
      ).bind(locationId, `%${q}%`, q)
    : c.env.DB.prepare("SELECT * FROM orders WHERE location_id = ? AND status <> 'AWAITING_PAYMENT' ORDER BY created_at DESC LIMIT 50").bind(locationId);
  const { results } = await stmt.all<OrderRow>();
  return c.json({ orders: await Promise.all(results.map((o) => presentOrder(c.env.DB, o, { events: true }))) });
});

app.post("/manager/orders/:id/refunds", async (c) => {
  const mgr = requireRole(c, "manager");
  const b = await body<{ amountCents: number; reason: string; idempotencyKey: string }>(c);
  const reason = str(b.reason, "reason", { max: 200 });
  const amount = int(b.amountCents, "Amount", 0, 1_000_000);
  if (typeof b.idempotencyKey !== "string" || b.idempotencyKey.length < 8) throw new DomainError("VALIDATION", "Missing idempotency key.");
  const refund = await refundOrder(c.env, mgr, c.req.param("id"), amount, reason, b.idempotencyKey);
  await audit(c.env.DB, mgr.id, "REFUND", c.req.param("id"), { amount, reason });
  return c.json({ refund });
});

app.get("/manager/reports", async (c) => {
  requireRole(c, "manager");
  const locationId = c.req.query("location") ?? "promenade";
  const loc = await getLocation(c.env.DB, locationId);
  const days = Math.min(Number(c.req.query("days") ?? 7), 90);
  const since = new Date(Date.now() - days * 864e5).toISOString();
  const [totals, byDay, top, timing, rewards, refunds] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT COALESCE(SUM(CASE WHEN status NOT IN ('REJECTED','CANCELLED') THEN 1 ELSE 0 END),0) AS orders,
       COALESCE(SUM(CASE WHEN status NOT IN ('REJECTED','CANCELLED') OR payment_status = 'CAPTURED' THEN total_cents - refunded_cents ELSE 0 END),0) AS net,
       COALESCE(SUM(CASE WHEN status NOT IN ('REJECTED','CANCELLED') THEN discount_cents ELSE 0 END),0) AS rewards,
       COALESCE(SUM(CASE WHEN status IN ('REJECTED','CANCELLED') THEN 1 ELSE 0 END),0) AS rejected
       FROM orders WHERE location_id = ? AND created_at > ? AND status <> 'AWAITING_PAYMENT'`,
    ).bind(loc.id, since),
    c.env.DB.prepare(
      `SELECT substr(created_at,1,10) AS day, COUNT(*) AS orders, COALESCE(SUM(total_cents - refunded_cents),0) AS net
       FROM orders WHERE location_id = ? AND created_at > ? AND status NOT IN ('AWAITING_PAYMENT','REJECTED','CANCELLED') GROUP BY day ORDER BY day`,
    ).bind(loc.id, since),
    c.env.DB.prepare(
      `SELECT json_extract(l.value,'$.name') AS name, SUM(json_extract(l.value,'$.quantity')) AS qty, SUM(json_extract(l.value,'$.lineCents')) AS cents
       FROM orders o, json_each(o.lines_json) l WHERE o.location_id = ? AND o.created_at > ? AND o.status NOT IN ('AWAITING_PAYMENT','REJECTED','CANCELLED')
       GROUP BY name ORDER BY qty DESC LIMIT 8`,
    ).bind(loc.id, since),
    c.env.DB.prepare(
      `SELECT AVG((julianday(ready_at) - julianday(created_at)) * 1440) AS avg_ready_min,
       AVG(CASE WHEN ready_at <= promised_at THEN 1.0 ELSE 0.0 END) AS on_time
       FROM orders WHERE location_id = ? AND created_at > ? AND ready_at IS NOT NULL AND scheduled = 0`,
    ).bind(loc.id, since),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS unlocked FROM loyalty_ledger WHERE kind = 'UNLOCK' AND created_at > ?`,
    ).bind(since),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(r.amount_cents),0) AS cents FROM refunds r JOIN orders o ON o.id = r.order_id
       WHERE o.location_id = ? AND r.created_at > ? AND r.status = 'SUCCEEDED'`,
    ).bind(loc.id, since),
  ]);
  return c.json({
    days,
    totals: totals.results[0],
    byDay: byDay.results,
    topItems: top.results,
    timing: timing.results[0],
    rewardsUnlocked: (rewards.results[0] as { unlocked: number }).unlocked,
    refunds: refunds.results[0],
  });
});

app.get("/manager/products", async (c) => {
  requireRole(c, "manager");
  const locationId = c.req.query("location") ?? "promenade";
  const { results } = await c.env.DB.prepare(
    `SELECT p.id, p.name, p.description, p.category_id, p.base_price_cents, p.active, lp.price_cents AS location_price_cents
     FROM products p LEFT JOIN location_products lp ON lp.product_id = p.id AND lp.location_id = ? ORDER BY p.sort`,
  ).bind(locationId).all();
  return c.json({ products: results });
});

app.patch("/manager/products/:id", async (c) => {
  const mgr = requireRole(c, "manager");
  const b = await body<{ name?: string; description?: string; basePriceCents?: number; active?: boolean; locationId?: string; locationPriceCents?: number | null }>(c);
  const p = await c.env.DB.prepare("SELECT * FROM products WHERE id = ?").bind(c.req.param("id")).first<{ id: string; name: string; description: string; base_price_cents: number; active: number }>();
  if (!p) throw new DomainError("NOT_FOUND", "Product not found.", 404);
  const next = {
    name: b.name !== undefined ? str(b.name, "name", { max: 60 }) : p.name,
    description: b.description !== undefined ? str(b.description, "description", { min: 0, max: 300 }) : p.description,
    base_price_cents: b.basePriceCents !== undefined ? int(b.basePriceCents, "Price", 0, 100_000) : p.base_price_cents,
    active: b.active !== undefined ? (b.active ? 1 : 0) : p.active,
  };
  const stmts = [c.env.DB.prepare("UPDATE products SET name = ?, description = ?, base_price_cents = ?, active = ? WHERE id = ?").bind(next.name, next.description, next.base_price_cents, next.active, p.id)];
  if (b.locationId && b.locationPriceCents !== undefined) {
    const lp = b.locationPriceCents === null ? null : int(b.locationPriceCents, "Location price", 0, 100_000);
    stmts.push(
      c.env.DB.prepare(
        "INSERT INTO location_products (location_id, product_id, price_cents) VALUES (?,?,?) ON CONFLICT(location_id, product_id) DO UPDATE SET price_cents = excluded.price_cents",
      ).bind(b.locationId, p.id, lp),
    );
  }
  await c.env.DB.batch(stmts);
  await audit(c.env.DB, mgr.id, "EDIT_PRODUCT", p.id, { from: p, to: next, locationPriceCents: b.locationPriceCents });
  return c.json({ ok: true });
});

app.patch("/manager/locations/:id", async (c) => {
  const mgr = requireRole(c, "manager");
  const b = await body<{ hours?: Record<string, [string, string]>; pickupNote?: string; taxRateBps?: number; slotMinutes?: number }>(c);
  const loc = await getLocation(c.env.DB, c.req.param("id"));
  let hours = loc.hours_json;
  if (b.hours) {
    for (const [d, v] of Object.entries(b.hours)) {
      if (!/^[0-6]$/.test(d) || !Array.isArray(v) || v.length !== 2 || !v.every((t) => /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/.test(t)) || v[0] >= v[1])
        throw new DomainError("VALIDATION", "Opening hours must be HH:MM with opening before closing.");
    }
    hours = JSON.stringify(b.hours);
  }
  const note = b.pickupNote !== undefined ? str(b.pickupNote, "pickup note", { max: 160 }) : loc.pickup_note;
  const tax = b.taxRateBps !== undefined ? int(b.taxRateBps, "Tax rate", 0, 2500) : loc.tax_rate_bps;
  const slot = b.slotMinutes !== undefined ? int(b.slotMinutes, "Slot length", 5, 60) : loc.slot_minutes;
  await c.env.DB.prepare("UPDATE locations SET hours_json = ?, pickup_note = ?, tax_rate_bps = ?, slot_minutes = ?, version = version + 1 WHERE id = ?").bind(hours, note, tax, slot, loc.id).run();
  await audit(c.env.DB, mgr.id, "EDIT_LOCATION", loc.id, { hours: b.hours, pickupNote: b.pickupNote, taxRateBps: b.taxRateBps, slotMinutes: b.slotMinutes });
  return c.json({ location: await locationStatus(c.env.DB, await getLocation(c.env.DB, loc.id)) });
});

app.get("/manager/support", async (c) => {
  requireRole(c, "manager");
  const { results } = await c.env.DB.prepare(
    `SELECT s.*, u.email, u.name, o.number AS order_number FROM support_requests s JOIN users u ON u.id = s.user_id
     LEFT JOIN orders o ON o.id = s.order_id ORDER BY s.status = 'RESOLVED', s.created_at DESC LIMIT 100`,
  ).all();
  return c.json({ requests: results });
});

app.patch("/manager/support/:id", async (c) => {
  const mgr = requireRole(c, "manager");
  const b = await body<{ resolution: string }>(c);
  const resolution = str(b.resolution, "resolution", { max: 1000 });
  await c.env.DB.prepare("UPDATE support_requests SET status = 'RESOLVED', resolution = ? WHERE id = ?").bind(resolution, c.req.param("id")).run();
  await audit(c.env.DB, mgr.id, "RESOLVE_SUPPORT", c.req.param("id"), { resolution });
  return c.json({ ok: true });
});

app.get("/manager/audit", async (c) => {
  requireRole(c, "manager");
  const { results } = await c.env.DB.prepare(
    "SELECT a.id, a.action, a.target, a.detail, a.at, u.name AS actor FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id ORDER BY a.id DESC LIMIT 100",
  ).all();
  return c.json({ entries: results });
});

app.get("/manager/staff", async (c) => {
  requireRole(c, "manager");
  const { results } = await c.env.DB.prepare("SELECT id, name, email, role FROM users WHERE role <> 'customer' ORDER BY role, name").all();
  return c.json({ staff: results });
});

app.post("/manager/staff", async (c) => {
  const mgr = requireRole(c, "manager");
  const b = await body<{ email: string; role: "customer" | "barista" | "manager" }>(c);
  const email = str(b.email, "email", { max: 120 }).toLowerCase();
  if (!["customer", "barista", "manager"].includes(b.role)) throw new DomainError("VALIDATION", "Choose a role.");
  const target = await c.env.DB.prepare("SELECT id, role FROM users WHERE email = ?").bind(email).first<{ id: string; role: string }>();
  if (!target) throw new DomainError("NOT_FOUND", "No account uses that email. Ask them to sign up in the app first.", 404);
  if (target.id === mgr.id) throw new DomainError("FORBIDDEN", "You can't change your own role.", 403);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE users SET role = ? WHERE id = ?").bind(b.role, target.id),
    c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(target.id),
  ]);
  await audit(c.env.DB, mgr.id, "SET_ROLE", target.id, { email, from: target.role, to: b.role });
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- scheduled maintenance

async function maintenance(env: Env) {
  const db = env.DB;
  const now = nowIso();
  // Abandoned checkouts: ask the provider before giving up, then release slot and reward holds.
  const stale = new Date(Date.now() - 35 * 60e3).toISOString();
  const { results: waiting } = await db.prepare("SELECT * FROM orders WHERE status = 'AWAITING_PAYMENT' AND created_at < ?").bind(stale).all<OrderRow>();
  for (const o of waiting) {
    const after = await reconcileStripe(env, o).catch(() => o);
    if (after.status === "AWAITING_PAYMENT") await failPayment(env, o.id, "Checkout was not completed");
  }
  // Ready orders nobody marked as picked up are completed after 3 hours.
  const readyCutoff = new Date(Date.now() - 3 * 3600e3).toISOString();
  await db.batch([
    db.prepare("UPDATE orders SET status = 'COMPLETED', completed_at = ?, state_version = state_version + 1, updated_at = ? WHERE status = 'READY' AND ready_at < ?").bind(now, now, readyCutoff),
    db.prepare(
      `INSERT OR IGNORE INTO loyalty_ledger (user_id, kind, reward_id, unique_key, note, program_version)
       SELECT user_id, 'EXPIRE', id, 'expire:' || id, '$' || printf('%.2f', value_cents / 100.0) || ' reward expired', ? FROM rewards WHERE status = 'AVAILABLE' AND expires_at <= ?`,
    ).bind(REWARDS.programVersion, now),
    db.prepare("UPDATE rewards SET status = 'EXPIRED' WHERE status = 'AVAILABLE' AND expires_at <= ?").bind(now),
    db.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now),
    db.prepare("DELETE FROM idempotency_keys WHERE created_at < ?").bind(new Date(Date.now() - 7 * 864e5).toISOString()),
  ]);
}

export default {
  fetch: app.fetch,
  scheduled: (_event: ScheduledController, env: Env, ctx: ExecutionContext) => {
    ctx.waitUntil(maintenance(env));
  },
} satisfies ExportedHandler<Env>;
