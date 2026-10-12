export const money = (cents: number) => `${cents < 0 ? "−" : ""}$${(Math.abs(cents) / 100).toFixed(2)}`;

export const time = (iso: string | null | undefined, tz?: string) =>
  iso ? new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone: tz }) : "";

export const dateTime = (iso: string, tz?: string) =>
  new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: tz });

export const dayLabel = (iso: string, tz?: string) => {
  const d = new Date(iso);
  const today = new Date();
  const fmt = (x: Date) => x.toLocaleDateString([], { timeZone: tz });
  if (fmt(d) === fmt(today)) return "Today";
  const y = new Date(Date.now() - 864e5);
  if (fmt(d) === fmt(y)) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric", timeZone: tz });
};

export const minutesAgo = (iso: string) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return `${h} hr${h > 1 ? "s" : ""} ago`;
};

export const minutesUntil = (iso: string) => Math.max(0, Math.round((Date.parse(iso) - Date.now()) / 60000));

export function modifierText(mods: { group: string; option: string; quantity: number }[]) {
  return mods.map((m) => (m.quantity > 1 ? `${m.quantity}× ${m.option}` : m.option)).join(" · ");
}
