import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { useStore } from "../store";
import { money } from "../format";
import type { Group, Product, Selections } from "../types";
import { ProductArt } from "../components/ProductArt";
import { Button, Icon, Notice, Sheet, Spinner, Stepper } from "../components/ui";

function defaults(p: Product): Selections {
  const s: Selections = {};
  for (const g of p.groups) {
    const d = g.options.filter((o) => o.is_default);
    if (d.length) s[g.id] = Object.fromEntries(d.map((o) => [o.id, 1]));
  }
  return s;
}

function unitPrice(p: Product, sel: Selections) {
  let c = p.price_cents;
  for (const g of p.groups) for (const o of g.options) c += (sel[g.id]?.[o.id] ?? 0) * o.price_delta_cents;
  return c;
}

function groupHint(g: Group) {
  if (g.kind === "quantity") return `Up to ${g.max_quantity}`;
  if (g.min_select >= 1 && g.max_select === 1) return "Required";
  if (g.max_select > 1) return `Optional · up to ${g.max_select}`;
  return "Optional";
}

export function ProductPage() {
  const { productId } = useParams();
  const { menu, addToCart, updateLine, cart, user, toast } = useStore();
  const nav = useNavigate();
  const loc = useLocation() as { state?: { selections?: Selections; editKey?: string } };
  const product = menu?.products.find((p) => p.id === productId);
  const editing = loc.state?.editKey ? cart.find((l) => l.key === loc.state!.editKey) : undefined;

  const [sel, setSel] = useState<Selections>({});
  const [qty, setQty] = useState(1);
  const [saveOpen, setSaveOpen] = useState(false);
  const [favName, setFavName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!product) return;
    setSel(editing?.selections ?? loc.state?.selections ?? defaults(product));
    setQty(editing?.quantity ?? 1);
    setFavName(product.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product?.id]);

  const unit = useMemo(() => (product ? unitPrice(product, sel) : 0), [product, sel]);
  if (!menu) return <Spinner />;
  if (!product) return <div className="page"><Notice tone="error">This item isn't on the menu at {menu.location.name}.</Notice></div>;

  const missing = product.groups.filter((g) => g.kind !== "quantity" && Object.keys(sel[g.id] ?? {}).length < g.min_select);

  const setSingle = (g: Group, oid: string) => setSel((s) => ({ ...s, [g.id]: { [oid]: 1 } }));
  const clearGroup = (g: Group) => setSel((s) => { const n = { ...s }; delete n[g.id]; return n; });
  const toggleMulti = (g: Group, oid: string) =>
    setSel((s) => {
      const cur = { ...(s[g.id] ?? {}) };
      if (cur[oid]) delete cur[oid];
      else if (Object.keys(cur).length < g.max_select) cur[oid] = 1;
      else return s;
      return { ...s, [g.id]: cur };
    });
  const setQtyOpt = (g: Group, oid: string, v: number) =>
    setSel((s) => {
      const cur = { ...(s[g.id] ?? {}) };
      if (v <= 0) delete cur[oid];
      else cur[oid] = v;
      return { ...s, [g.id]: cur };
    });

  const submit = () => {
    if (editing) {
      updateLine(editing.key, { selections: sel, quantity: qty });
      toast("Item updated", "success");
      nav("/bag");
    } else {
      addToCart(product.id, sel, qty);
      toast(`${product.name} added to your bag`, "success");
      nav("/menu");
    }
  };

  const saveFavorite = async () => {
    setSaving(true);
    try {
      await api("/favorites", { body: { name: favName.trim() || product.name, productId: product.id, selections: sel } });
      toast("Saved to your drinks", "success");
      setSaveOpen(false);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page product-page">
      <div className="product-hero">
        <button className="icon-btn floating" aria-label="Back" onClick={() => nav(-1)}><Icon name="back" /></button>
        {user ? (
          <button className="icon-btn floating right" aria-label="Save this drink" onClick={() => setSaveOpen(true)}><Icon name="heart" /></button>
        ) : null}
        <ProductArt art={product.art} size={220} rounded={false} />
      </div>
      <div className="product-body">
        <h1>{product.name}</h1>
        <p className="muted">{product.description}</p>
        <div className="product-facts">
          <span className="price">{money(product.price_cents)}</span>
          {product.calories !== null ? <span>{product.calories} cal (standard)</span> : null}
        </div>
        {product.allergens ? <p className="small muted">Contains: {product.allergens}. Made in a kitchen that handles common allergens — ask a barista if you have an allergy.</p> : null}
        {product.sold_out ? <Notice tone="warn">Sold out at {menu.location.name} right now.</Notice> : null}

        {product.groups.map((g) => {
          const chosen = sel[g.id] ?? {};
          const total = Object.values(chosen).reduce((a, b) => a + b, 0);
          return (
            <fieldset key={g.id} className="mod-group">
              <legend>
                <span>{g.name}</span>
                <span className={`mod-hint${g.min_select && !Object.keys(chosen).length ? " need" : ""}`}>{groupHint(g)}</span>
              </legend>
              {g.kind === "quantity"
                ? g.options.map((o) => (
                    <div key={o.id} className="mod-row">
                      <div>
                        <div>{o.name}</div>
                        <div className="small muted">{o.price_delta_cents ? `+${money(o.price_delta_cents)} each` : "No charge"}</div>
                      </div>
                      <Stepper label={o.name} value={chosen[o.id] ?? 0} max={(chosen[o.id] ?? 0) + (g.max_quantity - total)} onChange={(v) => setQtyOpt(g, o.id, v)} />
                    </div>
                  ))
                : g.options.map((o) => {
                    const on = !!chosen[o.id];
                    const isRadio = g.kind === "single";
                    return (
                      <label key={o.id} className={`mod-option${on ? " on" : ""}`}>
                        <input
                          type={isRadio ? "radio" : "checkbox"}
                          name={g.id}
                          aria-label={`${o.name}${o.price_delta_cents ? `, plus ${money(o.price_delta_cents)}` : ""}`}
                          checked={on}
                          onChange={() => (isRadio ? setSingle(g, o.id) : toggleMulti(g, o.id))}
                          onClick={() => isRadio && on && g.min_select === 0 && clearGroup(g)}
                        />
                        <span className="mod-option-name">{o.name}</span>
                        <span className="mod-option-price">{o.price_delta_cents ? `+${money(o.price_delta_cents)}` : ""}</span>
                      </label>
                    );
                  })}
            </fieldset>
          );
        })}
      </div>
      <div className="sticky-cta">
        <Stepper label="items" value={qty} min={1} max={10} onChange={setQty} />
        <Button full variant="primary" disabled={product.sold_out || missing.length > 0} onClick={submit}>
          {missing.length ? `Choose ${missing[0].name.toLowerCase()}` : `${editing ? "Update" : "Add to bag"} · ${money(unit * qty)}`}
        </Button>
      </div>

      <Sheet open={saveOpen} onClose={() => setSaveOpen(false)} title="Save this drink">
        <p className="muted small">Save your exact choices so you can reorder in one tap. We'll re-check price and availability each time.</p>
        <label className="field">
          <span>Name</span>
          <input value={favName} maxLength={40} onChange={(e) => setFavName(e.target.value)} />
        </label>
        <Button full busy={saving} onClick={saveFavorite}>Save</Button>
      </Sheet>
    </div>
  );
}
