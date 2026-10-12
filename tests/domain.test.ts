import { describe, expect, it } from "vitest";
import {
  DomainError,
  canTransition,
  computeTotals,
  openState,
  pickupSlots,
  priceLine,
  reversalFor,
  rewardsSummary,
  zonedToUtc,
  type MenuProduct,
} from "../worker/lib/domain";

const latte: MenuProduct = {
  id: "latte",
  name: "Caffè Latte",
  station: "bar",
  price_cents: 450,
  sold_out: false,
  active: true,
  ingredients: ["espresso"],
  groups: [
    {
      id: "size", name: "Size", kind: "single", min_select: 1, max_select: 1, max_quantity: 0,
      options: [
        { id: "s", group_id: "size", name: "Small", price_delta_cents: 0, is_default: 1, ingredient: null, sort: 0 },
        { id: "l", group_id: "size", name: "Large", price_delta_cents: 110, is_default: 0, ingredient: null, sort: 1 },
      ],
    },
    {
      id: "milk", name: "Milk", kind: "single", min_select: 1, max_select: 1, max_quantity: 0,
      options: [
        { id: "whole", group_id: "milk", name: "Whole", price_delta_cents: 0, is_default: 1, ingredient: "milk_whole", sort: 0 },
        { id: "oat", group_id: "milk", name: "Oat", price_delta_cents: 70, is_default: 0, ingredient: "milk_oat", sort: 1 },
      ],
    },
    {
      id: "syrup", name: "Syrup pumps", kind: "quantity", min_select: 0, max_select: 2, max_quantity: 6,
      options: [
        { id: "van", group_id: "syrup", name: "Vanilla", price_delta_cents: 20, is_default: 0, ingredient: null, sort: 0 },
        { id: "car", group_id: "syrup", name: "Caramel", price_delta_cents: 20, is_default: 0, ingredient: null, sort: 1 },
        { id: "haz", group_id: "syrup", name: "Hazelnut", price_delta_cents: 20, is_default: 0, ingredient: null, sort: 2 },
      ],
    },
  ],
};

const none = new Set<string>();

describe("priceLine", () => {
  it("applies defaults when no selections are sent", () => {
    const l = priceLine(latte, { productId: "latte", quantity: 1 }, none);
    expect(l.unitCents).toBe(450);
    expect(l.modifiers.map((m) => m.option)).toEqual(["Small", "Whole"]);
  });

  it("prices size, milk and per-pump syrups on the server", () => {
    const l = priceLine(latte, { productId: "latte", quantity: 2, selections: { size: { l: 1 }, milk: { oat: 1 }, syrup: { van: 3 } } }, none);
    expect(l.unitCents).toBe(450 + 110 + 70 + 60);
    expect(l.lineCents).toBe(l.unitCents * 2);
  });

  it("rejects too many pumps or kinds", () => {
    expect(() => priceLine(latte, { productId: "latte", quantity: 1, selections: { syrup: { van: 7 } } }, none)).toThrow(DomainError);
    expect(() => priceLine(latte, { productId: "latte", quantity: 1, selections: { syrup: { van: 1, car: 1, haz: 1 } } }, none)).toThrow(/up to 2 kinds/);
  });

  it("requires a choice for required groups", () => {
    expect(() => priceLine(latte, { productId: "latte", quantity: 1, selections: { size: {} } }, none)).toThrow(/choose a size/);
  });

  it("rejects unknown options and groups", () => {
    expect(() => priceLine(latte, { productId: "latte", quantity: 1, selections: { size: { xl: 1 } } }, none)).toThrow(DomainError);
    expect(() => priceLine(latte, { productId: "latte", quantity: 1, selections: { bogus: { a: 1 } } }, none)).toThrow(DomainError);
  });

  it("blocks sold-out products, base ingredients and chosen options", () => {
    expect(() => priceLine({ ...latte, sold_out: true }, { productId: "latte", quantity: 1 }, none)).toThrow(/sold out/);
    expect(() => priceLine(latte, { productId: "latte", quantity: 1 }, new Set(["espresso"]))).toThrow(/sold out/);
    expect(() => priceLine(latte, { productId: "latte", quantity: 1, selections: { milk: { oat: 1 } } }, new Set(["milk_oat"]))).toThrow(/Oat is sold out/);
    // Unselected sold-out milk does not block the default.
    expect(priceLine(latte, { productId: "latte", quantity: 1 }, new Set(["milk_oat"])).unitCents).toBe(450);
  });

  it("validates quantity", () => {
    expect(() => priceLine(latte, { productId: "latte", quantity: 0 }, none)).toThrow(DomainError);
    expect(() => priceLine(latte, { productId: "latte", quantity: 11 }, none)).toThrow(DomainError);
    expect(() => priceLine(latte, { productId: "latte", quantity: 1.5 }, none)).toThrow(DomainError);
  });
});

describe("computeTotals", () => {
  const line = priceLine(latte, { productId: "latte", quantity: 1 }, none);
  it("taxes the subtotal with half-up rounding", () => {
    expect(computeTotals([line], 800, 0)).toEqual({ subtotalCents: 450, discountCents: 0, taxCents: 36, totalCents: 486, qualifyingCents: 450 });
    expect(computeTotals([{ ...line, lineCents: 1006 }], 887, 0).taxCents).toBe(89); // 89.23
  });
  it("applies a reward before tax and never below zero", () => {
    expect(computeTotals([line], 800, 500)).toEqual({ subtotalCents: 450, discountCents: 450, taxCents: 0, totalCents: 0, qualifyingCents: 0 });
    expect(computeTotals([{ ...line, lineCents: 900 }], 800, 500)).toMatchObject({ discountCents: 500, taxCents: 32, totalCents: 432, qualifyingCents: 400 });
  });
});

describe("rewards", () => {
  it("describes progress toward the next reward with carryover", () => {
    expect(rewardsSummary(3200)).toMatchObject({ progressCents: 3200, remainingCents: 1800 });
    expect(rewardsSummary(5300)).toMatchObject({ progressCents: 300, remainingCents: 4700 });
    expect(rewardsSummary(-200)).toMatchObject({ progressCents: 0, remainingCents: 5200, adjustmentCents: 200 });
  });
  it("reverses earned progress proportionally and only once", () => {
    expect(reversalFor(1000, 1080, 540, 0)).toBe(500);
    expect(reversalFor(1000, 1080, 1080, 500)).toBe(500);
    expect(reversalFor(1000, 1080, 5000, 0)).toBe(1000);
    expect(reversalFor(0, 1080, 540, 0)).toBe(0);
  });
});

describe("order state machine", () => {
  it("only allows documented transitions", () => {
    expect(canTransition("PENDING_ACCEPTANCE", "ACCEPTED")).toBe(true);
    expect(canTransition("PREPARING", "READY")).toBe(true);
    expect(canTransition("READY", "PREPARING")).toBe(false);
    expect(canTransition("COMPLETED", "CANCELLED")).toBe(false);
    expect(canTransition("PENDING_ACCEPTANCE", "READY")).toBe(false);
  });
});

describe("hours and pickup slots", () => {
  const loc = { timezone: "America/New_York", hours: { "1": ["07:00", "16:00"] as [string, string] }, leadTimeMin: 10, slotMinutes: 15 };

  it("converts café wall-clock time to UTC across DST", () => {
    expect(zonedToUtc(2026, 7, 6, 7 * 60, "America/New_York").toISOString()).toBe("2026-07-06T11:00:00.000Z"); // EDT
    expect(zonedToUtc(2026, 12, 7, 7 * 60, "America/New_York").toISOString()).toBe("2026-12-07T12:00:00.000Z"); // EST
  });

  it("knows when the café is open and when it next opens", () => {
    expect(openState(loc, new Date("2026-10-12T14:00:00Z")).open).toBe(true); // Mon 10:00 EDT
    const closed = openState(loc, new Date("2026-10-12T21:00:00Z")); // Mon 17:00
    expect(closed.open).toBe(false);
    expect(closed.nextOpenAt).toBe("2026-10-19T11:00:00.000Z"); // next Monday 07:00
  });

  it("offers slots after the lead time, aligned to slot length, before close", () => {
    const slots = pickupSlots(loc, new Date("2026-10-12T14:03:00Z")); // 10:03 local
    expect(slots[0]).toBe("2026-10-12T14:15:00.000Z"); // 10:13 rounded up to 10:15
    expect(slots.at(-1)).toBe("2026-10-12T19:45:00.000Z"); // 15:45, ends at 16:00 (Tuesday is closed)
  });

  it("rolls into the next day for cafés open past midnight", () => {
    const allDay = { timezone: "America/New_York", hours: Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [String(d), ["00:00", "24:00"] as [string, string]])), leadTimeMin: 8, slotMinutes: 10 };
    const slots = pickupSlots(allDay, new Date("2026-10-12T03:59:00Z")); // Sun 23:59 local
    expect(slots[0]).toBe("2026-10-12T04:10:00.000Z"); // Mon 00:10 local
  });
});
