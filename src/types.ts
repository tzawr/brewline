export type Role = "customer" | "barista" | "manager";
export interface User { id: string; email: string; name: string; role: Role; marketingOptIn: boolean; createdAt: string }

export interface Option { id: string; group_id: string; name: string; price_delta_cents: number; is_default: number; ingredient: string | null }
export interface Group { id: string; name: string; kind: "single" | "multi" | "quantity"; min_select: number; max_select: number; max_quantity: number; options: Option[] }
export interface Product {
  id: string; categoryId: string; name: string; description: string; price_cents: number; station: "bar" | "kitchen";
  calories: number | null; allergens: string; art: string; sold_out: boolean; groups: Group[];
}
export type Selections = Record<string, Record<string, number>>;

export interface LocationStatus {
  id: string; name: string; address: string; timezone: string; hours: Record<string, [string, string]>;
  open: boolean; paused: boolean; pauseReason: string | null; acceptingOrders: boolean; closesAt: string | null; nextOpenAt: string | null;
  leadTimeMin: number; slotMinutes: number; ordersPerSlot: number; taxRateBps: number; pickupNote: string;
  asapSlot: string | null; estimateMin: number | null; slots: string[]; version: number;
}

export interface Menu { location: LocationStatus; categories: { id: string; name: string }[]; products: Product[]; announcements: { id: string; title: string; body: string }[]; fetchedAt: string }

export interface CartLine { key: string; productId: string; quantity: number; selections: Selections }

export interface PricedLine {
  productId: string; name: string; station: "bar" | "kitchen"; quantity: number; unitCents: number; lineCents: number;
  modifiers: { group: string; option: string; quantity: number; priceCents: number; isDefault?: boolean }[]; selections: Selections;
}

export interface Quote {
  location: { id: string; name: string; pickupNote: string; acceptingOrders: boolean; paused: boolean; open: boolean; pauseReason: string | null; nextOpenAt: string | null };
  lines: PricedLine[]; subtotalCents: number; discountCents: number; taxCents: number; totalCents: number; qualifyingCents: number; taxRateBps: number;
  rewardId: string | null; pickup: { type: "asap" | "scheduled"; slotStart: string | null; slotMinutes: number };
  rewardsEffect: { earnsCents: number; thresholdCents: number };
}

export type OrderStatus = "AWAITING_PAYMENT" | "PENDING_ACCEPTANCE" | "ACCEPTED" | "PREPARING" | "READY" | "COMPLETED" | "REJECTED" | "CANCELLED";

export interface Order {
  id: string; number: string; customerName: string; status: OrderStatus; stateVersion: number;
  paymentStatus: string; paymentProvider: "none" | "demo" | "stripe"; tender: string | null; scheduled: boolean; slotStart: string; promisedAt: string;
  lines: PricedLine[]; subtotalCents: number; discountCents: number; taxCents: number; totalCents: number; refundedCents: number;
  rejectReason: string | null; createdAt: string; updatedAt: string; readyAt: string | null; completedAt: string | null;
  location: { id: string; name: string; address: string; pickup_note: string; timezone: string };
  refunds: { id: string; amount_cents: number; reason: string; status: string; created_at: string }[];
  events?: { kind: string; from_status: string | null; to_status: string | null; note: string | null; at: string }[];
  active: boolean;
}

export interface Rewards {
  program: { name: string; version: string; rules: string[] };
  progressCents: number; thresholdCents: number; remainingCents: number; adjustmentCents: number; rewardCents: number;
  available: { id: string; value_cents: number; expires_at: string }[];
  held: { id: string; value_cents: number; number: string | null }[];
  pendingCents: number;
  activity: { kind: string; progress_cents: number; note: string; created_at: string }[];
}

export interface Favorite { id: string; name: string; productId: string; selections: Selections; createdAt: string }
