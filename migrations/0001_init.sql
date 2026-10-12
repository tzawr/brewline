-- Brewline schema. Money is stored in integer cents.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer','barista','manager')),
  marketing_opt_in INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE login_attempts (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);

CREATE TABLE locations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  timezone TEXT NOT NULL,
  -- {"0":["07:00","17:00"],...} keyed by weekday (0 = Sunday); missing day = closed
  hours_json TEXT NOT NULL,
  paused INTEGER NOT NULL DEFAULT 0,
  pause_reason TEXT,
  lead_time_min INTEGER NOT NULL DEFAULT 10,
  slot_minutes INTEGER NOT NULL DEFAULT 10,
  orders_per_slot INTEGER NOT NULL DEFAULT 6,
  tax_rate_bps INTEGER NOT NULL DEFAULT 800,
  pickup_note TEXT NOT NULL DEFAULT 'Pick up at the mobile order shelf.',
  version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE products (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES categories(id),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  base_price_cents INTEGER NOT NULL,
  station TEXT NOT NULL DEFAULT 'bar' CHECK (station IN ('bar','kitchen')),
  calories INTEGER,
  allergens TEXT NOT NULL DEFAULT '',
  art TEXT NOT NULL DEFAULT 'latte',
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  -- ingredient keys the base recipe needs, comma separated (e.g. "espresso,milk")
  ingredients TEXT NOT NULL DEFAULT ''
);

CREATE TABLE modifier_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('single','multi','quantity')),
  min_select INTEGER NOT NULL DEFAULT 0,
  max_select INTEGER NOT NULL DEFAULT 1,
  -- for kind=quantity: max total units across options (e.g. 6 syrup pumps)
  max_quantity INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE modifier_options (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES modifier_groups(id),
  name TEXT NOT NULL,
  price_delta_cents INTEGER NOT NULL DEFAULT 0,
  is_default INTEGER NOT NULL DEFAULT 0,
  default_quantity INTEGER NOT NULL DEFAULT 0,
  ingredient TEXT,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE product_modifier_groups (
  product_id TEXT NOT NULL REFERENCES products(id),
  group_id TEXT NOT NULL REFERENCES modifier_groups(id),
  sort INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (product_id, group_id)
);

-- Per-location price overrides and sold-out state for products and ingredients.
CREATE TABLE location_products (
  location_id TEXT NOT NULL REFERENCES locations(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  price_cents INTEGER,
  sold_out INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (location_id, product_id)
);

CREATE TABLE location_ingredients (
  location_id TEXT NOT NULL REFERENCES locations(id),
  ingredient TEXT NOT NULL,
  sold_out INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (location_id, ingredient)
);

CREATE TABLE favorites (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  product_id TEXT NOT NULL REFERENCES products(id),
  selections_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_favorites_user ON favorites(user_id);

-- Server-calculated price quote. Checkout attempts must reference a live quote.
CREATE TABLE quotes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  location_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  location_id TEXT NOT NULL REFERENCES locations(id),
  customer_name TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  -- fulfillment state machine
  status TEXT NOT NULL CHECK (status IN ('AWAITING_PAYMENT','PENDING_ACCEPTANCE','ACCEPTED','PREPARING','READY','COMPLETED','REJECTED','CANCELLED')),
  state_version INTEGER NOT NULL DEFAULT 1,
  -- payment state machine (separate from fulfillment)
  payment_status TEXT NOT NULL CHECK (payment_status IN ('NONE','PROCESSING','AUTHORIZED','CAPTURED','FAILED','VOIDED')),
  payment_provider TEXT NOT NULL CHECK (payment_provider IN ('none','demo','stripe')),
  payment_ref TEXT,
  payment_session_id TEXT,
  tender_label TEXT,
  scheduled INTEGER NOT NULL DEFAULT 0,
  slot_start TEXT NOT NULL,
  promised_at TEXT NOT NULL,
  lines_json TEXT NOT NULL,
  subtotal_cents INTEGER NOT NULL,
  discount_cents INTEGER NOT NULL DEFAULT 0,
  tax_cents INTEGER NOT NULL,
  total_cents INTEGER NOT NULL,
  refunded_cents INTEGER NOT NULL DEFAULT 0,
  reward_id TEXT,
  reject_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ready_at TEXT,
  completed_at TEXT,
  UNIQUE (user_id, idempotency_key)
);
CREATE INDEX idx_orders_user ON orders(user_id, created_at);
CREATE INDEX idx_orders_location_status ON orders(location_id, status);
CREATE INDEX idx_orders_slot ON orders(location_id, slot_start);
CREATE UNIQUE INDEX idx_orders_payment_session ON orders(payment_session_id) WHERE payment_session_id IS NOT NULL;

CREATE TABLE order_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL REFERENCES orders(id),
  kind TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  actor TEXT NOT NULL,
  note TEXT,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_order_events_order ON order_events(order_id);

CREATE TABLE refunds (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  amount_cents INTEGER NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PROCESSING','SUCCEEDED','FAILED')),
  provider_ref TEXT,
  actor_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_refunds_order ON refunds(order_id);

-- Rewards: an available $X credit the customer can apply to one order.
CREATE TABLE rewards (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  value_cents INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('AVAILABLE','RESERVED','CONSUMED','EXPIRED')),
  order_id TEXT,
  issued_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_rewards_user ON rewards(user_id, status);

-- Append-only loyalty ledger. progress_cents is qualifying spend toward the next reward.
-- unique_key makes every business event post at most once.
CREATE TABLE loyalty_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('EARN','REVERSE','UNLOCK','RESERVE','REDEEM','RELEASE','EXPIRE','ADJUST')),
  progress_cents INTEGER NOT NULL DEFAULT 0,
  reward_id TEXT,
  order_id TEXT,
  unique_key TEXT NOT NULL UNIQUE,
  note TEXT NOT NULL,
  program_version TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_ledger_user ON loyalty_ledger(user_id, id);

CREATE TABLE support_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_id TEXT,
  topic TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','RESOLVED')),
  resolution TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE announcements (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL,
  detail TEXT NOT NULL,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE idempotency_keys (
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (scope, key)
);
