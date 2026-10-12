import { DomainError, openState, pickupSlots, type LocationHours, type MenuProduct, type ModifierGroup, type ModifierOption } from "./domain";

export interface LocationRow {
  id: string;
  name: string;
  address: string;
  timezone: string;
  hours_json: string;
  paused: number;
  pause_reason: string | null;
  lead_time_min: number;
  slot_minutes: number;
  orders_per_slot: number;
  tax_rate_bps: number;
  pickup_note: string;
  version: number;
}

export function hoursOf(loc: LocationRow): LocationHours {
  return { timezone: loc.timezone, hours: JSON.parse(loc.hours_json), leadTimeMin: loc.lead_time_min, slotMinutes: loc.slot_minutes };
}

export async function getLocation(db: D1Database, id: string) {
  const loc = await db.prepare("SELECT * FROM locations WHERE id = ?").bind(id).first<LocationRow>();
  if (!loc) throw new DomainError("NOT_FOUND", "We couldn't find that café.", 404);
  return loc;
}

/** Slot start -> number of orders holding capacity in it. */
export async function slotLoad(db: D1Database, locationId: string, fromIso: string) {
  const { results } = await db
    .prepare(
      `SELECT slot_start, COUNT(*) AS n FROM orders WHERE location_id = ? AND slot_start >= ?
       AND status NOT IN ('REJECTED','CANCELLED') GROUP BY slot_start`,
    )
    .bind(locationId, fromIso)
    .all<{ slot_start: string; n: number }>();
  return new Map(results.map((r) => [r.slot_start, r.n]));
}

export async function locationStatus(db: D1Database, loc: LocationRow, now = new Date()) {
  const hours = hoursOf(loc);
  const state = openState(hours, now);
  const slots = state.open && !loc.paused ? pickupSlots(hours, now) : [];
  const load = slots.length ? await slotLoad(db, loc.id, slots[0]) : new Map<string, number>();
  const available = slots.filter((s) => (load.get(s) ?? 0) < loc.orders_per_slot);
  // ASAP only means soon: if nothing is free in the next 2 hours, we say so instead of quietly booking tomorrow.
  const asap = available.find((s) => Date.parse(s) - now.getTime() <= 2 * 3600e3) ?? null;
  const estimateMin = asap ? Math.max(loc.lead_time_min, Math.round((Date.parse(asap) - now.getTime()) / 60000) + loc.slot_minutes) : null;
  return {
    id: loc.id,
    name: loc.name,
    address: loc.address,
    timezone: loc.timezone,
    hours: hours.hours,
    open: state.open,
    paused: !!loc.paused,
    pauseReason: loc.pause_reason,
    acceptingOrders: state.open && !loc.paused && !!asap,
    closesAt: state.closesAt,
    nextOpenAt: state.nextOpenAt,
    leadTimeMin: loc.lead_time_min,
    slotMinutes: loc.slot_minutes,
    ordersPerSlot: loc.orders_per_slot,
    taxRateBps: loc.tax_rate_bps,
    pickupNote: loc.pickup_note,
    asapSlot: asap,
    estimateMin,
    slots: available,
    version: loc.version,
  };
}

/** Full location menu with location prices, sold-out flags and modifier groups. */
export async function loadMenu(db: D1Database, locationId: string) {
  const [cats, products, groups, options, links, lp, li] = await db.batch([
    db.prepare("SELECT id, name, sort FROM categories ORDER BY sort"),
    db.prepare("SELECT * FROM products ORDER BY sort"),
    db.prepare("SELECT * FROM modifier_groups ORDER BY sort"),
    db.prepare("SELECT * FROM modifier_options ORDER BY sort"),
    db.prepare("SELECT * FROM product_modifier_groups ORDER BY sort"),
    db.prepare("SELECT * FROM location_products WHERE location_id = ?").bind(locationId),
    db.prepare("SELECT ingredient FROM location_ingredients WHERE location_id = ? AND sold_out = 1").bind(locationId),
  ]);
  const soldOutIngredients = new Set((li.results as { ingredient: string }[]).map((r) => r.ingredient));
  const overrides = new Map((lp.results as { product_id: string; price_cents: number | null; sold_out: number }[]).map((r) => [r.product_id, r]));
  const optsByGroup = new Map<string, ModifierOption[]>();
  for (const o of options.results as unknown as ModifierOption[]) {
    if (!optsByGroup.has(o.group_id)) optsByGroup.set(o.group_id, []);
    optsByGroup.get(o.group_id)!.push(o);
  }
  const groupMap = new Map(
    (groups.results as unknown as ModifierGroup[]).map((g) => [g.id, { ...g, options: optsByGroup.get(g.id) ?? [] }]),
  );
  const groupsByProduct = new Map<string, ModifierGroup[]>();
  for (const l of links.results as { product_id: string; group_id: string }[]) {
    if (!groupsByProduct.has(l.product_id)) groupsByProduct.set(l.product_id, []);
    groupsByProduct.get(l.product_id)!.push(groupMap.get(l.group_id)!);
  }

  type ProductRow = {
    id: string; category_id: string; name: string; description: string; base_price_cents: number; station: "bar" | "kitchen";
    calories: number | null; allergens: string; art: string; active: number; ingredients: string;
  };
  const list = (products.results as unknown as ProductRow[]).map((p) => {
    const o = overrides.get(p.id);
    const ingredients = p.ingredients ? p.ingredients.split(",") : [];
    const product: MenuProduct & Record<string, unknown> = {
      id: p.id,
      categoryId: p.category_id,
      name: p.name,
      description: p.description,
      price_cents: o?.price_cents ?? p.base_price_cents,
      station: p.station,
      calories: p.calories,
      allergens: p.allergens,
      art: p.art,
      active: !!p.active,
      sold_out: !!o?.sold_out || ingredients.some((i) => soldOutIngredients.has(i)),
      ingredients,
      groups: groupsByProduct.get(p.id) ?? [],
    };
    return product;
  });
  return { categories: cats.results as { id: string; name: string }[], products: list, soldOutIngredients };
}

export async function allIngredients(db: D1Database, locationId: string) {
  const { results } = await db
    .prepare(
      `WITH ing AS (
         SELECT DISTINCT ingredient AS name FROM modifier_options WHERE ingredient IS NOT NULL
         UNION SELECT DISTINCT value FROM products, json_each('["' || replace(ingredients, ',', '","') || '"]') WHERE ingredients <> ''
       )
       SELECT ing.name, COALESCE(li.sold_out, 0) AS sold_out FROM ing
       LEFT JOIN location_ingredients li ON li.ingredient = ing.name AND li.location_id = ?
       ORDER BY ing.name`,
    )
    .bind(locationId)
    .all<{ name: string; sold_out: number }>();
  return results;
}
