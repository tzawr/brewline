import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useStore } from "../store";
import { minutesAgo, money } from "../format";
import { ProductArt } from "../components/ProductArt";
import { Icon, Notice, Spinner } from "../components/ui";
import { CafeStatus } from "../components/common";

export function MenuPage() {
  const { menu, menuStale, menuError } = useStore();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (!menu) return [];
    const needle = q.trim().toLowerCase();
    return menu.categories
      .map((c) => ({
        ...c,
        items: menu.products.filter(
          (p) => p.categoryId === c.id && (!needle || p.name.toLowerCase().includes(needle) || p.description.toLowerCase().includes(needle)),
        ),
      }))
      .filter((c) => c.items.length && (!cat || c.id === cat));
  }, [menu, q, cat]);

  if (!menu) return menuError ? <div className="page"><Notice tone="error">{menuError}</Notice></div> : <Spinner label="Loading menu" />;

  return (
    <div className="page menu-page">
      <div className="sticky-top">
        <div className="menu-head">
          <div>
            <h1>Menu</h1>
            <Link to="/locations" className="menu-loc">
              <Icon name="pin" size={15} /> {menu.location.name} <Icon name="chevron" size={14} />
            </Link>
            <div><CafeStatus loc={menu.location} /></div>
          </div>
        </div>
        <label className="search">
          <Icon name="search" size={18} />
          <input type="search" placeholder="Search drinks and food" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the menu" />
        </label>
        <div className="chips" role="tablist" aria-label="Categories">
          <button role="tab" aria-selected={!cat} className={`chip${!cat ? " on" : ""}`} onClick={() => setCat(null)}>All</button>
          {menu.categories.map((c) => (
            <button key={c.id} role="tab" aria-selected={cat === c.id} className={`chip${cat === c.id ? " on" : ""}`} onClick={() => setCat(c.id)}>
              {c.name}
            </button>
          ))}
        </div>
      </div>

      {menuStale ? <div className="freshness">Showing saved menu from {minutesAgo(menu.fetchedAt)}. Prices and availability are re-checked before you pay.</div> : null}
      {!menu.location.acceptingOrders ? (
        <Notice tone="warn">
          {menu.location.paused
            ? "This café has paused mobile orders. You can still build your order — it'll be saved in your bag."
            : !menu.location.open
              ? "This café is closed right now. You can browse and save your order for later."
              : "All pickup times are taken right now. Please check back in a few minutes."}
        </Notice>
      ) : null}

      {filtered.length === 0 ? <p className="muted center-pad">No items match “{q}”.</p> : null}
      {filtered.map((c) => (
        <section key={c.id} className="menu-section">
          <h2>{c.name}</h2>
          <ul className="product-list">
            {c.items.map((p) => (
              <li key={p.id}>
                <Link to={`/menu/${p.id}`} className={`product-row${p.sold_out ? " sold-out" : ""}`}>
                  <ProductArt art={p.art} size={76} />
                  <div className="product-row-text">
                    <div className="product-name">{p.name}</div>
                    <div className="product-desc">{p.description}</div>
                    <div className="product-meta">
                      <span className="price">{money(p.price_cents)}</span>
                      {p.calories !== null ? <span>{p.calories} cal</span> : null}
                      {p.sold_out ? <span className="badge badge-muted">Sold out</span> : null}
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
