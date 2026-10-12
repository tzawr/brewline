import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, uid } from "./api";
import type { CartLine, Menu, Selections, User } from "./types";

interface Config {
  demoMode: boolean;
  payments: { demo: boolean; stripe: boolean };
  rewards: { thresholdCents: number; rewardCents: number };
}

interface Toast { id: number; text: string; tone: "info" | "error" | "success" }

interface Store {
  config: Config | null;
  user: User | null;
  userLoaded: boolean;
  setUser: (u: User | null) => void;
  refreshUser: () => Promise<void>;
  locationId: string;
  setLocationId: (id: string) => void;
  menu: Menu | null;
  menuStale: boolean;
  menuError: string | null;
  reloadMenu: () => Promise<void>;
  cart: CartLine[];
  addToCart: (productId: string, selections: Selections, quantity: number) => void;
  updateLine: (key: string, patch: Partial<CartLine>) => void;
  removeLine: (key: string) => void;
  clearCart: () => void;
  replaceCart: (lines: CartLine[]) => void;
  cartCount: number;
  toast: (text: string, tone?: Toast["tone"]) => void;
  toasts: Toast[];
  online: boolean;
}

const Ctx = createContext<Store>(null as unknown as Store);
export const useStore = () => useContext(Ctx);

function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<Config | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [userLoaded, setUserLoaded] = useState(false);
  const [locationId, setLocationIdState] = useState<string>(() => load("bl.location", "promenade"));
  const [menu, setMenu] = useState<Menu | null>(() => load<Menu | null>(`bl.menu.${load("bl.location", "promenade")}`, null));
  const [menuStale, setMenuStale] = useState(true);
  const [menuError, setMenuError] = useState<string | null>(null);
  const [cart, setCart] = useState<CartLine[]>(() => load("bl.cart", []));
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const toastId = useRef(0);

  const toast = useCallback((text: string, tone: Toast["tone"] = "info") => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3800);
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const r = await api<{ user: User | null }>("/me");
      setUser(r.user);
    } catch {
      /* offline: keep current */
    } finally {
      setUserLoaded(true);
    }
  }, []);

  const reloadMenu = useCallback(async () => {
    try {
      const m = await api<Menu>(`/locations/${locationId}/menu`);
      setMenu(m);
      setMenuStale(false);
      setMenuError(null);
      save(`bl.menu.${locationId}`, m);
    } catch (e) {
      setMenuStale(true);
      setMenuError((e as Error).message);
    }
  }, [locationId]);

  useEffect(() => {
    api<Config>("/config").then(setConfig).catch(() => null);
    refreshUser();
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, [refreshUser]);

  useEffect(() => {
    setMenu((m) => (m?.location.id === locationId ? m : load<Menu | null>(`bl.menu.${locationId}`, null)));
    reloadMenu();
    const t = setInterval(reloadMenu, 60_000);
    const vis = () => document.visibilityState === "visible" && reloadMenu();
    document.addEventListener("visibilitychange", vis);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", vis);
    };
  }, [locationId, reloadMenu]);

  useEffect(() => {
    save("bl.cart", cart);
  }, [cart]);

  const setLocationId = useCallback((id: string) => {
    setLocationIdState(id);
    save("bl.location", id);
  }, []);

  const value = useMemo<Store>(
    () => ({
      config,
      user,
      userLoaded,
      setUser,
      refreshUser,
      locationId,
      setLocationId,
      menu,
      menuStale,
      menuError,
      reloadMenu,
      cart,
      addToCart: (productId, selections, quantity) =>
        setCart((c) => {
          const same = c.find((l) => l.productId === productId && JSON.stringify(l.selections) === JSON.stringify(selections));
          if (same) return c.map((l) => (l === same ? { ...l, quantity: Math.min(10, l.quantity + quantity) } : l));
          return [...c, { key: uid(), productId, selections, quantity }];
        }),
      updateLine: (key, patch) => setCart((c) => c.map((l) => (l.key === key ? { ...l, ...patch } : l))),
      removeLine: (key) => setCart((c) => c.filter((l) => l.key !== key)),
      clearCart: () => setCart([]),
      replaceCart: (lines) => setCart(lines),
      cartCount: cart.reduce((s, l) => s + l.quantity, 0),
      toast,
      toasts,
      online,
    }),
    [config, user, userLoaded, refreshUser, locationId, setLocationId, menu, menuStale, menuError, reloadMenu, cart, toast, toasts, online],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
