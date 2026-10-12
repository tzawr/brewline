import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useStore } from "../store";
import type { Favorite } from "../types";
import { modifierText } from "../format";
import { ProductArt } from "../components/ProductArt";
import { Button, Empty, Icon, PageHeader, Sheet, Spinner } from "../components/ui";

export function AccountPage() {
  const { user, setUser, toast, config, userLoaded } = useStore();
  const nav = useNavigate();
  const [pwOpen, setPwOpen] = useState(false);
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);

  if (!userLoaded) return <Spinner />;

  const signOut = async () => {
    await api("/auth/logout", { body: {} }).catch(() => null);
    setUser(null);
    toast("Signed out");
    nav("/");
  };

  const demo = (role: "barista" | "manager") => window.open(`/${role}`, "_blank", "noopener");

  const changePassword = async () => {
    setBusy(true);
    try {
      await api("/me/password", { body: { current: cur, next } });
      toast("Password updated", "success");
      setPwOpen(false);
      setCur("");
      setNext("");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const toggleMarketing = async () => {
    try {
      const r = await api("/me", { method: "PATCH", body: { marketingOptIn: !user!.marketingOptIn } });
      setUser(r.user);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const deleteAccount = async () => {
    if (!window.confirm("Delete your account? Your rewards will be forfeited. Receipts are kept anonymously for accounting.")) return;
    try {
      await api("/me", { method: "DELETE" });
      setUser(null);
      toast("Your account has been deleted");
      nav("/");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  return (
    <div className="page">
      <PageHeader title="Account" />
      {user ? (
        <>
          <div className="card profile">
            <div className="avatar" aria-hidden="true">{user.name[0]?.toUpperCase()}</div>
            <div>
              <div className="strong">{user.name}</div>
              <div className="small muted">{user.email}</div>
            </div>
          </div>
          <ul className="menu-list">
            <li><Link to="/account/saved"><Icon name="heart" /> Saved drinks <Icon name="chevron" size={18} /></Link></li>
            <li><Link to="/activity"><Icon name="receipt" /> Orders & receipts <Icon name="chevron" size={18} /></Link></li>
            <li><Link to="/rewards"><Icon name="star" /> Rewards <Icon name="chevron" size={18} /></Link></li>
            <li><Link to="/locations"><Icon name="pin" /> Cafés & hours <Icon name="chevron" size={18} /></Link></li>
            <li><Link to="/help"><Icon name="help" /> Help & support <Icon name="chevron" size={18} /></Link></li>
            {user.role !== "customer" ? <li><Link to={`/${user.role}`}><Icon name="cup" /> Open {user.role} view <Icon name="chevron" size={18} /></Link></li> : null}
          </ul>
          <section className="card">
            <h2>Privacy & security</h2>
            <label className="toggle-row">
              <div>
                <div className="strong">Offers by email</div>
                <div className="small muted">Optional. Order updates don't depend on this.</div>
              </div>
              <input type="checkbox" role="switch" checked={user.marketingOptIn} onChange={toggleMarketing} />
            </label>
            <div className="stack">
              <Button variant="secondary" full onClick={() => setPwOpen(true)}>Change password</Button>
              <Button variant="ghost" full onClick={signOut}><Icon name="logout" size={18} /> Sign out</Button>
              {user.role === "customer" ? <button className="link danger small" onClick={deleteAccount}>Delete my account</button> : null}
            </div>
          </section>
        </>
      ) : (
        <div className="card">
          <h2>Sign in for faster ordering</h2>
          <p className="muted">Save drinks, track orders live, keep receipts and earn rewards.</p>
          <div className="stack">
            <Button full onClick={() => nav("/signin?mode=signup")}>Create an account</Button>
            <Button full variant="secondary" onClick={() => nav("/signin")}>Sign in</Button>
          </div>
        </div>
      )}

      {config?.demoMode ? (
        <section className="card demo-card">
          <h2>Portfolio demo</h2>
          <p className="small muted">Jump into the staff side to see orders arrive and move through the café.</p>
          <div className="stack">
            <Button variant="secondary" full onClick={() => demo("barista")}>Open barista display</Button>
            <Button variant="secondary" full onClick={() => demo("manager")}>Open manager console</Button>
          </div>
        </section>
      ) : null}
      <p className="center tiny muted">Brewline v1.0 · Built on Cloudflare</p>

      <Sheet open={pwOpen} onClose={() => setPwOpen(false)} title="Change password">
        <label className="field"><span>Current password</span><input type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} /></label>
        <label className="field"><span>New password</span><input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} minLength={8} /></label>
        <Button full busy={busy} onClick={changePassword}>Update password</Button>
      </Sheet>
    </div>
  );
}

export function SavedPage() {
  const { user, menu, addToCart, toast } = useStore();
  const nav = useNavigate();
  const [favs, setFavs] = useState<Favorite[] | null>(null);
  useEffect(() => {
    if (user) api<{ favorites: Favorite[] }>("/favorites").then((r) => setFavs(r.favorites)).catch(() => setFavs([]));
  }, [user]);

  if (!user) return <div className="page"><PageHeader title="Saved drinks" back /><Button onClick={() => nav("/signin?next=/account/saved")}>Sign in</Button></div>;
  if (!favs) return <Spinner />;
  const products = new Map(menu?.products.map((p) => [p.id, p]) ?? []);

  const remove = async (id: string) => {
    await api(`/favorites/${id}`, { method: "DELETE" }).catch(() => null);
    setFavs((f) => f?.filter((x) => x.id !== id) ?? null);
  };

  return (
    <div className="page">
      <PageHeader title="Saved drinks" back />
      {favs.length === 0 ? (
        <Empty icon="heart" title="No saved drinks yet" body="Customize a drink and tap the heart to save it here for one-tap reordering." action={<Button onClick={() => nav("/menu")}>Browse the menu</Button>} />
      ) : (
        <ul className="stack">
          {favs.map((f) => {
            const p = products.get(f.productId);
            const desc = p
              ? modifierText(
                  p.groups.flatMap((g) => g.options.filter((o) => f.selections[g.id]?.[o.id]).map((o) => ({ group: g.name, option: o.name, quantity: f.selections[g.id][o.id] }))),
                )
              : "";
            return (
              <li key={f.id} className="saved-row">
                <ProductArt art={p?.art ?? "latte"} size={60} />
                <div className="grow">
                  <div className="strong">{f.name}</div>
                  <div className="small muted">{p?.name}{desc ? ` · ${desc}` : ""}</div>
                  <div className="row gap">
                    <button className="link" disabled={!p || p.sold_out} onClick={() => { addToCart(f.productId, f.selections, 1); toast(`${f.name} added`, "success"); }}>
                      {p?.sold_out ? "Sold out" : "Add to bag"}
                    </button>
                    {p ? <button className="link" onClick={() => nav(`/menu/${p.id}`, { state: { selections: f.selections } })}>Customize</button> : null}
                    <button className="link danger" onClick={() => remove(f.id)}>Remove</button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
