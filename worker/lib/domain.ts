// Pure domain rules: no database access, so they are unit-tested directly.

export const REWARDS = {
  programVersion: "2026-10",
  thresholdCents: 5000,
  rewardCents: 500,
  rewardLifetimeDays: 90,
} as const;

export type GroupKind = "single" | "multi" | "quantity";

export interface ModifierOption {
  id: string;
  group_id: string;
  name: string;
  price_delta_cents: number;
  is_default: number;
  ingredient: string | null;
  sort: number;
}

export interface ModifierGroup {
  id: string;
  name: string;
  kind: GroupKind;
  min_select: number;
  max_select: number;
  max_quantity: number;
  options: ModifierOption[];
}

export interface MenuProduct {
  id: string;
  name: string;
  station: "bar" | "kitchen";
  price_cents: number;
  sold_out: boolean;
  active: boolean;
  ingredients: string[];
  groups: ModifierGroup[];
}

/** groupId -> optionId -> quantity (1 for single/multi choices). */
export type Selections = Record<string, Record<string, number>>;

export interface CartLineInput {
  productId: string;
  quantity: number;
  selections?: Selections;
}

export interface PricedModifier {
  group: string;
  option: string;
  quantity: number;
  priceCents: number;
  /** false when the customer changed it from the recipe default (shown emphasized on tickets). */
  isDefault: boolean;
}

export interface PricedLine {
  productId: string;
  name: string;
  station: "bar" | "kitchen";
  quantity: number;
  unitCents: number;
  lineCents: number;
  modifiers: PricedModifier[];
  selections: Selections;
}

export class DomainError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    public details?: unknown,
  ) {
    super(message);
  }
}

export function defaultSelections(product: Pick<MenuProduct, "groups">): Selections {
  const out: Selections = {};
  for (const g of product.groups) {
    const defs = g.options.filter((o) => o.is_default);
    if (defs.length) out[g.id] = Object.fromEntries(defs.map((o) => [o.id, 1]));
  }
  return out;
}

/** Validates a line against the product's modifier rules and prices it on the server. */
export function priceLine(
  product: MenuProduct | undefined,
  input: CartLineInput,
  soldOutIngredients: Set<string>,
): PricedLine {
  if (!product || !product.active) throw new DomainError("ITEM_UNAVAILABLE", "This item is no longer on the menu.", 409, { productId: input.productId });
  if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 10)
    throw new DomainError("INVALID_QUANTITY", "Quantity must be between 1 and 10.");
  if (product.sold_out || product.ingredients.some((i) => soldOutIngredients.has(i)))
    throw new DomainError("SOLD_OUT", `${product.name} is sold out right now.`, 409, { productId: product.id });

  const raw = input.selections ?? {};
  for (const gid of Object.keys(raw))
    if (!product.groups.some((g) => g.id === gid))
      throw new DomainError("INVALID_MODIFIER", `That option isn't available for ${product.name}.`);

  const selections: Selections = {};
  const modifiers: PricedModifier[] = [];
  let unit = product.price_cents;

  for (const g of product.groups) {
    const chosen = raw[g.id] ?? Object.fromEntries(g.options.filter((o) => o.is_default).map((o) => [o.id, 1]));
    const entries = Object.entries(chosen).filter(([, q]) => q > 0);
    for (const [oid, q] of entries) {
      if (!g.options.some((o) => o.id === oid)) throw new DomainError("INVALID_MODIFIER", `Unknown choice for ${g.name}.`);
      if (!Number.isInteger(q)) throw new DomainError("INVALID_MODIFIER", `Invalid amount for ${g.name}.`);
    }
    if (g.kind === "quantity") {
      const total = entries.reduce((s, [, q]) => s + q, 0);
      if (total > g.max_quantity) throw new DomainError("INVALID_MODIFIER", `${g.name}: up to ${g.max_quantity} in total.`);
      if (entries.length > g.max_select) throw new DomainError("INVALID_MODIFIER", `${g.name}: choose up to ${g.max_select} kinds.`);
    } else {
      if (entries.some(([, q]) => q !== 1)) throw new DomainError("INVALID_MODIFIER", `Invalid amount for ${g.name}.`);
      if (entries.length < g.min_select) throw new DomainError("MODIFIER_REQUIRED", `Please choose a ${g.name.toLowerCase()}.`);
      if (entries.length > g.max_select) throw new DomainError("INVALID_MODIFIER", `${g.name}: choose up to ${g.max_select}.`);
    }
    if (entries.length) selections[g.id] = Object.fromEntries(entries);
    for (const [oid, q] of entries) {
      const o = g.options.find((x) => x.id === oid)!;
      if (o.ingredient && soldOutIngredients.has(o.ingredient))
        throw new DomainError("SOLD_OUT", `${o.name} is sold out right now. Please pick another option.`, 409, { productId: product.id, optionId: o.id });
      const price = o.price_delta_cents * q;
      unit += price;
      modifiers.push({ group: g.name, option: o.name, quantity: q, priceCents: price, isDefault: !!o.is_default && q === 1 });
    }
  }

  return {
    productId: product.id,
    name: product.name,
    station: product.station,
    quantity: input.quantity,
    unitCents: unit,
    lineCents: unit * input.quantity,
    modifiers,
    selections,
  };
}

export interface Totals {
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  qualifyingCents: number;
}

/** Reward credit applies before tax; tax uses half-up rounding on the discounted subtotal. */
export function computeTotals(lines: PricedLine[], taxRateBps: number, rewardCents: number): Totals {
  const subtotal = lines.reduce((s, l) => s + l.lineCents, 0);
  const discount = Math.min(rewardCents, subtotal);
  const taxable = subtotal - discount;
  const tax = Math.floor((taxable * taxRateBps + 5000) / 10000);
  return { subtotalCents: subtotal, discountCents: discount, taxCents: tax, totalCents: taxable + tax, qualifyingCents: taxable };
}

/**
 * Plain-language rewards summary used by every screen, so the wording is consistent.
 * A refund after a reward was unlocked can leave the balance below zero; we show the true
 * amount still needed rather than pretending the customer is at $0.
 */
export function rewardsSummary(balanceCents: number) {
  const into = balanceCents >= 0 ? balanceCents % REWARDS.thresholdCents : 0;
  return {
    progressCents: into,
    thresholdCents: REWARDS.thresholdCents,
    remainingCents: balanceCents >= 0 ? REWARDS.thresholdCents - into : REWARDS.thresholdCents - balanceCents,
    adjustmentCents: balanceCents < 0 ? -balanceCents : 0,
    rewardCents: REWARDS.rewardCents,
  };
}

/** Proportional loyalty reversal for a refund, never more than was earned. */
export function reversalFor(earnedCents: number, orderTotalCents: number, refundCents: number, alreadyReversedCents: number) {
  if (orderTotalCents <= 0 || earnedCents <= 0) return 0;
  const target = Math.round((earnedCents * Math.min(refundCents, orderTotalCents)) / orderTotalCents);
  return Math.max(0, Math.min(target, earnedCents - alreadyReversedCents));
}

// ---------------------------------------------------------------- fulfillment state machine

export type OrderStatus =
  | "AWAITING_PAYMENT"
  | "PENDING_ACCEPTANCE"
  | "ACCEPTED"
  | "PREPARING"
  | "READY"
  | "COMPLETED"
  | "REJECTED"
  | "CANCELLED";

const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  AWAITING_PAYMENT: ["PENDING_ACCEPTANCE", "CANCELLED"],
  PENDING_ACCEPTANCE: ["ACCEPTED", "REJECTED", "CANCELLED"],
  ACCEPTED: ["PREPARING", "CANCELLED"],
  PREPARING: ["READY", "CANCELLED"],
  READY: ["COMPLETED"],
  COMPLETED: [],
  REJECTED: [],
  CANCELLED: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus) {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export const ACTIVE_STATUSES: OrderStatus[] = ["PENDING_ACCEPTANCE", "ACCEPTED", "PREPARING", "READY"];

// ---------------------------------------------------------------- time & pickup slots

export interface LocationHours {
  timezone: string;
  hours: Record<string, [string, string]>;
  leadTimeMin: number;
  slotMinutes: number;
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  weekday: number;
  minutes: number;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return {
    year: +parts.year,
    month: +parts.month,
    day: +parts.day,
    weekday: WEEKDAYS[parts.weekday],
    minutes: +parts.hour * 60 + +parts.minute,
  };
}

/** Converts a wall-clock time in `timeZone` to a UTC Date (handles DST by re-checking the offset). */
export function zonedToUtc(year: number, month: number, day: number, minutes: number, timeZone: string): Date {
  const guess = Date.UTC(year, month - 1, day, 0, minutes);
  let t = guess;
  for (let i = 0; i < 2; i++) {
    const p = zonedParts(new Date(t), timeZone);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, 0, p.minutes);
    t = t - (asUtc - guess);
  }
  return new Date(t);
}

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

export interface OpenState {
  open: boolean;
  closesAt: string | null;
  nextOpenAt: string | null;
}

export function openState(loc: LocationHours, now: Date): OpenState {
  const p = zonedParts(now, loc.timezone);
  const today = loc.hours[String(p.weekday)];
  if (today) {
    const [o, c] = today.map(toMin);
    if (p.minutes >= o && p.minutes < c)
      return { open: true, closesAt: zonedToUtc(p.year, p.month, p.day, c, loc.timezone).toISOString(), nextOpenAt: null };
  }
  // Find the next opening within a week.
  for (let d = 0; d < 8; d++) {
    const base = new Date(Date.UTC(p.year, p.month - 1, p.day + d));
    const wd = base.getUTCDay();
    const h = loc.hours[String(wd)];
    if (!h) continue;
    const o = toMin(h[0]);
    if (d === 0 && o <= p.minutes) continue;
    return {
      open: false,
      closesAt: null,
      nextOpenAt: zonedToUtc(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), o, loc.timezone).toISOString(),
    };
  }
  return { open: false, closesAt: null, nextOpenAt: null };
}

/** Pickup slot start times (UTC ISO) for the rest of today and tomorrow's opening hours. */
export function pickupSlots(loc: LocationHours, now: Date, maxSlots = 96): string[] {
  const p = zonedParts(now, loc.timezone);
  const out: string[] = [];
  for (let d = 0; d < 2 && out.length < maxSlots; d++) {
    const base = new Date(Date.UTC(p.year, p.month - 1, p.day + d));
    const h = loc.hours[String(base.getUTCDay())];
    if (!h) continue;
    const [o, c] = h.map(toMin);
    const earliest = d === 0 ? Math.max(o, p.minutes + loc.leadTimeMin) : Math.max(o, p.minutes + loc.leadTimeMin - 1440);
    const first = Math.ceil(earliest / loc.slotMinutes) * loc.slotMinutes;
    for (let m = first; m + loc.slotMinutes <= c && out.length < maxSlots; m += loc.slotMinutes)
      out.push(zonedToUtc(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), m, loc.timezone).toISOString());
  }
  return out;
}
