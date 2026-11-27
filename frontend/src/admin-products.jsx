import React, { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ExternalLink,
  Image,
  Package,
  Pencil,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { api, imagesOf, listOf, makeQuery, money, priceOf } from "./api";
import { useStore } from "./context";
import { useDebounced, useResource } from "./hooks";
import {
  BackLink,
  Badge,
  ConfirmAction,
  EmptyState,
  ErrorState,
  Field,
  FormError,
  ImageUpload,
  InlineNotice,
  Loading,
  Modal,
  PageHeading,
  Pagination,
  ProductImage,
  SearchBox,
  SubmitButton,
} from "./components";

export function AdminProducts() {
  const { revision, notify, refresh } = useStore();
  const [search, setSearch] = useState("");
  const q = useDebounced(search);
  const [category, setCategory] = useState("");
  const [active, setActive] = useState("");
  const [sort, setSort] = useState("newest");
  const [page, setPage] = useState(1);
  const [deleting, setDeleting] = useState(null);
  const cats = useResource("/admin/categories", [revision]);
  const result = useResource(
    `/admin/products?${makeQuery({ q, category, active, sort, page, limit: 15 })}`,
    [revision],
  );
  useEffect(() => setPage(1), [q, category, active, sort]);
  return (
    <>
      <PageHeading
        eyebrow="GOOD THINGS ON YOUR SHELVES"
        title="Products"
        description="Build your collection, keep stock in check, and make each product feel at home."
        actions={
          <Link className="button primary" to="/admin/products/new">
            <Plus size={17} />
            Add product
          </Link>
        }
      />
      <section className="admin-card">
        <div className="admin-toolbar">
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder="Search products…"
            label="Search products"
          />
          <select
            aria-label="Filter by category"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          >
            <option value="">All categories</option>
            {listOf(cats.data).map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by visibility"
            value={active}
            onChange={(event) => setActive(event.target.value)}
          >
            <option value="">All products</option>
            <option value="1">Active</option>
            <option value="0">Inactive</option>
          </select>
          <select
            aria-label="Sort products"
            value={sort}
            onChange={(event) => setSort(event.target.value)}
          >
            <option value="newest">Newest first</option>
            <option value="name">Name A–Z</option>
            <option value="price_asc">Price low–high</option>
            <option value="price_desc">Price high–low</option>
          </select>
        </div>
        {result.loading ? (
          <Loading />
        ) : result.error ? (
          <ErrorState error={result.error} retry={result.reload} />
        ) : listOf(result.data).length ? (
          <>
            <div className="table-scroll">
              <table className="products-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Category</th>
                    <th>Price</th>
                    <th>Stock</th>
                    <th>Visibility</th>
                    <th>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {listOf(result.data).map((product) => (
                    <tr key={product.id}>
                      <td>
                        <Link
                          to={`/admin/products/${product.id}`}
                          className="table-product"
                        >
                          <ProductImage product={product} />
                          <span>
                            <strong>{product.name}</strong>
                            <small>
                              {product.unit}
                              {product.featured ? " · Featured" : ""}
                            </small>
                          </span>
                        </Link>
                      </td>
                      <td>
                        {product.category ||
                          listOf(cats.data).find(
                            (item) => item.id === product.category_id,
                          )?.name ||
                          "Uncategorized"}
                      </td>
                      <td className="nowrap">
                        <strong>{money(priceOf(product))}</strong>
                        {product.sale_price !== null &&
                          product.sale_price !== undefined && (
                            <small>
                              <del>{money(product.price)}</del>
                            </small>
                          )}
                      </td>
                      <td>
                        <Badge
                          variant={
                            product.stock > 5
                              ? "active"
                              : product.stock
                                ? "pending"
                                : "failed"
                          }
                        >
                          {product.stock} units
                        </Badge>
                      </td>
                      <td>
                        <Badge variant={product.active ? "active" : "neutral"}>
                          {product.active ? "Active" : "Inactive"}
                        </Badge>
                      </td>
                      <td>
                        <div className="table-actions">
                          <Link
                            className="icon-button"
                            to={`/admin/products/${product.id}`}
                            aria-label={`Edit ${product.name}`}
                          >
                            <Pencil size={17} />
                          </Link>
                          <button
                            className="icon-button danger-text"
                            onClick={() => setDeleting(product)}
                            aria-label={`Delete or deactivate ${product.name}`}
                          >
                            <Trash2 size={17} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="table-bottom">
              <span>{result.data.total} products</span>
              <Pagination
                page={page}
                total={result.data.total}
                limit={15}
                onPage={setPage}
              />
            </div>
          </>
        ) : (
          <EmptyState
            icon={Package}
            title="No products in this view"
            message="Try another filter, or add something new to your pantry."
            action={
              <Link className="button primary" to="/admin/products/new">
                Add product
              </Link>
            }
          />
        )}
      </section>
      {deleting && (
        <Modal
          title={`Manage ${deleting.name}`}
          onClose={() => setDeleting(null)}
        >
          <p>
            Deactivate to hide this product while keeping its order history.
            Permanent deletion is only available when the product has never been
            ordered.
          </p>
          <ProductDelete
            product={deleting}
            onDone={() => {
              setDeleting(null);
              result.reload();
              refresh();
              notify("Product updated.");
            }}
          />
        </Modal>
      )}
    </>
  );
}
function ProductDelete({ product, onDone }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const remove = async (permanent) => {
    setBusy(true);
    setError("");
    try {
      await api(`/admin/products/${product.id}`, {
        method: "DELETE",
        body: { permanent },
      });
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <FormError error={error} />
      <div className="form-actions">
        <SubmitButton busy={busy} onClick={() => remove(false)}>
          Deactivate product
        </SubmitButton>
        <button
          className="button danger"
          disabled={busy}
          onClick={() => remove(true)}
        >
          Delete permanently
        </button>
      </div>
    </>
  );
}
const emptyProduct = {
  name: "",
  description: "",
  price: "",
  sale_price: "",
  unit: "1 kg",
  stock: 0,
  category_id: "",
  images: [],
  active: true,
  featured: false,
};
export function AdminProductEditor() {
  const { id } = useParams();
  const creating = !id || id === "new";
  const { revision, notify, refresh } = useStore();
  const navigate = useNavigate();
  const [product, setProduct] = useState(emptyProduct);
  const [originalStock, setOriginalStock] = useState(null);
  const [stockConflict, setStockConflict] = useState(false);
  const [loading, setLoading] = useState(!creating);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploads, setUploads] = useState(0);
  const cats = useResource("/admin/categories", [revision]);
  useEffect(() => {
    if (creating) {
      setProduct({ ...emptyProduct });
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    api(`/admin/products/${id}`)
      .then((item) => {
        if (active) {
          setOriginalStock(Number(item.stock));
          setProduct({
            ...item,
            images: imagesOf(item),
            sale_price: item.sale_price ?? "",
            active: Boolean(item.active),
            featured: Boolean(item.featured),
          });
        }
      })
      .catch((err) => {
        if (active) setError(err.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [id, creating]);
  const patch = (key, value) =>
    setProduct((current) => ({ ...current, [key]: value }));
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (
        product.sale_price !== "" &&
        Number(product.sale_price) >= Number(product.price)
      )
        throw new Error("The sale price must be lower than the regular price.");
      const body = {
        ...product,
        id: creating ? undefined : Number(id),
        price: Number(product.price),
        sale_price:
          product.sale_price === "" ? null : Number(product.sale_price),
        stock: Number(product.stock),
        expected_stock: creating ? undefined : originalStock,
        category_id: product.category_id ? Number(product.category_id) : null,
      };
      await api("/admin/products", { method: "POST", body });
      refresh();
      notify(
        creating ? "Product added to your pantry." : "Product changes saved.",
      );
      navigate("/admin/products");
    } catch (err) {
      setStockConflict(err.code === "STOCK_CHANGED");
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <BackLink to="/admin/products">All products</BackLink>
      <PageHeading
        eyebrow="TELL THE STORY OF SOMETHING GOOD"
        title={creating ? "Add a product" : "Edit product"}
        description="Clear details and thoughtful images help customers choose with confidence."
        actions={
          !creating && product.active ? (
            <Link
              className="button secondary"
              to={`/products/${id}`}
              target="_blank"
            >
              View in store <ExternalLink size={15} />
            </Link>
          ) : null
        }
      />
      {loading ? (
        <Loading />
      ) : (
        <form onSubmit={submit} className="editor-layout">
          <div>
            <section className="admin-card form-section">
              <h2>Product details</h2>
              <Field label="Product name">
                <input
                  name="name"
                  required
                  maxLength={150}
                  value={product.name}
                  onChange={(event) => patch("name", event.target.value)}
                  placeholder="e.g. Organic Ragi Flour"
                />
              </Field>
              <Field
                label="Description"
                hint="Tell customers what makes it useful, how to store it, or how to enjoy it."
              >
                <textarea
                  name="description"
                  rows={5}
                  required
                  maxLength={5000}
                  value={product.description}
                  onChange={(event) => patch("description", event.target.value)}
                />
              </Field>
              <div className="form-grid">
                <Field label="Category">
                  <select
                    name="category_id"
                    value={product.category_id || ""}
                    onChange={(event) =>
                      patch("category_id", event.target.value)
                    }
                    required
                  >
                    <option value="">Choose a category</option>
                    {listOf(cats.data).map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                        {!item.active ? " (inactive)" : ""}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field
                  label="Pack size / unit"
                  hint="Examples: 1 kg, 500 g, 1 litre, 1 packet."
                >
                  <input
                    name="unit"
                    required
                    maxLength={40}
                    value={product.unit}
                    onChange={(event) => patch("unit", event.target.value)}
                  />
                </Field>
              </div>
            </section>
            <section className="admin-card form-section">
              <h2>Product images</h2>
              <p className="muted">
                The first image appears on the product card. Customers can
                explore the full gallery on the product page.
              </p>
              <ImageUpload
                images={product.images}
                onChange={(images) => patch("images", images)}
                label="Product images"
                disabled={busy}
                onBusyChange={(active) =>
                  setUploads((count) => Math.max(0, count + (active ? 1 : -1)))
                }
              />
            </section>
          </div>
          <aside>
            <section className="admin-card form-section">
              <h2>Pricing & stock</h2>
              <Field label="Regular price (₹)">
                <input
                  name="price"
                  type="number"
                  min="0.01"
                  max="1000000"
                  step="0.01"
                  required
                  value={product.price}
                  onChange={(event) => patch("price", event.target.value)}
                />
              </Field>
              <Field
                label="Sale price (₹)"
                hint="Leave blank if there is no discount."
              >
                <input
                  name="sale_price"
                  type="number"
                  min="0.01"
                  max="1000000"
                  step="0.01"
                  value={product.sale_price}
                  onChange={(event) => patch("sale_price", event.target.value)}
                />
              </Field>
              <Field label="Available stock (packs / units)">
                <input
                  name="stock"
                  type="number"
                  min="0"
                  max="1000000"
                  step="1"
                  required
                  value={product.stock}
                  onChange={(event) => patch("stock", event.target.value)}
                />
              </Field>
            </section>
            <section className="admin-card form-section">
              <h2>Storefront visibility</h2>
              <label className="toggle-field">
                <span>
                  <strong>Active product</strong>
                  <small>Customers can find and buy this item.</small>
                </span>
                <input
                  type="checkbox"
                  checked={product.active}
                  onChange={(event) => patch("active", event.target.checked)}
                />
              </label>
              <label className="toggle-field">
                <span>
                  <strong>Store favourite</strong>
                  <small>Feature this item on the homepage.</small>
                </span>
                <input
                  type="checkbox"
                  checked={product.featured}
                  onChange={(event) => patch("featured", event.target.checked)}
                />
              </label>
              <FormError error={error} />
              {stockConflict && (
                <button
                  type="button"
                  className="button secondary full"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      const latest = await api(`/admin/products/${id}`);
                      setOriginalStock(Number(latest.stock));
                      setProduct((current) => ({
                        ...current,
                        stock: Number(latest.stock),
                      }));
                      setStockConflict(false);
                      setError("");
                      notify(
                        "Current stock loaded. Review the quantity and save again; your other edits are kept.",
                      );
                    } catch (error) {
                      setError(error.message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Load current stock
                </button>
              )}
              <SubmitButton
                busy={busy}
                disabled={uploads > 0}
                className="primary full"
              >
                <Save size={17} />
                {creating ? "Save product" : "Save changes"}
              </SubmitButton>
              <Link className="button secondary full" to="/admin/products">
                Cancel
              </Link>
            </section>
          </aside>
        </form>
      )}
    </>
  );
}
export function AdminCategories() {
  const { revision, notify, refresh } = useStore();
  const result = useResource("/admin/categories", [revision]);
  const [edit, setEdit] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);
  const [uploads, setUploads] = useState(0);
  const [error, setError] = useState("");
  const open = (item) => {
    setEdit(
      item
        ? { ...item, active: Boolean(item.active) }
        : { name: "", description: "", image: "", active: true },
    );
    setError("");
  };
  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/admin/categories", { method: "POST", body: edit });
      setEdit(null);
      result.reload();
      refresh();
      notify("Category saved.");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeading
        eyebrow="A PLACE FOR EVERYTHING"
        title="Categories"
        description="Help customers find their way around your pantry."
        actions={
          <button className="button primary" onClick={() => open()}>
            <Plus size={17} />
            Add category
          </button>
        }
      />
      {result.loading ? (
        <Loading />
      ) : result.error ? (
        <ErrorState error={result.error} retry={result.reload} />
      ) : (
        <div className="admin-category-grid">
          {listOf(result.data).map((item) => (
            <article className="admin-card category-manage-card" key={item.id}>
              <div className="category-manage-image">
                {item.image ? (
                  <img src={item.image} alt={item.name} />
                ) : (
                  <Image size={42} strokeWidth={1} />
                )}
                <Badge variant={item.active ? "active" : "neutral"}>
                  {item.active ? "Active" : "Hidden"}
                </Badge>
              </div>
              <div className="category-manage-body">
                <h2>{item.name}</h2>
                <p>
                  {item.description || "Add a helpful collection description."}
                </p>
                <div className="form-actions">
                  <button
                    className="button secondary small"
                    onClick={() => open(item)}
                  >
                    <Pencil size={15} />
                    Edit category
                  </button>
                  <button
                    className="icon-button danger-text"
                    onClick={() => setDeleting(item)}
                    aria-label={`Delete ${item.name}`}
                  >
                    <Trash2 size={17} />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
      {edit && (
        <Modal
          title={edit.id ? "Edit category" : "Add category"}
          onClose={() => setEdit(null)}
        >
          <form className="form-stack" onSubmit={save}>
            <Field label="Category name">
              <input
                required
                maxLength={100}
                value={edit.name}
                onChange={(event) =>
                  setEdit({ ...edit, name: event.target.value })
                }
              />
            </Field>
            <Field label="Description">
              <textarea
                rows={3}
                maxLength={1000}
                value={edit.description || ""}
                onChange={(event) =>
                  setEdit({ ...edit, description: event.target.value })
                }
              />
            </Field>
            <ImageUpload
              multiple={false}
              images={edit.image ? [edit.image] : []}
              onChange={(images) =>
                setEdit({ ...edit, image: images[0] || "" })
              }
              label="Category image"
              onBusyChange={(active) =>
                setUploads((count) => Math.max(0, count + (active ? 1 : -1)))
              }
            />
            <label className="check-field">
              <input
                type="checkbox"
                checked={edit.active}
                onChange={(event) =>
                  setEdit({ ...edit, active: event.target.checked })
                }
              />
              <span>Show this category in the store</span>
            </label>
            <FormError error={error} />
            <SubmitButton busy={busy} disabled={uploads > 0}>
              Save category
            </SubmitButton>
          </form>
        </Modal>
      )}
      {deleting && (
        <ConfirmAction
          title="Delete this category?"
          message={`“${deleting.name}” can only be deleted when no products use it. Hide it instead if you want to keep its products.`}
          confirmText="Delete category"
          danger
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await api(`/admin/categories/${deleting.id}`, {
              method: "DELETE",
              body: {},
            });
            result.reload();
            refresh();
            notify("Unused category deleted.");
          }}
        />
      )}
    </>
  );
}
export function AdminMedia() {
  const { revision, notify } = useStore();
  const result = useResource("/admin/uploads", [revision]);
  const [fresh, setFresh] = useState([]);
  const [deleting, setDeleting] = useState(null);
  const media = listOf(result.data);
  return (
    <>
      <PageHeading
        eyebrow="PICTURES WITH A PURPOSE"
        title="Media library"
        description="Upload your store images once and keep track of the files on disk."
      />
      <section className="admin-card form-section">
        <ImageUpload
          images={fresh}
          onChange={(images) => {
            setFresh(images);
            result.reload();
          }}
          label="New images"
        />
        <InlineNotice>
          Removing a preview only changes this selection. Delete a file below to
          remove it from disk. Images still used by products, categories or
          website settings are protected.
        </InlineNotice>
      </section>
      {result.loading ? (
        <Loading />
      ) : result.error ? (
        <ErrorState error={result.error} retry={result.reload} />
      ) : media.length ? (
        <div className="media-grid">
          {media.map((item) => {
            const url =
              item.url || item.path || `/uploads/${item.filename || item.name}`;
            const filename = item.filename || item.name || url.split("/").pop();
            return (
              <article
                className="admin-card media-item"
                key={item.id || filename}
              >
                <a href={url} target="_blank" rel="noreferrer">
                  <img src={url} alt={item.original_name || filename} />
                </a>
                <div>
                  <strong title={filename}>{filename}</strong>
                  <span>
                    {item.size
                      ? `${Math.round(item.size / 1024)} KB`
                      : item.size_bytes
                        ? `${Math.round(item.size_bytes / 1024)} KB`
                        : "Stored image"}
                    {item.width ? ` · ${item.width} × ${item.height}` : ""}
                  </span>
                  <div className="form-actions">
                    <a
                      className="button secondary small"
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View <ExternalLink size={13} />
                    </a>
                    <button
                      className="icon-button danger-text"
                      aria-label={`Delete ${filename}`}
                      onClick={() => setDeleting({ ...item, filename })}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={Image}
          title="An empty album, for now"
          message="Upload a few images to bring your store to life."
        />
      )}
      {deleting && (
        <ConfirmAction
          title="Delete this image from disk?"
          message="The server will first check that no saved product, category or website setting uses this file. This removes the uploaded image permanently."
          confirmText="Delete image"
          danger
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await api(
              `/admin/uploads/${encodeURIComponent(deleting.filename)}`,
              { method: "DELETE", body: {} },
            );
            result.reload();
            setFresh((items) =>
              items.filter((url) => !url.endsWith(deleting.filename)),
            );
            notify("Unused image deleted.");
          }}
        />
      )}
    </>
  );
}
