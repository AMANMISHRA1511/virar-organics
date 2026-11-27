import React, { useEffect, useId, useRef, useState } from "react";
import {
  Link,
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
} from "react-router-dom";
import {
  ArrowDownToLine,
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  Leaf,
  LoaderCircle,
  MapPin,
  Menu,
  Minus,
  Package,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  ShoppingBag,
  Sprout,
  Upload,
  UserRound,
  X,
} from "lucide-react";
import { dateTime, imagesOf, money, priceOf, uploadImages } from "./api";
import { useStore } from "./context";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { NotificationBell } from "./notification-feed";

export function Brand({ light = false, small = false }) {
  const { settings } = useStore();
  return (
    <Link
      to="/"
      className={`brand ${light ? "brand-light" : ""} ${small ? "brand-small" : ""}`}
      aria-label={`${settings.storeName || "Virar Organics"} home`}
    >
      {settings.logo ? (
        <img src={settings.logo} alt="" className="brand-logo" />
      ) : (
        <span className="brand-mark">
          <Sprout strokeWidth={1.5} />
        </span>
      )}
      <span className="brand-type">
        {settings.storeName || "Virar Organics"}
        <span className="brand-caption">ROOTED IN GOODNESS</span>
      </span>
    </Link>
  );
}
export function StoreLayout() {
  const {
    user,
    cartCount,
    settings,
    toast,
    setToast,
    connectionError,
    loadPublic,
    logout,
    authPrompt,
    setAuthPrompt,
  } = useStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    setMenuOpen(false);
    window.scrollTo({ top: 0 });
  }, [location.pathname]);
  const doLogout = async () => {
    await logout();
    navigate("/");
  };
  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <div className="announcement">
        <Leaf size={13} />
        <span>
          {settings.promotion ??
            "A little closer to the earth. A little better for your everyday."}
        </span>
        <span className="announcement-place">
          <MapPin size={13} /> Virar, Mumbai
        </span>
      </div>
      <header className="store-header">
        <div className="header-inner">
          <Brand />
          <nav
            aria-label="Main navigation"
            className={menuOpen ? "main-nav open" : "main-nav"}
          >
            <NavLink to="/shop">Shop all</NavLink>
            <NavLink to="/about">Our story</NavLink>
            <NavLink to="/bulk">Bulk orders</NavLink>
            <NavLink to="/contact">Visit & contact</NavLink>
          </nav>
          <div className="header-actions">
            <NotificationBell />
            <Link
              className="icon-button account-link"
              to={
                user?.role === "admin" || user?.role === "sales"
                  ? "/admin"
                  : user
                    ? "/account"
                    : "/login"
              }
              aria-label={user ? "My account" : "Sign in"}
            >
              <UserRound size={21} />
              <span>{user ? user.name.split(" ")[0] : "Sign in"}</span>
            </Link>
            <Link
              className="basket-link"
              to="/cart"
              aria-label={`Basket with ${cartCount} items`}
            >
              <ShoppingBag size={21} />
              <span className="basket-count">{cartCount}</span>
            </Link>
            <button
              type="button"
              className="icon-button menu-toggle"
              aria-label="Toggle menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(!menuOpen)}
            >
              {menuOpen ? <X /> : <Menu />}
            </button>
          </div>
        </div>
      </header>
      {connectionError && (
        <div className="connection-banner" role="alert">
          <CircleAlert size={17} />
          <span>We could not connect to the store. {connectionError}</span>
          <button onClick={loadPublic} className="link-button">
            Retry
          </button>
        </div>
      )}
      <main id="main-content">
        <Outlet />
      </main>
      <footer className="store-footer">
        <div className="footer-grid">
          <div className="footer-brand">
            <Brand light />
            <p>
              {settings.footer ??
                "Thoughtful food for everyday living. Pantry staples and seasonal favourites, from our store to your home."}
            </p>
            <span className="footer-small">
              A fictional organic store · Local development project
            </span>
          </div>
          <div>
            <h3>Make yourself at home</h3>
            <Link to="/shop">Shop the collection</Link>
            <Link to="/about">Our story</Link>
            <Link to="/bulk">Buy in bulk</Link>
            <Link to="/account/orders">Track an order</Link>
          </div>
          <div>
            <h3>Come say hello</h3>
            <p>{settings.address ?? "Virar West, Mumbai, Maharashtra"}</p>
            {settings.contactEmail && (
              <a href={`mailto:${settings.contactEmail}`}>
                {settings.contactEmail}
              </a>
            )}
            {settings.contactPhone && (
              <a href={`tel:${settings.contactPhone}`}>
                {settings.contactPhone}
              </a>
            )}
            <p>{settings.openingHours ?? "Monday – Saturday · 9 am – 7 pm"}</p>
          </div>
          <div>
            <h3>Your little corner</h3>
            <Link to={user ? "/account" : "/login"}>
              {user ? "Your account" : "Sign in / create account"}
            </Link>
            <Link to="/admin">Staff access</Link>
            {user && (
              <button
                type="button"
                className="footer-button"
                onClick={doLogout}
              >
                Sign out
              </button>
            )}
            {Object.entries(settings.social || {})
              .filter(([, value]) => /^https?:\/\//.test(value))
              .map(([name, url]) => (
                <a key={name} href={url} target="_blank" rel="noreferrer">
                  {name}
                </a>
              ))}
          </div>
        </div>
        <div className="footer-bottom">
          <span>
            © {new Date().getFullYear()}{" "}
            {settings.storeName || "Virar Organics"}
          </span>
          <span>Small choices. Good things.</span>
        </div>
      </footer>
      {toast && <Toast toast={toast} onClose={() => setToast(null)} />}
      {authPrompt && (
        <Modal
          title="Sign in to start your basket"
          onClose={() => setAuthPrompt(null)}
        >
          <p>
            Sign in or create a customer account to add{" "}
            {authPrompt.productName || "products"}, save your basket and place
            an order.
          </p>
          <p className="muted">
            You can explore every collection before signing in.
          </p>
          <div className="form-actions">
            <Link
              to="/login"
              state={{ from: authPrompt.from }}
              className="button primary"
              onClick={() => setAuthPrompt(null)}
            >
              Sign in
            </Link>
            <Link
              to="/register"
              state={{ from: authPrompt.from }}
              className="button secondary"
              onClick={() => setAuthPrompt(null)}
            >
              Create account
            </Link>
          </div>
        </Modal>
      )}
    </>
  );
}
export function Toast({ toast, onClose }) {
  return (
    <div
      className={`toast ${toast.type}`}
      role={toast.type === "error" ? "alert" : "status"}
    >
      {toast.type === "error" ? <CircleAlert size={20} /> : <Check size={20} />}
      <span>{toast.message}</span>
      <button onClick={onClose} aria-label="Dismiss notification">
        <X size={16} />
      </button>
    </div>
  );
}
export function PageHeading({ eyebrow, title, description, actions }) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="heading-actions">{actions}</div>}
    </div>
  );
}
export function Loading({ label = "Loading…", inline = false }) {
  return (
    <div className={inline ? "loading inline" : "loading"} role="status">
      <LoaderCircle className="spin" size={22} />
      <span>{label}</span>
    </div>
  );
}
export function ErrorState({ error, retry }) {
  return (
    <div className="error-state" role="alert">
      <CircleAlert size={28} />
      <div>
        <h3>Something needs another try</h3>
        <p>{error}</p>
      </div>
      {retry && (
        <button className="button secondary" onClick={retry}>
          <RefreshCw size={16} /> Try again
        </button>
      )}
    </div>
  );
}
export function EmptyState({
  icon: Icon = ShoppingBag,
  title,
  message,
  action,
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon size={34} strokeWidth={1.4} />
      </span>
      <h2>{title}</h2>
      <p>{message}</p>
      {action}
    </div>
  );
}
export function Badge({ children, variant }) {
  const key =
    variant ||
    String(children || "")
      .toLowerCase()
      .replaceAll(" ", "-");
  return <span className={`badge badge-${key}`}>{children}</span>;
}
export function Field({ label, hint, children, className = "" }) {
  const id = useId();
  const labelId = `${id}-label`;
  const hintId = `${id}-hint`;
  const controls = React.Children.map(children, (child) => {
    if (!React.isValidElement(child)) return child;
    return React.cloneElement(child, {
      "aria-labelledby": child.props["aria-labelledby"] || labelId,
      "aria-describedby":
        [child.props["aria-describedby"], hint ? hintId : null]
          .filter(Boolean)
          .join(" ") || undefined,
    });
  });
  return (
    <label className={`field ${className}`}>
      <span id={labelId}>{label}</span>
      {controls}
      {hint && <small id={hintId}>{hint}</small>}
    </label>
  );
}
export function FormError({ error }) {
  return error ? (
    <p className="form-error" role="alert">
      <CircleAlert size={16} />
      {error}
    </p>
  ) : null;
}
export function SubmitButton({
  busy,
  children,
  className = "primary",
  ...props
}) {
  return (
    <button
      className={`button ${className}`}
      disabled={busy || props.disabled}
      {...props}
    >
      {busy ? <LoaderCircle size={17} className="spin" /> : null}
      {busy ? "Please wait…" : children}
    </button>
  );
}
export function Quantity({
  value,
  onChange,
  max = 999,
  min = 1,
  label = "Quantity",
  disabled = false,
}) {
  return (
    <div className="quantity">
      <button
        type="button"
        disabled={disabled || value <= min}
        onClick={() => onChange(value - 1)}
        aria-label={`Decrease ${label}`}
      >
        <Minus size={14} />
      </button>
      <input
        type="number"
        min={min}
        max={max}
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isInteger(next) && next >= min && next <= max)
            onChange(next);
        }}
      />
      <button
        type="button"
        disabled={disabled || value >= max}
        onClick={() => onChange(value + 1)}
        aria-label={`Increase ${label}`}
      >
        <Plus size={14} />
      </button>
    </div>
  );
}
export function ProductImage({ product, className = "", index = 0 }) {
  return (
    <img
      className={className}
      src={imagesOf(product)[index] || "/assets/product-placeholder.svg"}
      alt={product.name || "Organic product"}
      loading="lazy"
      onError={(event) => {
        if (
          !event.currentTarget.src.endsWith("/assets/product-placeholder.svg")
        )
          event.currentTarget.src = "/assets/product-placeholder.svg";
      }}
    />
  );
}
export function ProductCard({ product }) {
  const { cart, cartReady, addToCart } = useStore();
  const count =
    cart.find((item) => Number(item.id) === Number(product.id))?.quantity || 0;
  const available =
    product.available !== false &&
    product.active !== false &&
    Number(product.stock) > 0;
  const sale =
    product.sale_price !== null &&
    product.sale_price !== undefined &&
    Number(product.sale_price) < Number(product.price);
  return (
    <article className="product-card">
      <Link className="product-visual" to={`/products/${product.id}`}>
        <ProductImage product={product} />
        {product.featured ? (
          <span className="product-label">Store favourite</span>
        ) : sale ? (
          <span className="product-label sale">
            Save {money(Number(product.price) - priceOf(product))}
          </span>
        ) : null}
        {!available && <span className="sold-out-label">Unavailable</span>}
      </Link>
      <div className="product-card-body">
        <span className="product-category">
          {product.category || "The pantry collection"}
        </span>
        <Link to={`/products/${product.id}`}>
          <h3>{product.name}</h3>
        </Link>
        <div className="product-meta">
          <span className="unit">{product.unit || "per pack"}</span>
          <span
            role="status"
            aria-live="polite"
            className={available ? "stock-note" : "stock-note out"}
          >
            {available
              ? `${product.stock} available`
              : Number(product.stock) === 0
                ? "Out of stock"
                : "Unavailable"}
          </span>
        </div>
        <div className="product-card-bottom">
          <span className="product-price">
            {money(priceOf(product))}
            {sale && <del>{money(product.price)}</del>}
          </span>
          <button
            className="add-button"
            aria-label={`Add ${product.name} to basket`}
            disabled={!cartReady || !available || count >= product.stock}
            onClick={() => addToCart(product)}
          >
            <Plus size={17} />
            <span>Add</span>
          </button>
        </div>
      </div>
    </article>
  );
}
export function AvailabilityStatus() {
  const { liveConnected, refresh } = useStore();
  return (
    <div className="availability-sync">
      <span>
        <i className={liveConnected ? "online" : ""} />
        {liveConnected
          ? "Stock updates live"
          : "Stock refreshes every 20 seconds"}
      </span>
      <button
        type="button"
        className="link-button"
        onClick={refresh}
        aria-label="Refresh availability"
      >
        <RefreshCw size={13} /> Refresh
      </button>
    </div>
  );
}
export function Pagination({ page, total, limit, onPage }) {
  const pages = Math.max(1, Math.ceil(total / limit));
  if (pages < 2) return null;
  return (
    <nav className="pagination" aria-label="Pagination">
      <button
        className="button secondary"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
      >
        <ChevronLeft size={16} /> Previous
      </button>
      <span>
        Page {page} of {pages}
      </span>
      <button
        className="button secondary"
        disabled={page >= pages}
        onClick={() => onPage(page + 1)}
      >
        Next <ChevronRight size={16} />
      </button>
    </nav>
  );
}
export function SearchBox({
  value,
  onChange,
  placeholder = "Search…",
  label = "Search",
}) {
  return (
    <label className="search-box">
      <Search size={18} />
      <input
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
export function Modal({ title, children, onClose, wide = false }) {
  const ref = useRef();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    const cancel = (event) => {
      event.preventDefault();
      closeRef.current();
    };
    dialog.addEventListener("cancel", cancel);
    return () => {
      dialog.removeEventListener("cancel", cancel);
      dialog.close();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? "modal-wide" : ""}`}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal-header">
        <h2>{title}</h2>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Close dialog"
        >
          <X size={21} />
        </button>
      </div>
      <div className="modal-body">{children}</div>
    </dialog>
  );
}
export function ConfirmAction({
  title,
  message,
  confirmText = "Confirm",
  danger = false,
  onConfirm,
  onClose,
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal title={title} onClose={onClose}>
      <p>{message}</p>
      <FormError error={error} />
      <div className="form-actions">
        <button className="button secondary" disabled={busy} onClick={onClose}>
          Keep it
        </button>
        <SubmitButton
          busy={busy}
          className={danger ? "danger" : "primary"}
          onClick={async () => {
            setBusy(true);
            try {
              await onConfirm();
              onClose();
            } catch (err) {
              setError(err.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {confirmText}
        </SubmitButton>
      </div>
    </Modal>
  );
}
export function ImageUpload({
  images = [],
  onChange,
  multiple = true,
  label = "Images",
  disabled = false,
  onBusyChange,
}) {
  const input = useRef();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const upload = async (files) => {
    setError("");
    if (multiple && images.length + files.length > 8) {
      setError(
        "A product can have up to eight images. Remove one before adding another.",
      );
      return;
    }
    setBusy(true);
    onBusyChange?.(true);
    setProgress(0);
    try {
      const selected = multiple ? [...files] : [...files].slice(0, 1);
      const urls = await uploadImages(selected, setProgress);
      onChange(multiple ? [...images, ...urls] : urls);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
      onBusyChange?.(false);
      if (input.current) input.current.value = "";
    }
  };
  return (
    <div className="image-upload">
      <span className="field-label">{label}</span>
      <div
        className={`dropzone ${dragging ? "dragging" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (!busy && !disabled) upload(event.dataTransfer.files);
        }}
      >
        <Upload size={25} />
        <p>
          {busy
            ? `Uploading ${progress}%`
            : "Drop images here, or choose from your computer"}
        </p>
        <small>
          JPG, PNG or WebP · 5 MB each ·{" "}
          {multiple ? "up to 8 images total" : "one image"}
        </small>
        <button
          type="button"
          className="button secondary small"
          onClick={() => input.current.click()}
          disabled={busy || disabled}
        >
          {busy ? "Uploading…" : "Choose images"}
        </button>
        <input
          ref={input}
          hidden
          type="file"
          aria-label={`Upload ${label.toLowerCase()}`}
          accept="image/jpeg,image/png,image/webp"
          multiple={multiple}
          onChange={(event) => upload(event.target.files)}
        />
        {busy && <progress value={progress} max={100} />}
      </div>
      <FormError error={error} />
      <div className="image-previews">
        {images.map((url, index) => (
          <div className="image-preview" key={`${url}-${index}`}>
            <img src={url} alt={`${label} preview ${index + 1}`} />
            {multiple && index === 0 && <span>Cover</span>}
            <button
              type="button"
              aria-label={`Remove ${label.toLowerCase()} ${index + 1}`}
              disabled={busy || disabled}
              onClick={() => onChange(images.filter((_, i) => index !== i))}
            >
              <X size={15} />
            </button>
            {multiple && index > 0 && (
              <button
                className="make-cover"
                type="button"
                disabled={busy || disabled}
                onClick={() =>
                  onChange([url, ...images.filter((_, i) => i !== index)])
                }
              >
                Set cover
              </button>
            )}
          </div>
        ))}
      </div>
      <small className="muted">
        Uploaded files stay in the media library. Save this form to apply your
        selection.
      </small>
    </div>
  );
}
export function Timeline({ entries = [] }) {
  return entries.length ? (
    <ol className="timeline">
      {entries.map((event, index) => (
        <li key={event.id || index}>
          <span className="timeline-dot" />
          <div>
            <strong>
              {event.detail ||
                event.description ||
                event.status ||
                event.action}
            </strong>
            <p>
              {dateTime(event.created_at)}
              {event.actor_name ? ` · ${event.actor_name}` : ""}
            </p>
          </div>
        </li>
      ))}
    </ol>
  ) : (
    <p className="muted">Order events will appear here.</p>
  );
}
export function ServiceStatus({ compact = false }) {
  const { config, liveConnected } = useStore();
  return (
    <div className={`service-status ${compact ? "compact" : ""}`}>
      <span>
        <i className={liveConnected ? "status-dot" : "status-dot offline"} />
        {liveConnected ? "Live connection" : "Live connection offline"}
      </span>
      <span>
        <ShieldCheck size={14} />
        {config.payment?.mode === "razorpay"
          ? "Razorpay TEST"
          : config.payment?.mode === "mock"
            ? "Simulated payments"
            : "Cash on delivery"}
      </span>
      <span>
        <Clock3 size={14} />
        {config.notifications?.mode === "configured"
          ? "Notifications configured"
          : "Notifications simulated / skipped"}
      </span>
    </div>
  );
}
export function CsvLink({ href, children = "Export CSV" }) {
  return (
    <a className="button secondary small" href={`/api${href}`} download>
      <ArrowDownToLine size={15} />
      {children}
    </a>
  );
}
export function DeliveryMap({
  order,
  locations,
  storeLocation,
  editable = false,
  onPick,
  height = 330,
}) {
  const { settings, config } = useStore();
  const root = useRef();
  const map = useRef();
  const pickRef = useRef(onPick);
  const [tileError, setTileError] = useState(false);
  pickRef.current = onPick;
  const enabled =
    settings.mapEnabled !== false &&
    settings.mapEnabled !== 0 &&
    config.maps?.enabled !== false;
  const storeLat = Number(
      storeLocation?.latitude ?? settings.storeLat ?? 19.4559,
    ),
    storeLng = Number(storeLocation?.longitude ?? settings.storeLng ?? 72.8114);
  const lat = order?.latitude ?? order?.lat ?? order?.address?.lat;
  const lng = order?.longitude ?? order?.lng ?? order?.address?.lng;
  const valid = (a, b) =>
    a !== null &&
    b !== null &&
    a !== undefined &&
    b !== undefined &&
    Number.isFinite(Number(a)) &&
    Number.isFinite(Number(b));
  const points = (
    locations ||
    (valid(lat, lng) ? [{ ...order, latitude: lat, longitude: lng }] : [])
  ).filter((point) => valid(point.latitude, point.longitude));
  useEffect(() => {
    if (!root.current || !enabled) return;
    const instance = L.map(root.current, { scrollWheelZoom: false }).setView(
      [storeLat, storeLng],
      13,
    );
    map.current = instance;
    const tileLayer = L.tileLayer(
      config.maps?.tileUrl ||
        "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      {
        attribution: config.maps?.attribution || "© OpenStreetMap contributors",
        maxZoom: 19,
      },
    );
    tileLayer.on("tileerror", () => setTileError(true));
    tileLayer.addTo(instance);
    const icon = (type) =>
      L.divIcon({
        className: `map-pin ${type}`,
        html: "<span></span>",
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      });
    const storeLabel = document.createElement("span");
    storeLabel.textContent = `${settings.storeName || "Virar Organics"} store`;
    L.marker([storeLat, storeLng], { icon: icon("store-pin") })
      .addTo(instance)
      .bindTooltip(storeLabel);
    const bounds = [[storeLat, storeLng]];
    for (const point of points) {
      const position = [Number(point.latitude), Number(point.longitude)];
      bounds.push(position);
      L.marker(position, { icon: icon("destination-pin") })
        .addTo(instance)
        .bindTooltip(
          `Delivery destination${point.id ? ` · Order #${point.id}` : ""}`,
        );
    }
    if (valid(order?.driver_lat, order?.driver_lng)) {
      const position = [Number(order.driver_lat), Number(order.driver_lng)];
      bounds.push(position);
      L.marker(position, { icon: icon("driver-pin") })
        .addTo(instance)
        .bindTooltip(
          order.driver_source === "courier"
            ? "Last courier location"
            : "Manually entered delivery update",
        );
    }
    if (bounds.length > 1)
      instance.fitBounds(bounds, { padding: [35, 35], maxZoom: 15 });
    if (editable)
      instance.on("click", (event) =>
        pickRef.current?.({
          lat: Number(event.latlng.lat.toFixed(6)),
          lng: Number(event.latlng.lng.toFixed(6)),
        }),
      );
    const timer = setTimeout(() => instance.invalidateSize(), 150);
    const observer = new ResizeObserver(() => {
      if (root.current?.clientWidth && root.current?.clientHeight)
        instance.invalidateSize();
    });
    observer.observe(root.current);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
      instance.remove();
      map.current = null;
    };
  }, [
    enabled,
    storeLat,
    storeLng,
    config.maps?.tileUrl,
    config.maps?.attribution,
    settings.storeName,
    JSON.stringify(points),
    order?.driver_lat,
    order?.driver_lng,
    order?.driver_source,
    editable,
  ]);
  return (
    <div className="delivery-map">
      {enabled ? (
        <>
          <div
            ref={root}
            style={{ height }}
            role="img"
            aria-label="Map of the store and delivery destination"
          />
          <div className="map-legend">
            <span>
              <i className="legend-store" />
              Store
            </span>
            <span>
              <i className="legend-destination" />
              Delivery address
            </span>
            {valid(order?.driver_lat, order?.driver_lng) && (
              <span>
                <i className="legend-driver" />
                Last location update
              </span>
            )}
          </div>
          {editable && (
            <p className="map-note">
              Click the map to choose a location, or enter coordinates below.
            </p>
          )}
          {tileError && (
            <p className="map-note">
              Map tiles are unavailable. Address details and the order timeline
              still work.
            </p>
          )}
        </>
      ) : (
        <div className="map-unavailable">
          <MapPin size={30} />
          <strong>Map display is turned off</strong>
          <p>Your address and tracking timeline are still available.</p>
        </div>
      )}
      {order?.driver_updated_at && (
        <p className="map-note">
          {order.driver_source === "courier"
            ? "Courier location"
            : "Manual location update"}{" "}
          · {dateTime(order.driver_updated_at)}. This is the last reported
          position, not a live moving parcel.
        </p>
      )}
    </div>
  );
}
export function BackLink({ to, children }) {
  return (
    <Link className="back-link" to={to}>
      <ChevronLeft size={16} />
      {children}
    </Link>
  );
}
export function InlineNotice({ children, type = "info" }) {
  return (
    <div className={`inline-notice ${type}`}>
      <CircleAlert size={18} />
      <div>{children}</div>
    </div>
  );
}
export function FeatureStrip() {
  return (
    <div className="feature-strip">
      <div>
        <Sprout />
        <span>
          <strong>Thoughtfully selected</strong>
          <small>Everyday organic essentials</small>
        </span>
      </div>
      <div>
        <Package />
        <span>
          <strong>Made for your pantry</strong>
          <small>Clear prices & honest portions</small>
        </span>
      </div>
      <div>
        <MapPin />
        <span>
          <strong>A neighbourhood store</strong>
          <small>Serving homes around Virar</small>
        </span>
      </div>
    </div>
  );
}
export function TextLink({ to, children }) {
  return (
    <Link className="text-link" to={to}>
      {children}
      <ArrowRight size={17} />
    </Link>
  );
}
