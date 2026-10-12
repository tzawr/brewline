import type { LocationStatus, OrderStatus } from "../types";
import { time } from "../format";

export const STATUS_COPY: Record<OrderStatus, { title: string; body: string }> = {
  AWAITING_PAYMENT: { title: "Checking your payment", body: "We're confirming your payment with the card provider. You won't be charged twice." },
  PENDING_ACCEPTANCE: { title: "Sent to the café", body: "Your order is waiting for a barista to confirm it. Your card is authorized, not yet charged." },
  ACCEPTED: { title: "Order confirmed", body: "The café has your order and it's in the queue." },
  PREPARING: { title: "Being made now", body: "A barista is preparing your order." },
  READY: { title: "Ready for pickup", body: "Your order is waiting for you." },
  COMPLETED: { title: "Picked up", body: "Enjoy! Thanks for ordering with Brewline." },
  REJECTED: { title: "The café couldn't take this order", body: "You haven't been charged." },
  CANCELLED: { title: "Order cancelled", body: "Any payment hold has been released." },
};

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function CafeStatus({ loc }: { loc: LocationStatus }) {
  if (loc.paused) return <span className="status-line warn">Mobile orders paused{loc.pauseReason ? ` · ${loc.pauseReason}` : ""}</span>;
  if (!loc.open)
    return (
      <span className="status-line muted">
        Closed{loc.nextOpenAt ? ` · opens ${DAYS[new Date(loc.nextOpenAt).getDay()]} ${time(loc.nextOpenAt)}` : ""}
      </span>
    );
  if (!loc.asapSlot) return <span className="status-line warn">Fully booked right now · try again shortly</span>;
  return (
    <span className="status-line ok">
      Open · ready in about {loc.estimateMin} min
    </span>
  );
}

export function hoursText(hours: Record<string, [string, string]>) {
  const fmt = (t: string) => {
    if (t === "24:00") return "midnight";
    const [h, m] = t.split(":").map(Number);
    const d = new Date(2000, 0, 1, h, m);
    return d.toLocaleTimeString([], { hour: "numeric", minute: m ? "2-digit" : undefined });
  };
  return [1, 2, 3, 4, 5, 6, 0].map((d) => {
    const h = hours[String(d)];
    return { day: DAYS[d], text: !h ? "Closed" : h[0] === "00:00" && h[1] === "24:00" ? "Open 24 hours" : `${fmt(h[0])} – ${fmt(h[1])}` };
  });
}
