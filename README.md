# Brewline — mobile ordering a café can actually keep up with

**Live demo: https://brewline.brewline.workers.dev** — try the customer app, then open [`/barista`](https://brewline.brewline.workers.dev/barista) and [`/manager`](https://brewline.brewline.workers.dev/manager) (one-tap demo staff logins).

A working, deployable café ordering platform: an installable **customer app**, a **barista display**, and a **manager console**, running on **Cloudflare Workers + D1**.

## Why I built it

While working at a corporate café, I wrote a product and engineering proposal to improve the mobile ordering app our customers used. I'd collected baristas' and customers' pain points: rewards nobody could explain ("stamps", "points" and "$5 off" on the same screen), checkouts that left people unsure whether they'd been charged, vague pickup times, and receipts with no next step. The proposal wasn't adopted, so I built the solution myself to show it works end to end.

Brewline is an independent project with its own brand. It isn't affiliated with, and doesn't use code or data from, any company's app.

## What the proposal asked for → what's built

| Problem from the proposal | How Brewline handles it |
|---|---|
| Rewards used several mental models at once | One model: **"$32 of $50 qualifying spend · $18 more to unlock a $5 reward"**. Progress and available rewards are shown separately, with the full rules and an activity history. |
| Uncertain checkouts and double charges | Every checkout has an **idempotency key**. Retries, double taps and dropped connections return the *same* order. The app shows "Checking your order…" and never offers a blind "pay again". |
| Order status that didn't match reality | Statuses come only from real barista actions (Sent → Confirmed → Preparing → Ready), with live polling, a "last updated" indicator, and an optional ready notification. |
| Pickup times the café couldn't meet | **Capacity-aware slots**: each café sets a lead time and a maximum number of orders per slot. Slots are reserved atomically, and "ASAP" honestly says "fully booked" instead of overbooking. |
| Sold-out items found at the counter | Baristas mark **ingredients or items** sold out. Affected options and drinks disappear, and checkout re-checks availability. |
| A barista sees a different drink from what the customer ordered | Structured modifiers (size, milk, shots, syrup pumps, ice, temperature) are validated and **priced on the server**. Tickets list items in recipe order and mark substitutions with ▲ **and** bold, not colour alone. |
| Receipt empty state with no next step | Itemized, printable receipts with refund history, a "Missing a receipt?" path, and help requests that attach the order automatically. |
| A rush overwhelms the café | One tap to **pause mobile orders** with a message to customers. Lead time and capacity can be changed live from the barista display. |

## Feature tour

**Customer app (installable PWA)**
- Café picker with live open/closed/paused status and pickup estimate
- Menu with search and categories, sold-out states, and an offline saved menu with a freshness label
- Drink customization with a live price, saved drinks, and one-tap "Order again"
- Bag with server-calculated quote, ASAP or scheduled pickup, an optional reward (applied before tax), and the rewards effect of the order
- Live order tracking, cancellation until the café accepts, and printable receipts
- Rewards page with a progress ring, available rewards, rules and ledger history
- Account: change password, marketing opt-in kept separate from order updates, and account deletion

**Barista display**
- New / In progress / Ready columns, refreshed every 3 seconds, with a sound alert for new orders
- Accept (captures payment) → Start → Ready (earns loyalty) → Picked up
- Decline or cancel with a reason. Payment holds are released, refunds are automatic, and any reward is returned.
- Overdue and unacknowledged highlights, a connection-lost indicator, pause/resume, lead time, capacity, and sold-out controls

**Manager console**
- Reports: net sales, orders, average time to ready, on-time %, rewards, refunds, and top items
- Order search with a full event timeline, plus partial or full refunds (idempotent, capped at the refundable amount)
- Menu and per-café price editing, café hours, tax, slot length and pickup instructions
- Support queue, staff roles, and an audit log of every sensitive change

## Engineering highlights

- **Separate state machines** for fulfilment, payment and rewards. Only documented transitions are allowed, and staff commands carry an `expectedVersion`, so two devices can't apply conflicting updates.
- **Append-only loyalty ledger** (`EARN`, `UNLOCK`, `RESERVE`, `REDEEM`, `RELEASE`, `REVERSE`, `EXPIRE`, `ADJUST`). Every row has a unique business key, so a duplicate event can never grant a second reward. Rewards are reserved during checkout, consumed when the café accepts, and released on cancellation. Refunds reverse earned progress proportionally.
- **Atomic capacity and reward reservation.** The order insert, the slot capacity check and the reward reservation run in one D1 transaction.
- **Payments: authorize at checkout, capture on acceptance, void on rejection.** A Stripe Checkout adapter (hosted page, manual capture, signed webhooks with replay protection, and return-page reconciliation if a webhook is lost) runs alongside a clearly labelled demo card. Card data never touches the app.
- **Money in integer cents**, with half-up tax rounding. A line-item snapshot is frozen at checkout, so later menu edits never rewrite receipts or tickets.
- **Security:** PBKDF2 password hashing, hashed session tokens in HttpOnly cookies, separate customer and staff sessions, role checks on every staff endpoint, object-level ownership checks, rate-limited login and signup, JSON-only mutations (CSRF defence), and CSP/HSTS headers.
- **Accessibility:** labelled controls, a progressbar role on rewards, live regions for status changes, status that doesn't rely on colour, 44px+ touch targets, and reduced-motion support.
- A **scheduled job** (every 5 minutes) expires abandoned checkouts after asking the payment provider, expires old rewards, and auto-completes stale ready orders.

```
React PWA (customer · barista · manager)
        │  /api/*  (JSON, cookie session)
Cloudflare Worker — Hono API
  auth · menu · quotes · checkout · orders · loyalty ledger · refunds · reports
        │                         │
   Cloudflare D1 (SQLite)      Stripe Checkout (optional)
```

## Run it locally

```bash
npm install
npm run db:migrate:local
npm run db:seed:local
npm run dev
```

Open http://localhost:5173. Create an account, place an order with the demo card, then open `/barista` in another tab and move the order through the queue.

Run the tests:

```bash
npm test
```

## Deploy to Cloudflare

```bash
npx wrangler login
npx wrangler d1 create brewline
```

Copy the `database_id` from the output into `wrangler.jsonc`, then run:

```bash
npm run db:migrate
npm run db:seed
npm run deploy
```

### Real card payments (optional)

1. Add your Stripe keys. Use test keys first.
   ```bash
   npx wrangler secret put STRIPE_SECRET_KEY
   npx wrangler secret put STRIPE_WEBHOOK_SECRET
   ```
2. In Stripe, add a webhook endpoint at `https://<your-app>/api/stripe/webhook` for `checkout.session.completed` and `checkout.session.expired`.
3. To run it as a real store, set `"DEMO_MODE": "false"` in `wrangler.jsonc`. This removes the demo card and the one-tap demo staff logins. To create your first manager, sign up in the app, then run:
   ```bash
   npx wrangler d1 execute brewline --remote --command "UPDATE users SET role='manager' WHERE email='you@example.com'"
   ```

## Customizing

- Brand name and colours: `src/styles.css` (`:root` tokens) and the `Brewline` text in the components
- Menu, cafés and hours: `seed/build-seed.mjs`, then run `node seed/build-seed.mjs`, or edit them later in the manager console
- Rewards rules: `REWARDS` in `worker/lib/domain.ts`

## Not included yet

- Email (receipts, password reset): add a provider such as Resend
- Push notifications when the app is closed. Today the order page notifies while it's open.
- Tipping, split tender and payroll deduction. These need finance and policy decisions first, as the proposal notes.
