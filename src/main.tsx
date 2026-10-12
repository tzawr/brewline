import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { StoreProvider, useStore } from "./store";
import { surface } from "./api";
import { CustomerShell } from "./components/Shell";
import { Home } from "./pages/Home";
import { MenuPage } from "./pages/Menu";
import { ProductPage } from "./pages/Product";
import { BagPage } from "./pages/Bag";
import { OrderPage } from "./pages/Order";
import { RewardsPage } from "./pages/Rewards";
import { ActivityPage } from "./pages/Activity";
import { AccountPage, SavedPage } from "./pages/Account";
import { AuthPage } from "./pages/Auth";
import { HelpPage } from "./pages/Help";
import { LocationsPage } from "./pages/Locations";
import { StaffGate } from "./staff/StaffGate";
import { BaristaPage } from "./staff/Barista";
import { ManagerPage } from "./staff/Manager";
import { Toasts } from "./components/ui";
import "./styles.css";

/** Reloads the signed-in user when moving between the customer app and staff screens. */
function SurfaceWatcher() {
  const loc = useLocation();
  const { refreshUser } = useStore();
  const last = useRef(surface());
  useEffect(() => {
    const now = surface();
    if (now !== last.current) {
      last.current = now;
      refreshUser();
    }
  }, [loc.pathname, refreshUser]);
  return null;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StoreProvider>
      <BrowserRouter>
        <SurfaceWatcher />
        <Routes>
          <Route path="/barista" element={<StaffGate role="barista"><BaristaPage /></StaffGate>} />
          <Route path="/manager/*" element={<StaffGate role="manager"><ManagerPage /></StaffGate>} />
          <Route element={<CustomerShell />}>
            <Route index element={<Home />} />
            <Route path="menu" element={<MenuPage />} />
            <Route path="menu/:productId" element={<ProductPage />} />
            <Route path="bag" element={<BagPage />} />
            <Route path="order/:id" element={<OrderPage />} />
            <Route path="rewards" element={<RewardsPage />} />
            <Route path="activity" element={<ActivityPage />} />
            <Route path="account" element={<AccountPage />} />
            <Route path="account/saved" element={<SavedPage />} />
            <Route path="signin" element={<AuthPage />} />
            <Route path="help" element={<HelpPage />} />
            <Route path="locations" element={<LocationsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
        <Toasts />
      </BrowserRouter>
    </StoreProvider>
  </StrictMode>,
);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => null));
}
