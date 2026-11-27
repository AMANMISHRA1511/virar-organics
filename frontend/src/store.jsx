import React, { useEffect, useRef, useState } from "react";
import {
  Link,
  Navigate,
  Outlet,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  ArrowRight,
  Bell,
  Check,
  ChevronRight,
  CreditCard,
  Leaf,
  MapPin,
  Package,
  Phone,
  ShieldCheck,
  ShoppingBag,
  SlidersHorizontal,
  Sprout,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import {
  api,
  getCsrf,
  addressText,
  dateTime,
  imagesOf,
  listOf,
  makeQuery,
  money,
  orderNumber,
  priceOf,
} from "./api";
import { useStore } from "./context";
import { GoogleIdentity, PhoneVerification } from "./auth-options";
import { AddressFields } from "./addresses";
import { addressPayload, emptyAddress } from "./location";
import {
  readCheckoutAttempt,
  prepareCheckoutAttempt,
  markCheckoutRejected,
  clearCheckoutAttempt,
} from "./checkout-attempt";
import { useResource } from "./hooks";
import {
  BackLink,
  Badge,
  AvailabilityStatus,
  DeliveryMap,
  EmptyState,
  ErrorState,
  FeatureStrip,
  Field,
  FormError,
  InlineNotice,
  Loading,
  Modal,
  PageHeading,
  Pagination,
  ProductCard,
  ProductImage,
  Quantity,
  SearchBox,
  ServiceStatus,
  SubmitButton,
  TextLink,
  Timeline,
} from "./components";

export function Home() {
  const { settings, categories, revision } = useStore();
  const { data, loading, error, reload } = useResource(
    "/products?featured=true&limit=4",
    [revision],
  );
  return (
    <>
      <section className="home-hero container">
        <div className="hero-copy">
          <span className="eyebrow">
            <span className="eyebrow-line" /> FROM THE EARTH, WITH CARE
          </span>
          <h1>
            {settings.heading || "Good food.\nA little closer\nto nature."}
          </h1>
          <p>
            {settings.description ??
              "Fill your pantry with simple, wholesome essentials. Thoughtfully selected for your family, rooted in the goodness of nature."}
          </p>
          <div className="hero-actions">
            <Link to="/shop" className="button primary">
              Shop the harvest <ArrowRight size={18} />
            </Link>
            <Link to="/about" className="hero-story">
              Our story <ChevronRight size={16} />
            </Link>
          </div>
          <div className="hero-small">
            <span>
              <Leaf size={17} /> Everyday essentials
            </span>
            <span>
              <MapPin size={17} /> From Virar, with love
            </span>
          </div>
        </div>
        <div className="hero-art">
          {settings.banner ? (
            <img
              className="hero-banner"
              src={settings.banner}
              alt={`${settings.storeName || "Virar Organics"} seasonal harvest`}
            />
          ) : (
            <div className="hero-fallback">
              <Sprout size={140} strokeWidth={0.65} />
              <span>
                Something good
                <br />
                is growing.
              </span>
            </div>
          )}
          <div className="hero-seal">
            <Leaf size={23} />
            <span>
              GOOD FOOD
              <br />
              GOOD ROOTS
            </span>
          </div>
          <div className="hero-caption">
            <span className="caption-dot" /> The everyday pantry, thoughtfully
            made.
          </div>
        </div>
      </section>
      <div className="container">
        <FeatureStrip />
      </div>
      {settings.sections?.categories !== false && (
        <section className="section container">
          <div className="section-heading">
            <div>
              <span className="eyebrow">A PLACE FOR EVERYTHING GOOD</span>
              <h2>Find your kind of goodness</h2>
            </div>
            <TextLink to="/shop">Browse everything</TextLink>
          </div>
          <div className="category-grid">
            {categories.map((category, index) => (
              <Link
                to={`/shop?category=${category.id}`}
                key={category.id}
                className={`category-tile category-${index % 4}`}
              >
                <div className="category-image">
                  {category.image ? (
                    <img src={category.image} alt="" loading="lazy" />
                  ) : (
                    <Sprout size={55} strokeWidth={1} />
                  )}
                </div>
                <div>
                  <h3>{category.name}</h3>
                  <span>
                    Explore collection <ArrowRight size={15} />
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
      {settings.sections?.featured !== false && (
        <section className="section container">
          <div className="section-heading">
            <div>
              <span className="eyebrow">WELL LOVED, FOR GOOD REASON</span>
              <h2>Our favourites</h2>
            </div>
            <TextLink to="/shop?featured=true">See all favourites</TextLink>
          </div>
          {loading ? (
            <Loading label="Gathering the favourites…" />
          ) : error ? (
            <ErrorState error={error} retry={reload} />
          ) : listOf(data).length ? (
            <div className="product-grid">
              {listOf(data).map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          ) : (
            <EmptyState
              icon={Leaf}
              title="A fresh collection is on its way"
              message="Browse the full pantry while we select our next favourites."
              action={
                <Link to="/shop" className="button secondary">
                  Shop all products
                </Link>
              }
            />
          )}
        </section>
      )}
      {settings.sections?.about !== false && (
        <section className="story-band">
          <div className="container story-grid">
            <div className="story-art">
              <div className="story-circle">
                <Sprout size={115} strokeWidth={0.8} />
              </div>
              <span>
                Small choices.
                <br />
                <i>Good things.</i>
              </span>
            </div>
            <div>
              <span className="eyebrow">
                THE {(settings.storeName || "Virar Organics").toUpperCase()} WAY
              </span>
              <h2>
                Goodness begins
                <br />
                with the everyday.
              </h2>
              <p>
                {settings.about !== undefined
                  ? settings.about.slice(0, 300)
                  : "A shared meal. A well-stocked pantry. A little more care in what we bring home. We believe the best food makes room for all of these simple things."}
              </p>
              <TextLink to="/about">Get to know us</TextLink>
            </div>
          </div>
        </section>
      )}
      <section className="bulk-band container">
        <div>
          <span className="eyebrow">GOOD THINGS ARE BETTER SHARED</span>
          <h2>Stocking up for something bigger?</h2>
          <p>
            For cafés, offices, community kitchens and everyday bulk buyers.
          </p>
        </div>
        <Link to="/bulk" className="button secondary">
          Let’s talk bulk orders <ArrowRight size={18} />
        </Link>
      </section>
    </>
  );
}
export function Shop() {
  const { categories, revision } = useStore();
  const [params, setParams] = useSearchParams();
  const query = params.get("q") || "";
  const [searchInput, setSearchInput] = useState(query);
  const ownQueryUpdate = useRef(null);
  // Keep keystrokes in local state. Router search-param transitions must not
  // replace the input value between two fast key events.
  useEffect(() => {
    if (ownQueryUpdate.current === query) ownQueryUpdate.current = null;
    else setSearchInput(query); // Back/forward navigation or an external URL.
  }, [query]);
  useEffect(() => {
    if (searchInput === query) return;
    const timer = setTimeout(() => {
      ownQueryUpdate.current = searchInput;
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (searchInput) next.set("q", searchInput);
          else next.delete("q");
          next.delete("page");
          return next;
        },
        { replace: true },
      );
    }, 250);
    return () => clearTimeout(timer);
  }, [searchInput, query, setParams]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const category = params.get("category") || "",
    sort = params.get("sort") || "recommended",
    page = Math.max(1, Number(params.get("page") || 1));
  const min = params.get("minPrice") || "",
    max = params.get("maxPrice") || "",
    inStock = params.get("inStock") === "true",
    featured = params.get("featured") === "true";
  const update = (key, value) => {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value === "" || value === false || value === null) next.delete(key);
        else next.set(key, String(value));
        if (key !== "page") next.delete("page");
        return next;
      },
      { replace: true },
    );
  };
  const endpoint = `/products?${makeQuery({ q: query, category, sort, minPrice: min, maxPrice: max, inStock, featured, page, limit: 12 })}`;
  const result = useResource(endpoint, [revision]);
  const selectedCategory = categories.find(
    (item) => String(item.id) === category,
  );
  const clear = () => {
    ownQueryUpdate.current = "";
    setSearchInput("");
    setParams({});
  };
  return (
    <div className="container shop-page">
      <div className="breadcrumbs">
        <Link to="/">Home</Link>
        <ChevronRight size={13} />
        <span>The pantry</span>
      </div>
      <PageHeading
        eyebrow="A LITTLE GOODNESS, EVERY DAY"
        title={selectedCategory?.name || "The pantry collection"}
        description={
          selectedCategory?.description ||
          "Wholesome staples, fresh favourites and little pantry pleasures."
        }
      />
      <div className="shop-layout">
        <aside className={`shop-filters ${filtersOpen ? "filters-open" : ""}`}>
          <div className="filter-title">
            <h2>Refine your harvest</h2>
            <button
              className="icon-button mobile-only"
              onClick={() => setFiltersOpen(false)}
              aria-label="Close filters"
            >
              <X size={18} />
            </button>
          </div>
          <div className="filter-block">
            <h3>Collections</h3>
            <button
              className={
                !category ? "category-filter active" : "category-filter"
              }
              onClick={() => update("category", "")}
            >
              All good things <ChevronRight size={14} />
            </button>
            {categories.map((item) => (
              <button
                key={item.id}
                className={
                  category === String(item.id)
                    ? "category-filter active"
                    : "category-filter"
                }
                onClick={() => update("category", item.id)}
              >
                {item.name}
                <ChevronRight size={14} />
              </button>
            ))}
          </div>
          <div className="filter-block">
            <h3>Price range</h3>
            <div className="price-range">
              <Field label="From ₹">
                <input
                  type="number"
                  min="0"
                  value={min}
                  onChange={(event) => update("minPrice", event.target.value)}
                  placeholder="0"
                />
              </Field>
              <Field label="To ₹">
                <input
                  type="number"
                  min="0"
                  value={max}
                  onChange={(event) => update("maxPrice", event.target.value)}
                  placeholder="Any"
                />
              </Field>
            </div>
          </div>
          <div className="filter-block">
            <label className="check-field">
              <input
                type="checkbox"
                checked={inStock}
                onChange={(event) => update("inStock", event.target.checked)}
              />
              <span>In stock only</span>
            </label>
            <label className="check-field">
              <input
                type="checkbox"
                checked={featured}
                onChange={(event) => update("featured", event.target.checked)}
              />
              <span>Store favourites</span>
            </label>
          </div>
          <button className="link-button" onClick={clear}>
            Clear all filters
          </button>
          <div className="filter-help">
            <Leaf size={24} />
            <h3>A thoughtful pantry.</h3>
            <p>Small, everyday choices can make a good day.</p>
          </div>
        </aside>
        <section className="shop-results">
          <div className="catalogue-toolbar">
            <SearchBox
              value={searchInput}
              onChange={setSearchInput}
              placeholder="Find rice, honey, pulses…"
              label="Search products"
            />
            <button
              className="button secondary filter-toggle"
              onClick={() => setFiltersOpen(true)}
            >
              <SlidersHorizontal size={16} />
              Filters
            </button>
            <label className="sort-select">
              <span className="sr-only">Sort products</span>
              <select
                value={sort}
                onChange={(event) => update("sort", event.target.value)}
              >
                <option value="recommended">Store picks</option>
                <option value="newest">Newest first</option>
                <option value="name">Name A–Z</option>
                <option value="price_asc">Price: low to high</option>
                <option value="price_desc">Price: high to low</option>
              </select>
            </label>
          </div>
          <AvailabilityStatus />
          <p className="result-count">
            {result.loading
              ? "Gathering your selection…"
              : `${result.data?.total ?? listOf(result.data).length} good things to discover`}
          </p>
          {result.loading ? (
            <div className="skeleton-grid">
              {[1, 2, 3, 4, 5, 6].map((key) => (
                <div key={key} className="product-skeleton" />
              ))}
            </div>
          ) : result.error ? (
            <ErrorState error={result.error} retry={result.reload} />
          ) : listOf(result.data).length ? (
            <>
              <div className="product-grid shop-grid">
                {listOf(result.data).map((product) => (
                  <ProductCard key={product.id} product={product} />
                ))}
              </div>
              <Pagination
                page={page}
                total={result.data.total}
                limit={12}
                onPage={(next) => update("page", next)}
              />
            </>
          ) : (
            <EmptyState
              icon={SearchIcon}
              title="No products in this patch"
              message="Try a different search or loosen your filters to find something good."
              action={
                <button className="button secondary" onClick={clear}>
                  Clear filters
                </button>
              }
            />
          )}
        </section>
      </div>
    </div>
  );
}
function SearchIcon(props) {
  return <ShoppingBag {...props} />;
}
export function ProductDetail() {
  const { id } = useParams();
  const { addToCart, cart, cartReady, settings, revision } = useStore();
  const result = useResource(`/products/${id}`, [revision]);
  const [quantity, setQuantity] = useState(1);
  const [selectedImage, setSelectedImage] = useState(0);
  useEffect(() => {
    setQuantity(1);
    setSelectedImage(0);
  }, [id]);
  const product = result.data;
  const related = useResource(
    product ? `/products?category=${product.category_id || ""}&limit=5` : null,
    [revision],
  );
  if (result.loading)
    return (
      <div className="container">
        <Loading label="Opening the pantry…" />
      </div>
    );
  if (result.error && !product)
    return (
      <div className="container section">
        {result.errorStatus === 404 ? (
          <EmptyState
            icon={Package}
            title="This product is currently unavailable"
            message="Explore the collection for another good thing, or check again later."
          />
        ) : (
          <ErrorState error={result.error} retry={result.reload} />
        )}
        <BackLink to="/shop">Back to the collection</BackLink>
      </div>
    );
  if (!product) return null;
  const already =
      cart.find((item) => Number(item.id) === Number(id))?.quantity || 0,
    canBuy =
      !result.error &&
      product.available !== false &&
      product.active !== false &&
      Number(product.stock) > 0,
    available = canBuy ? Math.max(0, product.stock - already) : 0,
    sale =
      product.sale_price !== null &&
      product.sale_price !== undefined &&
      Number(product.sale_price) < Number(product.price);
  return (
    <div className="container product-detail">
      <div className="breadcrumbs">
        <Link to="/">Home</Link>
        <ChevronRight size={13} />
        <Link to="/shop">The pantry</Link>
        <ChevronRight size={13} />
        <span>{product.name}</span>
      </div>
      <div className="product-detail-grid">
        <div className="product-gallery">
          <div className="product-main-image">
            <ProductImage product={product} index={selectedImage} />
            {product.featured && (
              <span className="product-label">Store favourite</span>
            )}
          </div>
          {imagesOf(product).length > 1 && (
            <div className="product-thumbnails">
              {imagesOf(product).map((image, index) => (
                <button
                  key={image}
                  className={selectedImage === index ? "selected" : ""}
                  onClick={() => setSelectedImage(index)}
                  aria-label={`View product image ${index + 1}`}
                >
                  <img src={image} alt={`${product.name} view ${index + 1}`} />
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="product-info">
          <span className="eyebrow">
            {product.category || "PANTRY ESSENTIAL"}
          </span>
          <h1>{product.name}</h1>
          <p className="product-unit">
            {product.unit || "per pack"} · Thoughtfully selected
          </p>
          <div className="detail-price">
            {money(priceOf(product))}
            {sale && (
              <>
                <del>{money(product.price)}</del>
                <Badge variant="sale">
                  Save {money(Number(product.price) - priceOf(product))}
                </Badge>
              </>
            )}
          </div>
          <p className="product-description">{product.description}</p>
          <p
            role="status"
            aria-live="polite"
            className={canBuy ? "availability" : "availability out"}
          >
            <span />
            {canBuy
              ? `${product.stock} packs available`
              : result.error
                ? result.errorStatus === 404
                  ? "Currently unavailable"
                  : "Availability could not be verified"
                : "Out of stock — check back soon"}
          </p>
          <AvailabilityStatus />
          <div className="add-to-basket">
            <Quantity
              value={quantity}
              onChange={setQuantity}
              max={Math.max(1, available)}
              disabled={available <= 0}
            />
            <button
              className="button primary"
              disabled={!cartReady || available <= 0 || quantity > available}
              onClick={() => addToCart(product, quantity)}
            >
              <ShoppingBag size={18} />
              Add to basket · {money(priceOf(product) * quantity)}
            </button>
          </div>
          {already > 0 && (
            <p className="muted">
              {already} already in your basket.{" "}
              <Link className="underlined" to="/cart">
                View basket
              </Link>
            </p>
          )}
          <div className="product-promises">
            <div>
              <Package size={20} />
              <span>Carefully packed for your pantry</span>
            </div>
            <div>
              <MapPin size={20} />
              <span>
                Delivery around Virar ·{" "}
                {Number(settings.deliveryCharge)
                  ? `${money(settings.deliveryCharge)} delivery`
                  : "Delivery calculated at checkout"}
              </span>
            </div>
            <div>
              <ShieldCheck size={20} />
              <span>Cash on delivery available</span>
            </div>
          </div>
        </div>
      </div>
      <section className="section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">MAKE A LITTLE ROOM</span>
            <h2>You might also enjoy</h2>
          </div>
          <TextLink to="/shop">Back to the pantry</TextLink>
        </div>
        <div className="product-grid">
          {listOf(related.data)
            .filter((item) => item.id !== product.id)
            .slice(0, 4)
            .map((item) => (
              <ProductCard key={item.id} product={item} />
            ))}
        </div>
      </section>
    </div>
  );
}
function useCartDetails() {
  const { user, cart, revision } = useStore();
  const [products, setProducts] = useState({});
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [availabilityError, setAvailabilityError] = useState("");
  const previousKey = useRef("");
  const ids = cart
    .map((item) => item.id)
    .sort((a, b) => a - b)
    .join(",");
  useEffect(() => {
    const controller = new AbortController();
    if (user?.role !== "customer" || !ids) {
      setProducts({});
      setLoading(false);
      setChecking(false);
      setAvailabilityError("");
      previousKey.current = "";
      return () => controller.abort();
    }
    const key = `${user.id}:${ids}`;
    setLoading(previousKey.current !== key);
    setChecking(true);
    setAvailabilityError("");
    api("/products/availability", {
      method: "POST",
      body: { ids: ids.split(",").map(Number) },
      signal: controller.signal,
    })
      .then((data) => {
        if (controller.signal.aborted) return;
        const entries = data.items.map((item) => [
          item.id,
          item.product
            ? {
                ...item.product,
                stock: item.stock,
                available: item.available,
                availability_reason: item.reason,
              }
            : null,
        ]);
        setProducts(Object.fromEntries(entries));
        previousKey.current = key;
      })
      .catch((error) => {
        if (error.name !== "AbortError")
          setAvailabilityError(
            "Availability could not be refreshed. Reconnect or refresh before placing an order.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
          setChecking(false);
        }
      });
    return () => controller.abort();
  }, [ids, revision, user?.id, user?.role]);
  const lines = cart.map((item) => ({ ...item, product: products[item.id] }));
  const subtotal = lines.reduce(
    (total, item) =>
      total + (item.product ? priceOf(item.product) * item.quantity : 0),
    0,
  );
  const invalid =
    Boolean(availabilityError) ||
    lines.some(
      (item) =>
        !item.product ||
        item.product.available === false ||
        item.quantity > item.product.stock,
    );
  return { lines, subtotal, invalid, loading, checking, availabilityError };
}
function cartAvailabilityMessage(product, quantity) {
  if (!product)
    return "This product is no longer available. Please remove it to continue.";
  if (["inactive", "category_inactive"].includes(product.availability_reason))
    return "This product is currently unavailable. Please remove it to continue.";
  if (Number(product.stock) === 0)
    return "Out of stock. Please remove this item to continue.";
  if (quantity > product.stock)
    return `Only ${product.stock} available. Please reduce your quantity.`;
  return "";
}
export function CartPage() {
  const { user, authLoading, cart, cartReady, updateQuantity, settings } =
    useStore();
  const { lines, subtotal, invalid, loading, checking, availabilityError } =
    useCartDetails();
  const delivery = Number(settings.deliveryCharge || 0);
  if (authLoading) return <Loading label="Opening your basket…" />;
  if (!user || user.role !== "customer")
    return (
      <div className="container section cart-page">
        <EmptyState
          icon={UserRound}
          title="Your basket belongs to your account"
          message={
            user
              ? "Use a customer account to save a basket and place an order."
              : "Sign in or create an account to add products, save your basket and place an order."
          }
          action={
            !user ? (
              <>
                <Link
                  to="/login"
                  state={{ from: "/cart" }}
                  className="button primary"
                >
                  Sign in
                </Link>
                <Link
                  to="/register"
                  state={{ from: "/cart" }}
                  className="button secondary"
                >
                  Create account
                </Link>
              </>
            ) : (
              <Link to="/admin" className="button secondary">
                Open store studio
              </Link>
            )
          }
        />
      </div>
    );
  return (
    <div className="container section cart-page">
      <BackLink to="/shop">Back to the pantry</BackLink>
      <PageHeading
        eyebrow="YOUR EVERYDAY GOODNESS"
        title="A basket full of good things"
        description={`${cart.reduce((sum, item) => sum + item.quantity, 0)} items, thoughtfully chosen.`}
      />
      <AvailabilityStatus />
      {!cartReady ? (
        <Loading label="Loading your saved basket…" />
      ) : !cart.length ? (
        <EmptyState
          title="Your basket is waiting for something good"
          message="Start with the staples, or find a new pantry favourite."
          action={
            <Link className="button primary" to="/shop">
              Explore the collection <ArrowRight size={16} />
            </Link>
          }
        />
      ) : loading ? (
        <Loading label="Checking your basket…" />
      ) : (
        <div className="checkout-layout">
          <div className="basket-items">
            {lines.map(({ id, product, quantity }) => (
              <article className="basket-item" key={id}>
                <Link to={`/products/${id}`}>
                  <ProductImage
                    product={product || { name: "Unavailable product" }}
                  />
                </Link>
                <div className="basket-item-info">
                  <Link to={`/products/${id}`}>
                    <h3>{product?.name || "Product no longer available"}</h3>
                  </Link>
                  <p>
                    {product?.unit}{" "}
                    {product && `· ${money(priceOf(product))} each`}
                  </p>
                  {cartAvailabilityMessage(product, quantity) && (
                    <p className="form-error" role="status" aria-live="polite">
                      {cartAvailabilityMessage(product, quantity)}
                    </p>
                  )}
                  <button
                    className="remove-item"
                    aria-label={`Remove ${product?.name || "unavailable product"}`}
                    onClick={() => updateQuantity(id, 0)}
                  >
                    <Trash2 size={14} />
                    Remove
                  </button>
                </div>
                <Quantity
                  value={quantity}
                  max={Math.max(quantity, product?.stock || 1)}
                  disabled={
                    !product ||
                    product.available === false ||
                    Number(product.stock) === 0
                  }
                  onChange={(next) => updateQuantity(id, next)}
                  label={`${product?.name || "item"} quantity`}
                />
                <strong>
                  {money(product ? priceOf(product) * quantity : 0)}
                </strong>
              </article>
            ))}
            <div className="basket-note">
              <Leaf size={22} />
              <p>
                Every well-stocked pantry starts with a few good choices. Thanks
                for choosing ours.
              </p>
            </div>
          </div>
          <aside className="order-summary">
            <span className="eyebrow">THE LITTLE DETAILS</span>
            <h2>Your order summary</h2>
            <FormError error={availabilityError} />
            <div className="summary-line">
              <span>Subtotal</span>
              <span>{money(subtotal)}</span>
            </div>
            <div className="summary-line">
              <span>Delivery</span>
              <span>{delivery ? money(delivery) : "Free"}</span>
            </div>
            <div className="summary-line total">
              <span>Total</span>
              <span>{money(subtotal + delivery)}</span>
            </div>
            {Number(settings.minimumOrder) > subtotal && (
              <InlineNotice>
                Minimum order is {money(settings.minimumOrder)}. Add{" "}
                {money(Number(settings.minimumOrder) - subtotal)} to continue.
              </InlineNotice>
            )}
            <Link
              className={`button primary full ${invalid || checking || Number(settings.minimumOrder) > subtotal ? "disabled-link" : ""}`}
              to="/checkout"
              onClick={(event) => {
                if (
                  invalid ||
                  checking ||
                  Number(settings.minimumOrder) > subtotal
                )
                  event.preventDefault();
              }}
              tabIndex={
                invalid || checking || Number(settings.minimumOrder) > subtotal
                  ? -1
                  : undefined
              }
              aria-disabled={
                invalid || checking || Number(settings.minimumOrder) > subtotal
              }
            >
              Continue to checkout <ArrowRight size={17} />
            </Link>
            <p className="summary-reassurance">
              <ShieldCheck size={15} /> Stock and totals checked securely at
              checkout
            </p>
          </aside>
        </div>
      )}
    </div>
  );
}
export function AuthPage({ register = false, staff = false }) {
  const { login, user, setUser, authLoading, settings } = useStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const returnTo = location.state?.from || "/account";
  if (!authLoading && user)
    return (
      <Navigate
        to={
          user.role === "customer"
            ? returnTo.startsWith("/admin")
              ? "/account"
              : returnTo
            : "/admin"
        }
        replace
      />
    );
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const profile = register
        ? await api("/register", { method: "POST", body: values })
        : await login(values);
      if (register) {
        await getCsrf(true);
        setUser(profile.user || profile);
      }
      if (staff && profile.role === "customer") navigate("/account");
      else
        navigate(
          profile.role === "customer"
            ? returnTo.startsWith("/admin")
              ? "/account"
              : returnTo
            : "/admin",
          { replace: true },
        );
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="container auth-page">
      <div className="auth-story">
        <span className="eyebrow">
          YOUR {(settings.storeName || "Virar Organics").toUpperCase()} ACCOUNT
        </span>
        <h1>
          {staff ? "A good day\nstarts here." : "Good to have\nyou here."}
        </h1>
        <p>
          {staff
            ? "Manage your store, care for your customers, and keep good things growing."
            : "A thoughtfully stocked pantry. Your favourite essentials. A little goodness, whenever you need it."}
        </p>
        <div className="auth-illustration">
          <Sprout size={110} strokeWidth={0.7} />
        </div>
        <BackLink to="/">Return to the store</BackLink>
      </div>
      <section className="auth-card">
        <span className="auth-icon">
          <UserRound size={25} />
        </span>
        <h2>
          {register
            ? "Create your customer account"
            : staff
              ? "Employee sign in"
              : "Welcome back"}
        </h2>
        <p>
          {register
            ? `Join ${settings.storeName || "Virar Organics"} as a customer to shop, save addresses and track your orders.`
            : staff
              ? "Employee accounts are created by an administrator. Ask your administrator for your sign-in details."
              : `Sign in to your ${settings.storeName || "Virar Organics"} customer account.`}
        </p>
        <form onSubmit={submit} className="form-stack">
          {register && (
            <>
              <Field label="Full name">
                <input
                  name="name"
                  autoComplete="name"
                  required
                  maxLength={100}
                />
              </Field>
              <Field label="Mobile number">
                <input
                  name="phone"
                  type="tel"
                  autoComplete="tel"
                  placeholder="+91 98765 43210"
                  required
                  maxLength={30}
                />
              </Field>
            </>
          )}
          <Field label="Email address">
            <input
              name="email"
              type="email"
              autoComplete="email"
              required
              maxLength={190}
            />
          </Field>
          <Field
            label="Password"
            hint={
              register
                ? "Use 10–72 characters. Choose a password you do not use elsewhere."
                : undefined
            }
          >
            <input
              name="password"
              type="password"
              autoComplete={register ? "new-password" : "current-password"}
              required
              minLength={register ? 10 : undefined}
              maxLength={72}
            />
          </Field>
          <FormError error={error} />
          <SubmitButton busy={busy}>
            {register ? "Create account" : "Sign in"}
            <ArrowRight size={17} />
          </SubmitButton>
        </form>
        {!register && <p className="auth-switch"><Link to="/forgot-password">Forgot password?</Link></p>}
        {!staff && (
          <>
            <div className="auth-divider">
              <span>or continue with Google</span>
            </div>
            <GoogleIdentity
              onSuccess={() =>
                navigate(
                  returnTo.startsWith("/admin") ? "/account" : returnTo,
                  { replace: true },
                )
              }
            />
          </>
        )}
        {!staff && (
          <p className="auth-switch">
            {register
              ? "Already have a customer account?"
              : `New to ${settings.storeName || "Virar Organics"}?`}{" "}
            <Link to={register ? "/login" : "/register"} state={location.state}>
              {register ? "Sign in" : "Create an account"}
            </Link>
          </p>
        )}
        <p className="auth-private">
          <ShieldCheck size={14} />
          Your details stay in your account.
        </p>
      </section>
    </div>
  );
}
export function RequireCustomer() {
  const { user, authLoading } = useStore();
  const location = useLocation();
  if (authLoading) return <Loading />;
  if (!user)
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  if (user.role !== "customer")
    return (
      <div className="container section">
        <EmptyState
          icon={UserRound}
          title="Shopping is for customer accounts"
          message="Your current account is a staff account. Sign out and use a customer account to check out."
          action={
            <Link to="/admin" className="button primary">
              Open store studio
            </Link>
          }
        />
      </div>
    );
  return <Outlet />;
}
export function Checkout() {
  const {
    user,
    settings,
    config,
    cart,
    cartReady,
    clearCart,
    notify,
    refresh,
    revision,
  } = useStore();
  const { lines, subtotal, invalid, loading, checking, availabilityError } =
    useCartDetails();
  const savedAddresses = useResource("/account/addresses", [revision]);
  const [completedOrder, setCompletedOrder] = useState(null);
  const [pendingAttempt, setPendingAttempt] = useState(() =>
    readCheckoutAttempt(sessionStorage, user.id),
  );
  const [recovering, setRecovering] = useState(Boolean(pendingAttempt));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [payment, setPayment] = useState(
    pendingAttempt?.payload.payment_method || "cod",
  );
  const [address, setAddress] = useState(() => ({
    ...emptyAddress(user),
    ...(pendingAttempt?.payload.address || {}),
  }));
  const [selectedAddress, setSelectedAddress] = useState("");
  const [addressSaving, setAddressSaving] = useState(false);
  const [addressError, setAddressError] = useState("");
  const addressEdited = useRef(Boolean(pendingAttempt));
  const inFlight = useRef(false);
  const paymentMode = config.payment?.mode || "disabled";
  const delivery = Number(settings.deliveryCharge || 0);
  const finishOrder = (order, attempt) => {
    setCompletedOrder({
      path: `/account/orders/${order.id}${order.payment_method !== "cod" && order.payment_status !== "paid" && order.status !== "Cancelled" ? "?pay=1" : ""}`,
      checkout: order.checkout,
    });
    // A confirmed order wins over an empty-basket redirect, even during a
    // deferred router transition or recovery before cart hydration finishes.
    clearCart();
    try {
      clearCheckoutAttempt(sessionStorage, user.id, attempt.key);
    } catch {
      /* A repeated recovery lookup still returns this same order. */
    }
    setPendingAttempt(null);
    refresh();
    notify(
      order.payment_method === "cod"
        ? "Your order is in. Good things are on their way."
        : "Your order is saved. Complete or review payment below.",
    );
  };
  useEffect(() => {
    const attempt = readCheckoutAttempt(sessionStorage, user.id);
    if (!attempt) return;
    let alive = true;
    setRecovering(true);
    api(`/orders/by-checkout-key/${encodeURIComponent(attempt.key)}`)
      .then((result) => {
        if (alive && result.order) finishOrder(result.order, attempt);
      })
      .catch((failure) => {
        if (alive)
          setError(
            `Your previous checkout could not be checked. ${failure.message}`,
          );
      })
      .finally(() => {
        if (alive) setRecovering(false);
      });
    return () => {
      alive = false;
    };
  }, [user.id]);
  useEffect(() => {
    if (
      addressEdited.current ||
      pendingAttempt ||
      !savedAddresses.data?.items?.length
    )
      return;
    const preferred =
      savedAddresses.data.items.find((item) => item.is_default) ||
      savedAddresses.data.items[0];
    setAddress({
      ...emptyAddress(user),
      ...preferred,
      building: preferred.building || preferred.line1 || "",
      landmark: preferred.landmark || preferred.line2 || "",
    });
    setSelectedAddress(String(preferred.id));
  }, [savedAddresses.data, user.id, pendingAttempt]);
  const editAddress = (update) => {
    addressEdited.current = true;
    setAddress((previous) =>
      typeof update === "function" ? update(previous) : update,
    );
  };
  const chooseAddress = (id) => {
    addressEdited.current = true;
    setSelectedAddress(id);
    const saved = savedAddresses.data?.items?.find(
      (item) => String(item.id) === id,
    );
    setAddress(
      saved
        ? {
            ...emptyAddress(user),
            ...saved,
            building: saved.building || saved.line1 || "",
            landmark: saved.landmark || saved.line2 || "",
          }
        : emptyAddress(user),
    );
    setAddressError("");
  };
  const saveAddress = async (event) => {
    if (!event.currentTarget.closest("form").reportValidity()) return;
    setAddressSaving(true);
    setAddressError("");
    try {
      const saved = await api(
        selectedAddress
          ? `/account/addresses/${selectedAddress}`
          : "/account/addresses",
        {
          method: selectedAddress ? "PATCH" : "POST",
          body: addressPayload(address),
        },
      );
      setSelectedAddress(String(saved.id));
      setAddress((previous) => ({ ...previous, id: saved.id }));
      savedAddresses.reload();
      refresh();
      notify("Delivery address saved to your account.");
    } catch (failure) {
      setAddressError(failure.message);
    } finally {
      setAddressSaving(false);
    }
  };
  const sendAttempt = async (attempt) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setPendingAttempt(attempt);
    try {
      const order = await api("/orders", {
        method: "POST",
        body: { ...attempt.payload, idempotency_key: attempt.key },
      });
      finishOrder(order, attempt);
    } catch (failure) {
      // These responses definitively rejected this exact body. An ambiguous
      // transport/server error retains the key and allows only exact retry.
      const rejected =
        failure.status === 400 ||
        failure.status === 422 ||
        (failure.status === 409 &&
          ["OUT_OF_STOCK", "PRODUCT_UNAVAILABLE"].includes(failure.code));
      if (rejected) {
        try {
          setPendingAttempt(
            markCheckoutRejected(
              sessionStorage,
              user.id,
              attempt,
              failure.message,
            ),
          );
        } catch {
          /* Preserve in-memory recovery as well. */
        }
      }
      setError(failure.message);
      refresh();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const submit = async (event) => {
    event.preventDefault();
    if (inFlight.current || invalid || checking) return;
    try {
      const attempt = prepareCheckoutAttempt(sessionStorage, user.id, {
        items: cart,
        address: addressPayload(address),
        payment_method: payment,
      });
      await sendAttempt(attempt);
    } catch (failure) {
      if (failure.attempt) setPendingAttempt(failure.attempt);
      setError(failure.message);
    }
  };
  if (completedOrder)
    return (
      <Navigate
        to={completedOrder.path}
        state={{ checkout: completedOrder.checkout }}
        replace
      />
    );
  if (recovering) return <Loading label="Checking your previous checkout…" />;
  if (pendingAttempt)
    return (
      <div className="container section checkout-page checkout-recovery">
        <PageHeading
          eyebrow="KEEPING YOUR ORDER TOGETHER"
          title={
            pendingAttempt.status === "rejected"
              ? "Your checkout needs a little attention"
              : "Let’s check your previous checkout"
          }
          description={
            pendingAttempt.status === "rejected"
              ? "The store rejected this request. Review the details before starting again."
              : "The last request may already have reached the store. Retrying uses the same request so it cannot create a second order."
          }
        />
        <section className="form-card">
          <h2>Saved checkout request</h2>
          <p>
            {pendingAttempt.payload.items.reduce(
              (sum, item) => sum + item.quantity,
              0,
            )}{" "}
            items ·{" "}
            {pendingAttempt.payload.payment_method === "cod"
              ? "Cash on delivery"
              : "Online payment"}
          </p>
          <p>{addressText(pendingAttempt.payload.address)}</p>
          <FormError error={error || pendingAttempt.message} />
          <div className="form-actions">
            <SubmitButton
              busy={busy}
              onClick={() => sendAttempt(pendingAttempt)}
            >
              Retry the same checkout
            </SubmitButton>
            <Link to="/account/orders" className="button secondary">
              Check my orders
            </Link>
            {pendingAttempt.status === "rejected" && (
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => {
                  clearCheckoutAttempt(
                    sessionStorage,
                    user.id,
                    pendingAttempt.key,
                  );
                  setAddress({
                    ...emptyAddress(user),
                    ...pendingAttempt.payload.address,
                  });
                  setPayment(pendingAttempt.payload.payment_method);
                  setPendingAttempt(null);
                  setError("");
                }}
              >
                Review and change checkout
              </button>
            )}
          </div>
        </section>
      </div>
    );
  if (!cartReady) return <Loading label="Loading your saved basket…" />;
  if (!cart.length) return <Navigate to="/cart" replace />;
  return (
    <div className="container section checkout-page">
      <BackLink to="/cart">Back to your basket</BackLink>
      <PageHeading
        eyebrow="ONE LAST LITTLE STEP"
        title="Let’s bring the goodness home"
        description="Add your delivery details and choose how you’d like to pay."
      />
      {loading ? (
        <Loading label="Checking availability…" />
      ) : (
        <form className="checkout-layout" onSubmit={submit}>
          <div className="checkout-form">
            <section className="form-card">
              <div className="card-section-title">
                <span>01</span>
                <h2>Where should we deliver?</h2>
              </div>
              {savedAddresses.loading ? (
                <p className="muted">Loading saved addresses…</p>
              ) : savedAddresses.error ? (
                <InlineNotice>
                  Saved addresses could not load. You can enter an address
                  below.{" "}
                  <button
                    type="button"
                    className="link-button"
                    onClick={savedAddresses.reload}
                  >
                    Try again
                  </button>
                </InlineNotice>
              ) : (
                savedAddresses.data?.items?.length > 0 && (
                  <Field label="Saved delivery address">
                    <select
                      value={selectedAddress}
                      onChange={(event) => chooseAddress(event.target.value)}
                    >
                      <option value="">Enter a new address</option>
                      {savedAddresses.data.items.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.label || "Address"} · {item.area || item.city}
                          {item.is_default ? " · Default" : ""}
                        </option>
                      ))}
                    </select>
                  </Field>
                )
              )}
              <AddressFields
                key={selectedAddress || "new-address"}
                value={address}
                onChange={editAddress}
                showLabel
                disabled={busy || addressSaving}
              />
              <div className="checkout-address-save">
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy || addressSaving}
                  onClick={saveAddress}
                >
                  {addressSaving
                    ? "Saving address…"
                    : "Save this address to my account"}
                </button>
                <span>Save now to use these details for your next order.</span>
              </div>
              <FormError error={addressError} />
              {settings.deliveryZones?.length > 0 && (
                <p className="muted delivery-zones">
                  Delivery zones:{" "}
                  {settings.deliveryZones
                    .map(
                      (zone) =>
                        `${zone.name}${zone.pincodes?.length ? ` (${zone.pincodes.join(", ")})` : ""}`,
                    )
                    .join(" · ")}
                </p>
              )}
            </section>
            <section className="form-card">
              <div className="card-section-title">
                <span>02</span>
                <h2>How would you like to pay?</h2>
              </div>
              <label
                className={`payment-option ${payment === "cod" ? "selected" : ""}`}
              >
                <input
                  type="radio"
                  name="payment"
                  value="cod"
                  checked={payment === "cod"}
                  onChange={() => setPayment("cod")}
                />
                <Package size={24} />
                <span>
                  <strong>Cash on delivery</strong>
                  <small>Pay when your order arrives.</small>
                </span>
              </label>
              {paymentMode === "mock" && (
                <label
                  className={`payment-option ${payment === "mock" ? "selected" : ""}`}
                >
                  <input
                    type="radio"
                    name="payment"
                    value="mock"
                    checked={payment === "mock"}
                    onChange={() => setPayment("mock")}
                  />
                  <CreditCard size={24} />
                  <span>
                    <strong>Simulated payment · local demo</strong>
                    <small>
                      Test success or failure. No money is collected.
                    </small>
                  </span>
                </label>
              )}
              {paymentMode === "razorpay" && (
                <label
                  className={`payment-option ${payment === "razorpay" ? "selected" : ""}`}
                >
                  <input
                    type="radio"
                    name="payment"
                    value="razorpay"
                    checked={payment === "razorpay"}
                    onChange={() => setPayment("razorpay")}
                  />
                  <CreditCard size={24} />
                  <span>
                    <strong>Razorpay · TEST mode</strong>
                    <small>Use test payment details. No real payment.</small>
                  </span>
                </label>
              )}
              {paymentMode === "disabled" && (
                <>
                  <label className="payment-option" aria-disabled="true" style={{ opacity: 0.65 }}>
                    <input type="radio" name="payment" value="razorpay" disabled />
                    <CreditCard size={24} />
                    <span>
                      <strong>Razorpay · Online payment (coming soon)</strong>
                      <small>Temporarily unavailable. Secure payment setup is pending. Please choose Cash on Delivery.</small>
                    </span>
                  </label>
                  <p className="muted" role="status">
                    Razorpay will be enabled after secure test credentials and webhook verification are configured by the store administrator.
                  </p>
                </>
              )}
            </section>
          </div>
          <aside className="order-summary">
            <span className="eyebrow">YOUR THOUGHTFUL SELECTION</span>
            <h2>Order summary</h2>
            {lines.map(({ id, product, quantity }) => (
              <div className="checkout-item" key={id}>
                <ProductImage
                  product={product || { name: "Unavailable item" }}
                />
                <div>
                  <strong>{product?.name || "Unavailable item"}</strong>
                  <span>
                    {quantity} × {product ? money(priceOf(product)) : "—"}
                  </span>
                  {cartAvailabilityMessage(product, quantity) && (
                    <small
                      className="form-error"
                      role="status"
                      aria-live="polite"
                    >
                      {cartAvailabilityMessage(product, quantity)}
                    </small>
                  )}
                </div>
                <b>{money(product ? priceOf(product) * quantity : 0)}</b>
              </div>
            ))}
            <div className="summary-line">
              <span>Subtotal</span>
              <span>{money(subtotal)}</span>
            </div>
            <div className="summary-line">
              <span>Delivery</span>
              <span>{delivery ? money(delivery) : "Free"}</span>
            </div>
            <div className="summary-line total">
              <span>Total</span>
              <span>{money(subtotal + delivery)}</span>
            </div>
            <FormError error={availabilityError} />
            {invalid && (
              <FormError error="Please update unavailable items in your basket before placing this order." />
            )}
            <AvailabilityStatus />
            {Number(settings.minimumOrder) > subtotal && (
              <FormError
                error={`Minimum order is ${money(settings.minimumOrder)}.`}
              />
            )}
            <FormError error={error} />
            <SubmitButton
              busy={busy}
              disabled={
                invalid ||
                checking ||
                addressSaving ||
                Number(settings.minimumOrder) > subtotal
              }
              className="primary full"
            >
              {payment === "cod" ? "Place order" : "Continue to payment"}
              <ArrowRight size={17} />
            </SubmitButton>
            <p className="summary-reassurance">
              <ShieldCheck size={15} />
              Final price and stock verified by the store
            </p>
          </aside>
        </form>
      )}
    </div>
  );
}
export function AccountLayout() {
  const { user, logout } = useStore();
  const navigate = useNavigate();
  return (
    <div className="container section account-page">
      <PageHeading
        eyebrow="YOUR LITTLE CORNER"
        title={`Hello, ${user.name.split(" ")[0]}`}
        description="Keep an eye on your orders and make yourself at home."
      />
      <div className="account-layout">
        <nav className="account-nav" aria-label="Account navigation">
          <Link to="/account">
            <UserRound size={18} />
            Your profile
          </Link>
          <Link to="/account/orders">
            <Package size={18} />
            Your orders
          </Link>
          <Link to="/account/addresses">
            <MapPin size={18} />
            Saved addresses
          </Link>
          <Link to="/account/notifications">
            <Bell size={18} />
            Your updates
          </Link>
          <Link to="/shop">
            <ShoppingBag size={18} />
            Continue shopping
          </Link>
          <button
            onClick={async () => {
              await logout();
              navigate("/");
            }}
          >
            <ArrowRight size={18} />
            Sign out
          </button>
        </nav>
        <section>
          <Outlet />
        </section>
      </div>
    </div>
  );
}
export function AccountProfile() {
  const { user, setUser, notify } = useStore();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [error, setError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const result = await api("/account", { method: "PATCH", body: values });
      setUser(result.user || result);
      notify("Your profile is updated.");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const password = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    setPasswordBusy(true);
    setPasswordError("");
    const values = Object.fromEntries(new FormData(form));
    if (values.newPassword !== values.confirmPassword) {
      setPasswordError("The new passwords do not match.");
      setPasswordBusy(false);
      return;
    }
    try {
      await api("/account/password", { method: "PATCH", body: values });
      form.reset();
      setUser(null);
      notify("Password updated. Please sign in with your new password.");
      navigate("/login");
    } catch (err) {
      setPasswordError(err.message);
    } finally {
      setPasswordBusy(false);
    }
  };
  return (
    <>
      <section className="form-card">
        <h2>Profile details</h2>
        <form onSubmit={save} className="form-stack">
          <div className="form-grid">
            <Field label="Full name">
              <input
                name="name"
                defaultValue={user.name}
                required
                maxLength={100}
              />
            </Field>
            <Field label="Mobile number">
              <input
                key={`profile-phone-${user.phone}`}
                name="phone"
                defaultValue={user.phone}
                type="tel"
                required
                maxLength={30}
              />
            </Field>
            <Field label="Email address">
              <input type="email" value={user.email} readOnly />
              <small>Email is tied to your account.</small>
            </Field>
          </div>
          <FormError error={error} />
          <div>
            <SubmitButton busy={busy}>Save profile</SubmitButton>
          </div>
        </form>
      </section>
      <PhoneVerification />
      <section className="form-card">
        <h2>Connected Google account</h2>
        <p className="muted">
          Link your own Google identity after signing in to this customer
          account.
        </p>
        <GoogleIdentity purpose="link" />
      </section>
      <section className="form-card">
        <h2>Change password</h2>
        {user.has_password === false ? (
          <InlineNotice>
            This account uses Google sign-in. Continue using your linked Google
            account to sign in; password sign-in is not enabled for this
            account.
          </InlineNotice>
        ) : (
          <form className="form-stack" onSubmit={password}>
            <div className="form-grid">
              <Field label="Current password">
                <input
                  name="currentPassword"
                  type="password"
                  autoComplete="current-password"
                  required
                />
              </Field>
              <div />
              <Field label="New password">
                <input
                  name="newPassword"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={10}
                  maxLength={72}
                />
              </Field>
              <Field label="Confirm new password">
                <input
                  name="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={10}
                  maxLength={72}
                />
              </Field>
            </div>
            <FormError error={passwordError} />
            <div>
              <SubmitButton busy={passwordBusy}>Update password</SubmitButton>
            </div>
          </form>
        )}
      </section>
    </>
  );
}
export function MyOrders() {
  const { revision } = useStore();
  const [page, setPage] = useState(1);
  const result = useResource(`/orders?page=${page}&limit=10`, [revision]);
  return (
    <>
      <div className="section-heading">
        <h2>Your orders</h2>
        <ServiceStatus compact />
      </div>
      {result.loading ? (
        <Loading />
      ) : result.error ? (
        <ErrorState error={result.error} retry={result.reload} />
      ) : !listOf(result.data).length ? (
        <EmptyState
          icon={Package}
          title="Your first order is waiting to happen"
          message="Something wholesome for your pantry is only a few clicks away."
          action={
            <Link className="button primary" to="/shop">
              Shop the collection
            </Link>
          }
        />
      ) : (
        <>
          <div className="customer-order-list">
            {listOf(result.data).map((order) => (
              <article className="customer-order-card" key={order.id}>
                <div className="order-card-top">
                  <div>
                    <span className="eyebrow">{orderNumber(order.id)}</span>
                    <p>Placed {dateTime(order.created_at)}</p>
                  </div>
                  <Badge>{order.status}</Badge>
                </div>
                <div className="order-card-bottom">
                  <div>
                    <strong>{money(order.total)}</strong>
                    <span>
                      {order.payment_method === "cod"
                        ? "Cash on delivery"
                        : order.payment_method === "mock"
                          ? "Simulated payment"
                          : "Razorpay TEST"}{" "}
                      · {order.payment_status}
                    </span>
                  </div>
                  <Link
                    className="button secondary small"
                    to={`/account/orders/${order.id}`}
                  >
                    View & track <ArrowRight size={16} />
                  </Link>
                </div>
              </article>
            ))}
          </div>
          <Pagination
            page={page}
            total={result.data.total}
            limit={10}
            onPage={setPage}
          />
        </>
      )}
    </>
  );
}
async function openRazorpay(order, checkout, storeName = "Virar Organics") {
  if (!window.Razorpay)
    await new Promise((resolve, reject) => {
      const existing = document.querySelector("script[data-razorpay]");
      if (existing) existing.remove();
      const script = document.createElement("script");
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.dataset.razorpay = "true";
      script.onload = resolve;
      script.onerror = () =>
        reject(
          new Error(
            "Could not load Razorpay. Your order is saved; please try again later.",
          ),
        );
      document.head.appendChild(script);
    });
  return new Promise((resolve, reject) => {
    const handler = new window.Razorpay({
      key: checkout.keyId,
      amount: checkout.amount,
      currency: "INR",
      name: storeName,
      description: `${orderNumber(order.id)} · TEST payment`,
      order_id: checkout.gateway_order_id,
      prefill: checkout.prefill,
      theme: { color: "#234b38" },
      handler: async (response) => {
        try {
          const verified = await api("/payments/verify", {
            method: "POST",
            body: { order_id: order.id, ...response },
          });
          resolve(verified);
        } catch (error) {
          reject(error);
        }
      },
      modal: {
        ondismiss: () =>
          reject(new Error("Payment was closed. Your order remains pending.")),
      },
    });
    handler.on("payment.failed", (event) =>
      reject(
        new Error(
          event.error?.description || "The test payment failed. Please retry.",
        ),
      ),
    );
    handler.open();
  });
}
export function MyOrderDetail() {
  const { id } = useParams();
  const { revision, notify, config, refresh, settings } = useStore();
  const result = useResource(`/orders/${id}`, [revision]);
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const [payOpen, setPayOpen] = useState(params.get("pay") === "1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [cancelOpen, setCancelOpen] = useState(false);
  if (result.loading) return <Loading label="Opening your order…" />;
  if (result.error)
    return <ErrorState error={result.error} retry={result.reload} />;
  if (!result.data) return null;
  const order = result.data;
  const checkout = order.checkout || location.state?.checkout;
  const canPay =
    ["pending", "failed"].includes(order.payment_status) &&
    order.status !== "Cancelled" &&
    order.payment_method !== "cod";
  const canCancel =
    order.status === "Pending" && order.payment_status !== "paid";
  const closePay = () => {
    setPayOpen(false);
    setParams({}, { replace: true });
  };
  const settle = async (outcome) => {
    setBusy(true);
    setError("");
    try {
      await api(`/payments/mock/${order.id}`, {
        method: "POST",
        body: { outcome },
      });
      closePay();
      result.reload();
      refresh();
      notify(
        outcome === "success"
          ? "Simulated payment confirmed. No money was collected."
          : "Simulated payment failed. Your order remains available for review.",
        outcome === "success" ? "success" : "error",
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <BackLink to="/account/orders">Back to your orders</BackLink>
      <div className="order-detail-title">
        <div>
          <span className="eyebrow">{orderNumber(order.id)}</span>
          <h2>Your good things, on their way</h2>
          <p>Placed {dateTime(order.created_at)}</p>
        </div>
        <Badge>{order.status}</Badge>
      </div>
      <div className="order-status-strip">
        {["Pending", "Processing", "Shipped", "Delivered"].map(
          (status, index) => {
            const step = ["Pending", "Paid", "Processing"].includes(
              order.status,
            )
              ? order.status === "Processing"
                ? 1
                : 0
              : order.status === "Shipped"
                ? 2
                : order.status === "Delivered"
                  ? 3
                  : -1;
            return (
              <div key={status} className={index <= step ? "complete" : ""}>
                <span>{index <= step ? <Check size={14} /> : index + 1}</span>
                {status === "Pending" ? "Order placed" : status}
              </div>
            );
          },
        )}
      </div>
      {order.status === "Cancelled" && (
        <InlineNotice>
          This order is cancelled.{" "}
          {order.payment_status === "refund_required"
            ? "A payment was received. Contact the store about the refund."
            : "Reserved stock has been released."}
        </InlineNotice>
      )}
      {canPay && (
        <div className="payment-pending">
          <CreditCard size={25} />
          <div>
            <strong>Your payment needs a moment</strong>
            <p>
              {order.payment_method === "mock"
                ? "This is a local simulation. No real payment is taken."
                : "Finish your Razorpay test payment to confirm this order."}
            </p>
          </div>
          <button
            className="button primary small"
            onClick={() => setPayOpen(true)}
          >
            Complete payment
          </button>
        </div>
      )}
      <div className="order-detail-grid">
        <div>
          <section className="form-card">
            <h3>What’s in your order</h3>
            {(order.items || []).map((item) => (
              <div className="order-line-item" key={item.product_id || item.id}>
                <img
                  src={item.image || "/assets/product-placeholder.svg"}
                  alt={item.name}
                />
                <div>
                  <strong>{item.name}</strong>
                  <span>
                    {item.quantity} × {money(item.price)} · {item.unit}
                  </span>
                </div>
                <b>{money(item.price * item.quantity)}</b>
              </div>
            ))}
            <div className="summary-line">
              <span>Subtotal</span>
              <span>{money(order.subtotal ?? order.total)}</span>
            </div>
            <div className="summary-line">
              <span>Delivery</span>
              <span>{money(order.delivery_charge || 0)}</span>
            </div>
            <div className="summary-line total">
              <span>Order total</span>
              <span>{money(order.total)}</span>
            </div>
            <p className="muted">
              {order.payment_method === "cod"
                ? "Cash on delivery"
                : order.payment_method === "mock"
                  ? "Simulated payment"
                  : "Razorpay TEST"}{" "}
              · <Badge>{order.payment_status}</Badge>
            </p>
          </section>
          <section className="form-card">
            <h3>Delivery destination</h3>
            <p>{addressText(order.address)}</p>
            {(order.address?.phone || order.phone) && (
              <p>Delivery contact: {order.address?.phone || order.phone}</p>
            )}
            <DeliveryMap order={order} height={290} />
          </section>
        </div>
        <div>
          <section className="form-card">
            <h3>Order timeline</h3>
            {order.tracking && (
              <p className="tracking-reference">
                Tracking reference <strong>{order.tracking}</strong>
              </p>
            )}
            {order.delivery_notes && (
              <InlineNotice>{order.delivery_notes}</InlineNotice>
            )}
            <Timeline entries={order.timeline || []} />
          </section>
          <section className="form-card">
            <h3>Communication updates</h3>
            {order.notifications?.length ? (
              <div className="notification-mini">
                {order.notifications.map((item) => (
                  <div key={item.id}>
                    <span>
                      {item.channel}
                      <small>{item.event_key || item.event_type}</small>
                    </span>
                    <Badge>{item.status}</Badge>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">Notification updates will appear here.</p>
            )}
            {config.notifications?.mode !== "configured" && (
              <p className="muted">
                {config.notifications?.mode === "simulated"
                  ? "These are practice messages. No email or SMS is sent."
                  : "Email and SMS updates are currently unavailable. Check Your updates for order notifications."}
              </p>
            )}
          </section>
          {canCancel && (
            <button
              className="button secondary"
              onClick={() => setCancelOpen(true)}
            >
              Cancel pending order
            </button>
          )}
        </div>
      </div>
      {payOpen && canPay && (
        <Modal
          title={
            order.payment_method === "mock"
              ? "Simulated payment"
              : "Razorpay TEST payment"
          }
          onClose={closePay}
        >
          <p>
            {order.payment_method === "mock"
              ? "Choose a result to demonstrate the checkout flow. This local test does not collect money or contact a payment provider."
              : "You will open Razorpay Checkout in TEST mode. Use only test payment details."}
          </p>
          <p className="payment-modal-amount">{money(order.total)}</p>
          <FormError error={error} />
          {order.payment_method === "mock" ? (
            <div className="form-actions">
              <SubmitButton busy={busy} onClick={() => settle("success")}>
                Simulate success
              </SubmitButton>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => settle("failure")}
              >
                Simulate failure
              </button>
            </div>
          ) : (
            <SubmitButton
              busy={busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  const ready =
                    checkout ||
                    (
                      await api(`/orders/${order.id}/payment`, {
                        method: "POST",
                        body: {},
                      })
                    ).checkout;
                  const verification = await openRazorpay(
                    order,
                    ready,
                    settings.storeName || "Virar Organics",
                  );
                  closePay();
                  result.reload();
                  notify(
                    verification.status === "pending"
                      ? "Payment signature verified. Awaiting capture confirmation from Razorpay."
                      : "Test payment confirmed by the server.",
                  );
                } catch (err) {
                  setError(err.message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Open test checkout
            </SubmitButton>
          )}
          {order.payment_method === "razorpay" && !checkout && (
            <p className="muted">
              Opening checkout will retry the connection to Razorpay. Your saved
              order is retained if the provider is unavailable.
            </p>
          )}
        </Modal>
      )}
      {cancelOpen && (
        <Modal
          title="Cancel this pending order?"
          onClose={() => setCancelOpen(false)}
        >
          <p>
            The reserved products will become available to other shoppers. You
            can place a new order whenever you like.
          </p>
          <FormError error={error} />
          <div className="form-actions">
            <button
              className="button secondary"
              onClick={() => setCancelOpen(false)}
            >
              Keep order
            </button>
            <SubmitButton
              busy={busy}
              className="danger"
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await api(`/orders/${id}/cancel`, {
                    method: "POST",
                    body: {},
                  });
                  setCancelOpen(false);
                  result.reload();
                  refresh();
                  notify("Your order is cancelled.");
                } catch (err) {
                  setError(err.message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Cancel order
            </SubmitButton>
          </div>
        </Modal>
      )}
    </>
  );
}
export function BulkEnquiry() {
  const { user, notify } = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [received, setReceived] = useState(false);
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try {
      await api("/leads", {
        method: "POST",
        body: { ...values, quantity: Number(values.quantity) },
      });
      setReceived(true);
      notify("Your enquiry is with our team.");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="container section bulk-page">
      <div className="bulk-intro">
        <span className="eyebrow">GOOD THINGS, IN GOOD COMPANY</span>
        <h1>
          A bigger basket.
          <br />
          The same care.
        </h1>
        <p>
          Stocking a café, an office or a community kitchen? Tell us what you
          need and our team will help you find the right fit.
        </p>
        <div className="bulk-benefits">
          <div>
            <ShoppingBag />
            <span>
              <strong>For every kind of kitchen</strong>
              <small>Pantry staples and seasonal essentials</small>
            </span>
          </div>
          <div>
            <UserRound />
            <span>
              <strong>A real conversation</strong>
              <small>Our team follows up on your enquiry</small>
            </span>
          </div>
          <div>
            <Leaf />
            <span>
              <strong>Simple, thoughtful choices</strong>
              <small>Tell us the quantity and your timeline</small>
            </span>
          </div>
        </div>
      </div>
      <section className="form-card bulk-form">
        {user?.role !== "customer" ? (
          <EmptyState
            icon={UserRound}
            title="Let’s start with your account"
            message={
              user
                ? "Staff can create and manage enquiries in Store Studio."
                : "Sign in or create a customer account before sharing your bulk order details."
            }
            action={
              !user ? (
                <>
                  <Link
                    to="/login"
                    state={{ from: "/bulk" }}
                    className="button primary"
                  >
                    Sign in
                  </Link>
                  <Link
                    to="/register"
                    state={{ from: "/bulk" }}
                    className="button secondary"
                  >
                    Create account
                  </Link>
                </>
              ) : (
                <Link to="/admin/leads" className="button secondary">
                  Open leads & follow-ups
                </Link>
              )
            }
          />
        ) : received ? (
          <EmptyState
            icon={Check}
            title="Your enquiry has good roots"
            message="It has been added to our team's follow-up list. We’ll be in touch using the details you shared."
            action={
              <button
                className="button secondary"
                onClick={() => setReceived(false)}
              >
                Send another enquiry
              </button>
            }
          />
        ) : (
          <>
            <h2>Let’s talk about your order</h2>
            <p className="muted">A few details will help us get started.</p>
            <form className="form-stack" onSubmit={submit}>
              <div className="form-grid">
                <Field label="Full name">
                  <input
                    name="name"
                    defaultValue={user?.name}
                    required
                    maxLength={100}
                  />
                </Field>
                <Field label="Mobile number">
                  <input
                    name="phone"
                    defaultValue={user?.phone}
                    required
                    type="tel"
                    maxLength={30}
                  />
                </Field>
                <Field label="Email address" className="span-2">
                  <input
                    name="email"
                    defaultValue={user?.email}
                    type="email"
                    required
                    maxLength={190}
                  />
                </Field>
                <Field label="Product or collection">
                  <input
                    name="product"
                    required
                    placeholder="e.g. Rice and pulses"
                    maxLength={150}
                  />
                </Field>
                <Field label="Quantity (packs / units)">
                  <input
                    name="quantity"
                    required
                    type="number"
                    min="1"
                    max="100000"
                    placeholder="50"
                  />
                </Field>
                <Field label="Anything else we should know?" className="span-2">
                  <textarea
                    name="message"
                    rows={4}
                    placeholder="Delivery timeline, business name or special requests"
                    maxLength={2000}
                  />
                </Field>
              </div>
              <FormError error={error} />
              <SubmitButton busy={busy}>
                Send enquiry <ArrowRight size={17} />
              </SubmitButton>
              <p className="muted form-privacy">
                Your details are used to respond to this enquiry.
              </p>
            </form>
          </>
        )}
      </section>
    </div>
  );
}
export function AboutPage() {
  const { settings } = useStore();
  return (
    <div className="container section about-page">
      <PageHeading
        eyebrow="A LITTLE SOIL. A LITTLE SOUL."
        title={"Good things grow\nfrom simple beginnings."}
      />
      <div className="about-grid">
        <div className="about-art">
          <Sprout size={130} strokeWidth={0.8} />
          <span>
            Rooted in Virar.
            <br />
            <i>Chosen with care.</i>
          </span>
        </div>
        <div>
          <h2>Welcome to {settings.storeName || "Virar Organics"}.</h2>
          <div className="prose">
            {(
              settings.about ??
              `${settings.storeName || "Virar Organics"} is a neighbourhood organic food store in Virar, Mumbai. We bring together familiar pantry staples and thoughtful everyday choices.\n\nWe believe choosing good food should feel easy. Browse the collection, ask us about bulk orders, and make yourself at home.`
            )
              .split("\n")
              .filter(Boolean)
              .map((text, index) => (
                <p key={index}>{text}</p>
              ))}
          </div>
          <Link className="button primary" to="/shop">
            Find something good <ArrowRight size={17} />
          </Link>
        </div>
      </div>
      <FeatureStrip />
    </div>
  );
}
export function ContactPage() {
  const { settings } = useStore();
  return (
    <div className="container section contact-page">
      <PageHeading
        eyebrow="OUR DOOR IS OPEN"
        title="Come say hello."
        description="A question, a suggestion, or just a little pantry advice — we’d love to hear from you."
      />
      <div className="contact-grid">
        <section className="form-card">
          <div className="contact-item">
            <MapPin />
            <div>
              <h3>Find our store</h3>
              <p>{settings.address ?? "Virar West, Mumbai, Maharashtra"}</p>
            </div>
          </div>
          <div className="contact-item">
            <Phone />
            <div>
              <h3>Get in touch</h3>
              {settings.contactPhone && (
                <p>
                  <a
                    className="underlined"
                    href={`tel:${settings.contactPhone}`}
                  >
                    {settings.contactPhone}
                  </a>
                </p>
              )}
              {settings.contactEmail && (
                <p>
                  <a
                    className="underlined"
                    href={`mailto:${settings.contactEmail}`}
                  >
                    {settings.contactEmail}
                  </a>
                </p>
              )}
            </div>
          </div>
          <div className="contact-item">
            <Leaf />
            <div>
              <h3>Store hours</h3>
              <p>
                {settings.openingHours ?? "Monday – Saturday · 9 am – 7 pm"}
              </p>
            </div>
          </div>
          <Link to="/bulk" className="button secondary">
            Ask about a bulk order <ArrowRight size={17} />
          </Link>
        </section>
        <DeliveryMap height={430} />
      </div>
    </div>
  );
}
export function NotFound() {
  return (
    <div className="container section">
      <EmptyState
        icon={Sprout}
        title="This little path leads nowhere"
        message="The page may have moved. Let’s head back to the store."
        action={
          <Link to="/" className="button primary">
            Back to the store
          </Link>
        }
      />
    </div>
  );
}
