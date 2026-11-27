import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { io } from "socket.io-client";
import { api, getCsrf } from "./api";
import { socketTransportOptions } from "./realtime-options";

const StoreContext = createContext(null);
// A pending account draft is written during the click handler, before React
// renders or a request starts. It survives a reload during the sync debounce.
const cleanCart = (saved) => {
  if (!Array.isArray(saved)) return [];
  const seen = new Set();
  return saved
    .filter((item) => {
      if (
        !item ||
        !Number.isInteger(item.id) ||
        item.id < 1 ||
        !Number.isInteger(item.quantity) ||
        item.quantity < 1 ||
        item.quantity > 10000 ||
        seen.has(item.id)
      )
        return false;
      seen.add(item.id);
      return true;
    })
    .slice(0, 100)
    .map(({ id, quantity }) => ({ id, quantity }));
};
const readAccountCart = (owner) => {
  try {
    const saved = JSON.parse(
      localStorage.getItem(`mm-cart:${owner}`) || "null",
    );
    if (
      !saved ||
      !Array.isArray(saved.items) ||
      typeof saved.version !== "string"
    )
      return null;
    return {
      items: cleanCart(saved.items),
      version: saved.version,
      pending: saved.pending === true,
    };
  } catch {
    return null;
  }
};
const cartDraft = (items, pending = true) => ({
  items: cleanCart(items),
  pending,
  version: crypto.randomUUID(),
});
const saveLocalCart = (owner, draft) => {
  try {
    localStorage.setItem(`mm-cart:${owner}`, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
};
const removeGuestCart = () => {
  try {
    localStorage.removeItem("mm-cart:guest");
  } catch {
    /* Storage can be disabled. */
  }
};
export function StoreProvider({ children }) {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [settings, setSettings] = useState({});
  const [categories, setCategories] = useState([]);
  const [config, setConfig] = useState({
    payment: { mode: "disabled" },
    maps: { enabled: false },
    location: { enabled: false, provider: "disabled" },
  });
  const [connectionError, setConnectionError] = useState("");
  const [cart, setCart] = useState([]);
  const [authPrompt, setAuthPrompt] = useState(null);
  const [cartReady, setCartReady] = useState(false);
  const [toast, setToast] = useState(null);
  const [revision, setRevision] = useState(0);
  const [liveConnected, setLiveConnected] = useState(false);
  const toastTimer = useRef();
  const cartOwner = useRef(null);
  const cartItems = useRef(cart);
  const cartSession = useRef(null);
  const notify = useCallback((message, type = "success") => {
    clearTimeout(toastTimer.current);
    setToast({ message, type });
    toastTimer.current = setTimeout(() => setToast(null), 5500);
  }, []);
  const loadPublic = useCallback(async () => {
    try {
      const [cms, cats, caps] = await Promise.all([
        api("/settings"),
        api("/categories"),
        api("/config"),
      ]);
      setSettings(cms);
      setCategories(cats);
      setConfig(caps);
      setConnectionError("");
    } catch (error) {
      setConnectionError(error.message);
    }
  }, []);
  useEffect(() => {
    // Guest baskets from older versions are deliberately retired. Shopping
    // state belongs to a signed-in customer; public browsing remains open.
    removeGuestCart();
    loadPublic();
    api("/me")
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setAuthLoading(false));
    return () => clearTimeout(toastTimer.current);
  }, [loadPublic]);
  const syncCart = useCallback(async () => {
    const session = cartSession.current;
    if (!session?.active || session.owner === "guest" || session.syncing)
      return;
    session.syncing = true;
    try {
      // Serialize writes. If another click changes the draft while a request is
      // in flight, send that newer draft next and never acknowledge it early.
      while (session.active && session.draft?.pending) {
        const sent = session.draft;
        await api("/cart", {
          method: "PUT",
          body: { items: sent.items },
          signal: session.controller.signal,
        });
        if (!session.active) break;
        if (session.draft.version === sent.version) {
          session.draft = { ...sent, pending: false };
          const stored = readAccountCart(session.owner);
          if (!stored || stored.version === sent.version)
            saveLocalCart(session.owner, session.draft);
        }
      }
    } catch (error) {
      if (session.active && error.name !== "AbortError")
        notify(
          `Basket is saved on this browser but could not sync: ${error.message}`,
          "error",
        );
    } finally {
      session.syncing = false;
    }
  }, [notify]);
  useEffect(() => {
    if (authLoading) return;
    let alive = true;
    const owner = user?.role === "customer" ? `user:${user.id}` : "guest";
    const session = {
      owner,
      active: true,
      syncing: false,
      controller: new AbortController(),
      draft: null,
    };
    cartSession.current = session;
    cartOwner.current = null;
    setCartReady(false);
    const ready = (draft) => {
      if (!alive) return;
      session.draft = draft;
      cartOwner.current = owner;
      cartItems.current = draft.items;
      setCart(draft.items);
      setCartReady(true);
    };
    if (user?.role === "customer") {
      const hydrate = (remote, failed = false) => {
        if (!alive) return;
        const local = readAccountCart(owner);
        // A pending empty array is intentional: it represents remove/clear.
        // Never merge remote items back over a pending local removal.
        const draft = local?.pending
          ? local
          : cartDraft(failed ? local?.items || [] : remote, false);
        saveLocalCart(owner, draft);
        ready(draft);
      };
      api("/cart", { signal: session.controller.signal })
        .then((data) => hydrate(cleanCart(data.items)))
        .catch((error) => {
          if (!alive || error.name === "AbortError") return;
          hydrate([], true);
          notify(`Could not refresh your basket. ${error.message}`, "error");
        });
    } else {
      removeGuestCart();
      ready(cartDraft([], false));
    }
    return () => {
      alive = false;
      session.active = false;
      session.controller.abort();
    };
  }, [user?.id, user?.role, authLoading, notify]);
  useEffect(() => {
    if (
      !cartReady ||
      cartOwner.current !==
        (user?.role === "customer" ? `user:${user.id}` : "guest")
    )
      return;
    const timer = setTimeout(syncCart, 150);
    return () => clearTimeout(timer);
  }, [cart, cartReady, user?.id, user?.role, syncCart]);
  useEffect(() => {
    window.addEventListener("online", syncCart);
    return () => window.removeEventListener("online", syncCart);
  }, [syncCart]);
  useEffect(() => {
    let socket;
    let cancelled = false;
    getCsrf()
      .then((csrfToken) => {
        if (cancelled) return;
        socket = io({
          auth: { csrfToken },
          ...socketTransportOptions(import.meta.env.VITE_DEPLOY_TARGET),
        });
        socket.on("connect", () => {
          setLiveConnected(true);
          // Events may be missed while offline. Always re-fetch on reconnect.
          setRevision((value) => value + 1);
          loadPublic();
        });
        socket.on("disconnect", (reason) => {
          setLiveConnected(false);
          if (reason === "io server disconnect")
            api("/me")
              .then(setUser)
              .catch((error) => {
                if (error.status === 401) setUser(null);
              });
        });
        socket.on("connect_error", (error) => {
          setLiveConnected(false);
          if (/authentication/i.test(error.message))
            api("/me")
              .then(setUser)
              .catch((err) => {
                if (err.status === 401) setUser(null);
              });
        });
        socket.on("catalogue", () => {
          setRevision((v) => v + 1);
          loadPublic();
        });
        socket.on("settings", () => {
          setRevision((v) => v + 1);
          loadPublic();
        });
        for (const event of [
          "order:updated",
          "lead:updated",
          "notification:updated",
          "service:status",
          "customer:updated",
          "address:updated",
          "inbox:updated",
          "inapp:notification",
        ])
          socket.on(event, () => setRevision((v) => v + 1));
        socket.on("staff:updated", () => {
          setRevision((v) => v + 1);
          api("/me")
            .then(setUser)
            .catch(() => setUser(null));
        });
      })
      .catch(() => setLiveConnected(false));
    return () => {
      cancelled = true;
      socket?.disconnect();
    };
  }, [user?.id, user?.role, loadPublic]);
  useEffect(() => {
    let lastRefresh = 0;
    const resync = () => {
      if (
        document.visibilityState === "hidden" ||
        Date.now() - lastRefresh < 1000
      )
        return;
      lastRefresh = Date.now();
      setRevision((value) => value + 1);
      loadPublic();
      if (user)
        api("/me")
          .then(setUser)
          .catch((error) => {
            if (error.status === 401) setUser(null);
          });
    };
    // Bounded polling also keeps stock current when a socket cannot connect.
    const timer = setInterval(resync, 20000);
    window.addEventListener("focus", resync);
    window.addEventListener("online", resync);
    document.addEventListener("visibilitychange", resync);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", resync);
      window.removeEventListener("online", resync);
      document.removeEventListener("visibilitychange", resync);
    };
  }, [loadPublic, user?.id]);
  useEffect(() => {
    const expired = () => {
      setUser(null);
      notify("Your session has ended. Please sign in again.", "error");
    };
    window.addEventListener("mm:session-expired", expired);
    return () => window.removeEventListener("mm:session-expired", expired);
  }, [notify]);
  useEffect(() => {
    const storeName = settings.storeName || "Virar Organics";
    document.title = `${storeName} · Good food, rooted in nature`;
    const description = document.querySelector('meta[name="description"]');
    if (description)
      description.content = `${storeName} — thoughtfully sourced organic pantry staples and fresh harvests for homes in Virar.`;
  }, [settings.storeName]);
  useEffect(() => {
    const link = document.querySelector('link[rel="icon"]');
    if (link) {
      link.href = settings.favicon || "/assets/favicon.svg";
      if (settings.favicon) link.removeAttribute("type");
      else link.setAttribute("type", "image/svg+xml");
    }
  }, [settings.favicon]);
  const login = async (values) => {
    const profile = await api("/login", { method: "POST", body: values });
    await getCsrf(true);
    setUser(profile.user || profile);
    return profile.user || profile;
  };
  const logout = async () => {
    try {
      await api("/logout", { method: "POST", body: {} });
      setUser(null);
      // Account drafts remain under their own user ID for the next sign-in.
      // They are never copied into the anonymous basket or another account.
      cartItems.current = [];
      setCart([]);
      removeGuestCart();
      return true;
    } catch (error) {
      notify(`Sign out could not complete. ${error.message}`, "error");
      return false;
    }
  };
  const changeCart = (items) => {
    if (user?.role !== "customer") return false;
    const owner = `user:${user.id}`;
    const session = cartSession.current;
    if (!cartReady || !session?.active || cartOwner.current !== owner) {
      notify(
        "Your basket is still loading. Please try again in a moment.",
        "error",
      );
      return false;
    }
    const draft = cartDraft(items, owner !== "guest");
    // Persist synchronously, including empty baskets and removals. Saving only
    // in an effect/debounce leaves a gap when the page immediately reloads.
    session.draft = draft;
    const stored = saveLocalCart(owner, draft);
    cartItems.current = draft.items;
    setCart(draft.items);
    if (!stored) {
      notify(
        "Browser storage is unavailable. Keep this page open while your basket syncs.",
        "error",
      );
      void syncCart();
    }
    return true;
  };
  const clearCart = () => {
    if (user?.role !== "customer") return;
    const owner = `user:${user.id}`;
    const draft = cartDraft([]);
    saveLocalCart(owner, draft);
    const session = cartSession.current;
    if (session?.active && session.owner === owner) session.draft = draft;
    cartItems.current = [];
    setCart([]);
  };
  const addToCart = (product, quantity = 1) => {
    if (!user) {
      setAuthPrompt({
        from: `/products/${product.id}`,
        productName: product.name,
      });
      return;
    }
    if (user.role !== "customer") {
      notify("Use a customer account to place an order.", "error");
      return;
    }
    if (
      product.active === false ||
      product.available === false ||
      Number(product.stock) <= 0
    ) {
      notify(
        "This product is currently unavailable. Please choose another item.",
        "error",
      );
      return;
    }
    const items = cartItems.current;
    const existing = items.find((item) => item.id === Number(product.id));
    const nextQuantity = (existing?.quantity || 0) + quantity;
    if (nextQuantity > product.stock) {
      notify(
        `Only ${product.stock} ${product.unit || "units"} available.`,
        "error",
      );
      return;
    }
    const next = existing
      ? items.map((item) =>
          item.id === Number(product.id)
            ? { ...item, quantity: nextQuantity }
            : item,
        )
      : [...items, { id: Number(product.id), quantity }];
    if (changeCart(next)) notify(`${product.name} added to your basket.`);
  };
  const updateQuantity = (id, quantity) =>
    changeCart(
      quantity <= 0
        ? cartItems.current.filter((item) => item.id !== Number(id))
        : cartItems.current.map((item) =>
            item.id === Number(id)
              ? { ...item, quantity: Math.floor(quantity) }
              : item,
          ),
    );
  return (
    <StoreContext.Provider
      value={{
        user,
        setUser,
        authLoading,
        login,
        logout,
        settings,
        categories,
        config,
        connectionError,
        loadPublic,
        cart: user?.role === "customer" ? cart : [],
        authPrompt,
        setAuthPrompt,
        cartReady:
          !authLoading &&
          cartReady &&
          cartOwner.current ===
            (user?.role === "customer" ? `user:${user.id}` : "guest"),
        addToCart,
        updateQuantity,
        clearCart,
        cartCount:
          user?.role === "customer"
            ? cart.reduce((sum, item) => sum + item.quantity, 0)
            : 0,
        toast,
        setToast,
        notify,
        revision,
        refresh: () => setRevision((v) => v + 1),
        liveConnected,
      }}
    >
      {children}
    </StoreContext.Provider>
  );
}
export const useStore = () => useContext(StoreContext);
