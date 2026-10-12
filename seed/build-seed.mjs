// Generates seed/seed.sql. Run: node seed/build-seed.mjs
import { writeFileSync } from "node:fs";

const q = (v) => (v === null || v === undefined ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const rows = [];
const ins = (table, obj) => rows.push(`INSERT OR REPLACE INTO ${table} (${Object.keys(obj).join(",")}) VALUES (${Object.values(obj).map(q).join(",")});`);

const allDay = JSON.stringify(Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, ["00:00", "24:00"]])));
const weekdays = JSON.stringify(Object.fromEntries([1, 2, 3, 4, 5].map((d) => [d, ["07:00", "16:00"]])));
ins("locations", { id: "promenade", name: "Promenade Café", address: "Promenade Level, Main Atrium", timezone: "America/New_York", hours_json: allDay, lead_time_min: 8, slot_minutes: 10, orders_per_slot: 8, tax_rate_bps: 800, pickup_note: "Pick up at the mobile order shelf, left of the register." });
ins("locations", { id: "harbour", name: "Harbour Hall Kiosk", address: "Harbour Hall, Ground Floor", timezone: "America/New_York", hours_json: weekdays, lead_time_min: 12, slot_minutes: 15, orders_per_slot: 5, tax_rate_bps: 800, pickup_note: "Pick up at the kiosk counter." });

const cats = [["hot", "Hot Coffee"], ["iced", "Iced & Cold Brew"], ["tea", "Tea & Matcha"], ["bakery", "Bakery"], ["breakfast", "Breakfast & Lunch"]];
cats.forEach(([id, name], i) => ins("categories", { id, name, sort: i }));

const groups = {
  size: { name: "Size", kind: "single", min_select: 1, max_select: 1, opts: [["Small · 12 oz", 0, 1], ["Medium · 16 oz", 60], ["Large · 20 oz", 110]] },
  temp: { name: "Temperature", kind: "single", min_select: 1, max_select: 1, opts: [["Hot", 0, 1], ["Extra hot", 0], ["Warm (kid-friendly)", 0]] },
  milk: { name: "Milk", kind: "single", min_select: 1, max_select: 1, opts: [["Whole milk", 0, 1, "milk_whole"], ["2% milk", 0, 0, "milk_2"], ["Oat milk", 70, 0, "milk_oat"], ["Almond milk", 70, 0, "milk_almond"], ["Soy milk", 60, 0, "milk_soy"]] },
  splash: { name: "Add milk", kind: "single", min_select: 0, max_select: 1, opts: [["Splash of whole milk", 0, 0, "milk_whole"], ["Splash of oat milk", 50, 0, "milk_oat"], ["Splash of almond milk", 50, 0, "milk_almond"]] },
  shots: { name: "Espresso shots", kind: "quantity", min_select: 0, max_select: 1, max_quantity: 4, opts: [["Extra shot", 90, 0, "espresso"]] },
  decaf: { name: "Espresso", kind: "single", min_select: 1, max_select: 1, opts: [["Signature roast", 0, 1, "espresso"], ["Decaf", 0, 0, "decaf"]] },
  syrup: { name: "Syrup pumps", kind: "quantity", min_select: 0, max_select: 3, max_quantity: 6, opts: [["Vanilla", 20, 0, "syrup_vanilla"], ["Caramel", 20, 0, "syrup_caramel"], ["Hazelnut", 20, 0, "syrup_hazelnut"], ["Sugar-free vanilla", 20, 0, "syrup_sf_vanilla"]] },
  ice: { name: "Ice", kind: "single", min_select: 1, max_select: 1, opts: [["Light ice", 0], ["Regular ice", 0, 1], ["Extra ice", 0]] },
  sweet: { name: "Sweetener", kind: "multi", min_select: 0, max_select: 2, opts: [["Honey", 0], ["Raw sugar", 0], ["Stevia", 0]] },
  top: { name: "Toppings", kind: "multi", min_select: 0, max_select: 3, opts: [["Whipped cream", 50, 0, "whip"], ["Caramel drizzle", 50, 0, "syrup_caramel"], ["Cinnamon dusting", 0]] },
  warm: { name: "Preparation", kind: "single", min_select: 1, max_select: 1, opts: [["Warmed", 0, 1], ["Not warmed", 0]] },
  bread: { name: "Bread", kind: "single", min_select: 1, max_select: 1, opts: [["Sourdough", 0, 1], ["Multigrain", 0], ["Gluten-free roll", 100, 0, "gf_bread"]] },
  extra: { name: "Add-ons", kind: "multi", min_select: 0, max_select: 3, opts: [["Avocado", 150, 0, "avocado"], ["Extra egg", 120, 0, "egg"], ["Bacon", 180, 0, "bacon"]] },
};
Object.entries(groups).forEach(([gid, g], gi) => {
  ins("modifier_groups", { id: gid, name: g.name, kind: g.kind, min_select: g.min_select, max_select: g.max_select, max_quantity: g.max_quantity ?? 0, sort: gi });
  g.opts.forEach(([name, price, def, ing], i) =>
    ins("modifier_options", { id: `${gid}_${i}`, group_id: gid, name, price_delta_cents: price, is_default: def ? 1 : 0, default_quantity: 0, ingredient: ing ?? null, sort: i }));
});

const P = (id, cat, name, price, art, desc, mods, extra = {}) => ({ id, cat, name, price, art, desc, mods, ...extra });
const products = [
  P("latte", "hot", "Caffè Latte", 450, "latte", "Signature espresso with steamed milk and a thin layer of foam.", ["size", "decaf", "milk", "temp", "shots", "syrup", "top"], { cal: 190, ing: "espresso", allergens: "Milk" }),
  P("cappuccino", "hot", "Cappuccino", 440, "cappuccino", "Equal parts espresso, steamed milk and deep, velvety foam.", ["size", "decaf", "milk", "temp", "shots", "syrup"], { cal: 140, ing: "espresso", allergens: "Milk" }),
  P("flatwhite", "hot", "Flat White", 480, "flatwhite", "Ristretto shots with micro-foamed whole milk. Smooth and strong.", ["size", "milk", "temp", "shots"], { cal: 170, ing: "espresso", allergens: "Milk" }),
  P("mocha", "hot", "Caffè Mocha", 520, "mocha", "Espresso, bittersweet chocolate sauce and steamed milk.", ["size", "decaf", "milk", "temp", "shots", "top"], { cal: 290, ing: "espresso,chocolate", allergens: "Milk, Soy" }),
  P("americano", "hot", "Americano", 360, "americano", "Espresso shots topped with hot water for a bold, clean cup.", ["size", "decaf", "shots", "splash", "syrup"], { cal: 15, ing: "espresso", allergens: "" }),
  P("drip", "hot", "House Drip Coffee", 290, "drip", "Today’s medium roast, brewed fresh every 30 minutes.", ["size", "splash", "syrup"], { cal: 5, ing: "drip", allergens: "" }),
  P("icedlatte", "iced", "Iced Latte", 490, "icedlatte", "Espresso over ice with cold milk.", ["size", "decaf", "milk", "ice", "shots", "syrup"], { cal: 130, ing: "espresso", allergens: "Milk" }),
  P("coldbrew", "iced", "Cold Brew", 430, "coldbrew", "Steeped for 18 hours. Naturally sweet, low acidity.", ["size", "ice", "splash", "syrup"], { cal: 5, ing: "coldbrew", allergens: "" }),
  P("vanillacoldfoam", "iced", "Vanilla Cold Foam Cold Brew", 560, "coldfoam", "Cold brew topped with vanilla sweet cream cold foam.", ["size", "ice", "syrup"], { cal: 110, ing: "coldbrew,milk_whole", allergens: "Milk" }),
  P("icedamericano", "iced", "Iced Americano", 380, "icedamericano", "Espresso and cold water over ice.", ["size", "ice", "shots", "splash", "syrup"], { cal: 15, ing: "espresso", allergens: "" }),
  P("matcha", "tea", "Matcha Latte", 520, "matcha", "Stone-ground ceremonial matcha whisked with steamed milk.", ["size", "milk", "temp", "sweet"], { cal: 200, ing: "matcha", allergens: "Milk" }),
  P("chai", "tea", "Chai Latte", 490, "chai", "Black tea, cinnamon, cardamom and ginger with steamed milk.", ["size", "milk", "temp", "top"], { cal: 240, ing: "chai", allergens: "Milk" }),
  P("earlgrey", "tea", "Earl Grey Tea", 300, "tea", "Black tea with bergamot. Served hot.", ["size", "splash", "sweet"], { cal: 0, ing: "tea", allergens: "" }),
  P("hotchoc", "tea", "Hot Chocolate", 420, "hotchoc", "Rich chocolate and steamed milk, topped with whipped cream.", ["size", "milk", "temp", "top"], { cal: 320, ing: "chocolate", allergens: "Milk, Soy" }),
  P("croissant", "bakery", "Butter Croissant", 350, "croissant", "Laminated with cultured butter, baked every morning.", ["warm"], { cal: 260, allergens: "Wheat, Milk, Egg", station: "kitchen" }),
  P("almondcroissant", "bakery", "Almond Croissant", 420, "almondcroissant", "Twice-baked with almond frangipane and toasted almonds.", ["warm"], { cal: 410, allergens: "Wheat, Milk, Egg, Tree nuts", station: "kitchen" }),
  P("muffin", "bakery", "Blueberry Muffin", 340, "muffin", "Packed with wild blueberries and a crumb top.", ["warm"], { cal: 380, allergens: "Wheat, Milk, Egg", station: "kitchen" }),
  P("cookie", "bakery", "Chocolate Chunk Cookie", 280, "cookie", "Dark chocolate chunks and flaky sea salt.", [], { cal: 360, allergens: "Wheat, Milk, Egg, Soy", station: "kitchen" }),
  P("eggsandwich", "breakfast", "Egg & Cheddar Sandwich", 590, "sandwich", "Cage-free egg, aged cheddar and herb aioli.", ["bread", "extra"], { cal: 470, ing: "egg", allergens: "Wheat, Milk, Egg", station: "kitchen" }),
  P("avotoast", "breakfast", "Avocado Toast", 690, "avotoast", "Smashed avocado, chili flakes, lemon and sea salt on sourdough.", ["bread", "extra"], { cal: 350, ing: "avocado", allergens: "Wheat", station: "kitchen" }),
  P("oats", "breakfast", "Overnight Oats", 520, "oats", "Rolled oats, chia, oat milk, berries and maple.", [], { cal: 320, ing: "milk_oat", allergens: "Oats", station: "kitchen" }),
  P("turkeypesto", "breakfast", "Turkey Pesto Panini", 890, "panini", "Roasted turkey, mozzarella, basil pesto and tomato, pressed hot.", ["bread"], { cal: 560, allergens: "Wheat, Milk, Tree nuts", station: "kitchen" }),
];
products.forEach((p, i) => {
  ins("products", { id: p.id, category_id: p.cat, name: p.name, description: p.desc, base_price_cents: p.price, station: p.station ?? "bar", calories: p.cal ?? null, allergens: p.allergens ?? "", art: p.art, sort: i, active: 1, ingredients: p.ing ?? "" });
  p.mods.forEach((g, j) => ins("product_modifier_groups", { product_id: p.id, group_id: g, sort: j }));
});

ins("announcements", { id: "a1", title: "Earn faster this month", body: "Every $50 of qualifying spend unlocks a $5 reward — progress carries over, nothing resets.", active: 1, sort: 0 });
ins("announcements", { id: "a2", title: "New: Vanilla Cold Foam", body: "Our cold brew now comes with house-made vanilla sweet cream foam.", active: 1, sort: 1 });

// Demo staff. Their password hash is not a valid hash, so they can only sign in through
// the one-tap demo login (enabled only when DEMO_MODE = "true").
ins("users", { id: "staff_barista", email: "barista@brewline.demo", name: "Demo Barista", password_hash: "demo-login-only", role: "barista" });
ins("users", { id: "staff_manager", email: "manager@brewline.demo", name: "Demo Manager", password_hash: "demo-login-only", role: "manager" });

writeFileSync(new URL("./seed.sql", import.meta.url), rows.join("\n") + "\n");
console.log(`seed.sql: ${rows.length} statements`);
