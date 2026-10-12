import { useEffect, useRef } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { useStore } from "../store";
import { Icon } from "./ui";

const TABS = [
  { to: "/", label: "Home", icon: "home" },
  { to: "/menu", label: "Order", icon: "cup" },
  { to: "/rewards", label: "Rewards", icon: "star" },
  { to: "/activity", label: "Activity", icon: "receipt" },
  { to: "/account", label: "Account", icon: "user" },
];

export function CustomerShell() {
  const { cartCount, online } = useStore();
  const loc = useLocation();
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [loc.pathname]);
  const hideBagBar = loc.pathname === "/bag" || loc.pathname.startsWith("/menu/") || loc.pathname.startsWith("/order/") || loc.pathname === "/signin";

  return (
    <div className="showcase">
      <aside className="showcase-intro">
        <div className="brand-mark big">Brewline</div>
        <h2>Mobile ordering a café can actually keep up with.</h2>
        <p>
          A working customer app, barista display and manager console built from my product proposal for a corporate café
          app: clear rewards, recoverable checkout, honest order status and capacity-aware pickup times.
        </p>
        <ul className="showcase-list">
          <li><strong>Try the app</strong> on the right — create an account and place an order with the demo card.</li>
          <li><Link to="/barista" target="_blank">Open the barista display</Link> in another tab and watch your order arrive.</li>
          <li><Link to="/manager" target="_blank">Open the manager console</Link> for menu, sold-out, refunds and reports.</li>
        </ul>
        <p className="muted small">Cloudflare Workers · D1 · React · TypeScript · Stripe-ready</p>
      </aside>
      <div className="device">
        <div className="app">
          {!online ? (
            <div className="offline-bar"><Icon name="wifi-off" size={16} /> You're offline — browsing the saved menu. Ordering needs a connection.</div>
          ) : null}
          <div className="app-scroll" ref={scroller}>
            <Outlet />
          </div>
          {cartCount > 0 && !hideBagBar ? (
            <Link to="/bag" className="bag-bar">
              <span className="bag-bar-count">{cartCount}</span>
              <span>Review order</span>
              <Icon name="bag" size={20} />
            </Link>
          ) : null}
          <nav className="tabbar" aria-label="Main">
            {TABS.map((t) => (
              <NavLink key={t.to} to={t.to} end={t.to === "/"} className={({ isActive }) => `tab${isActive ? " active" : ""}`}>
                <Icon name={t.icon} />
                <span>{t.label}</span>
              </NavLink>
            ))}
          </nav>
        </div>
      </div>
    </div>
  );
}
