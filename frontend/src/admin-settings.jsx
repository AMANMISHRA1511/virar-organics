import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, ExternalLink, Plus, Save, Trash2 } from "lucide-react";
import { api } from "./api";
import { useStore } from "./context";
import { useResource } from "./hooks";
import {
  DeliveryMap,
  ErrorState,
  Field,
  FormError,
  ImageUpload,
  InlineNotice,
  Loading,
  PageHeading,
  SubmitButton,
} from "./components";

export function AdminSettings() {
  const { notify, refresh, loadPublic } = useStore();
  const result = useResource("/admin/settings");
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [uploads, setUploads] = useState(0);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("Home & brand");
  useEffect(() => {
    if (result.data)
      setForm({
        ...result.data,
        social: result.data.social || {},
        sections: result.data.sections || {
          featured: true,
          categories: true,
          about: true,
        },
        deliveryZones: result.data.deliveryZones || [],
      });
  }, [result.data]);
  const patch = (key, value) =>
    setForm((current) => ({ ...current, [key]: value }));
  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const body = {
        ...form,
        deliveryCharge: Number(form.deliveryCharge || 0),
        minimumOrder: Number(form.minimumOrder || 0),
        storeLat: Number(form.storeLat),
        storeLng: Number(form.storeLng),
        deliveryZones: form.deliveryZones.map((zone) => ({
          name: zone.name,
          pincodes: Array.isArray(zone.pincodes)
            ? zone.pincodes
            : String(zone.pincodes)
                .split(",")
                .map((value) => value.trim())
                .filter(Boolean),
        })),
      };
      await api("/admin/settings", { method: "PUT", body });
      await loadPublic();
      refresh();
      notify("Website settings saved. Your storefront is updated.");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  if (result.loading) return <Loading label="Loading website settings…" />;
  if (result.error)
    return <ErrorState error={result.error} retry={result.reload} />;
  if (!form) return null;
  return (
    <>
      <PageHeading
        eyebrow="MAKE YOUR STORE YOUR OWN"
        title="Website & settings"
        description="Manage the look, words and everyday details of your connected store."
        actions={
          <Link className="button secondary" to="/" target="_blank">
            Preview store <ExternalLink size={15} />
          </Link>
        }
      />
      <form onSubmit={save}>
        <div
          className="settings-tabs"
          role="tablist"
          aria-label="Settings sections"
        >
          {["Home & brand", "Story & contact", "Delivery & maps"].map(
            (value) => (
              <button
                type="button"
                role="tab"
                aria-selected={tab === value}
                key={value}
                onClick={() => setTab(value)}
                className={tab === value ? "active" : ""}
              >
                {value}
              </button>
            ),
          )}
        </div>
        <div className={tab === "Home & brand" ? "" : "hidden"}>
          <div className="editor-layout">
            <div>
              <section className="admin-card form-section">
                <h2>A warm welcome</h2>
                <Field label="Store name">
                  <input
                    value={form.storeName || "Virar Organics"}
                    onChange={(event) => patch("storeName", event.target.value)}
                    required
                    maxLength={100}
                  />
                </Field>
                <Field
                  label="Homepage heading"
                  hint="Line breaks can create a calm, editorial headline."
                >
                  <textarea
                    value={form.heading || ""}
                    onChange={(event) => patch("heading", event.target.value)}
                    required
                    maxLength={150}
                    rows={3}
                  />
                </Field>
                <Field label="Homepage description">
                  <textarea
                    value={form.description || ""}
                    onChange={(event) =>
                      patch("description", event.target.value)
                    }
                    maxLength={1000}
                    rows={3}
                  />
                </Field>
                <Field label="Announcement / promotional offer">
                  <input
                    value={form.promotion || ""}
                    onChange={(event) => patch("promotion", event.target.value)}
                    maxLength={250}
                  />
                </Field>
              </section>
              <section className="admin-card form-section">
                <h2>Homepage banner</h2>
                <p className="muted">
                  A landscape image works best in the welcome section. Use a
                  clear, well-lit photo with room around the subject.
                </p>
                <ImageUpload
                  images={form.banner ? [form.banner] : []}
                  multiple={false}
                  onChange={(images) => patch("banner", images[0] || "")}
                  label="Homepage banner"
                  disabled={busy}
                  onBusyChange={(active) =>
                    setUploads((count) =>
                      Math.max(0, count + (active ? 1 : -1)),
                    )
                  }
                />
              </section>
            </div>
            <aside>
              <section className="admin-card form-section">
                <h2>Your brand</h2>
                <ImageUpload
                  images={form.logo ? [form.logo] : []}
                  multiple={false}
                  onChange={(images) => patch("logo", images[0] || "")}
                  label="Website logo"
                  disabled={busy}
                  onBusyChange={(active) =>
                    setUploads((count) =>
                      Math.max(0, count + (active ? 1 : -1)),
                    )
                  }
                />
                <ImageUpload
                  images={form.favicon ? [form.favicon] : []}
                  multiple={false}
                  onChange={(images) => patch("favicon", images[0] || "")}
                  label="Favicon image"
                  disabled={busy}
                  onBusyChange={(active) =>
                    setUploads((count) =>
                      Math.max(0, count + (active ? 1 : -1)),
                    )
                  }
                />
              </section>
              <section className="admin-card form-section">
                <h2>Homepage sections</h2>
                {[
                  [
                    "categories",
                    "Collections",
                    "Help customers browse by category.",
                  ],
                  [
                    "featured",
                    "Store favourites",
                    "Show products marked as featured.",
                  ],
                  ["about", "Our story", "Share the story behind your store."],
                ].map(([key, label, hint]) => (
                  <label className="toggle-field" key={key}>
                    <span>
                      <strong>{label}</strong>
                      <small>{hint}</small>
                    </span>
                    <input
                      type="checkbox"
                      checked={form.sections[key] !== false}
                      onChange={(event) =>
                        patch("sections", {
                          ...form.sections,
                          [key]: event.target.checked,
                        })
                      }
                    />
                  </label>
                ))}
                <Link className="text-link" to="/admin/products">
                  Manage featured products <ArrowRight size={15} />
                </Link>
              </section>
            </aside>
          </div>
        </div>
        <div className={tab === "Story & contact" ? "" : "hidden"}>
          <div className="editor-layout">
            <div>
              <section className="admin-card form-section">
                <h2>The story behind your store</h2>
                <Field label="About us content">
                  <textarea
                    rows={10}
                    value={form.about || ""}
                    onChange={(event) => patch("about", event.target.value)}
                    maxLength={5000}
                  />
                </Field>
                <Field label="Footer content">
                  <textarea
                    rows={3}
                    value={form.footer || ""}
                    onChange={(event) => patch("footer", event.target.value)}
                    maxLength={1000}
                  />
                </Field>
              </section>
              <section className="admin-card form-section">
                <h2>Contact & store hours</h2>
                <div className="form-grid">
                  <Field label="Contact email">
                    <input
                      type="email"
                      value={form.contactEmail || ""}
                      onChange={(event) =>
                        patch("contactEmail", event.target.value)
                      }
                      maxLength={190}
                    />
                  </Field>
                  <Field label="Contact phone">
                    <input
                      type="tel"
                      value={form.contactPhone || ""}
                      onChange={(event) =>
                        patch("contactPhone", event.target.value)
                      }
                      maxLength={30}
                    />
                  </Field>
                  <Field label="Store address" className="span-2">
                    <textarea
                      value={form.address || ""}
                      onChange={(event) => patch("address", event.target.value)}
                      rows={3}
                      maxLength={500}
                    />
                  </Field>
                  <Field label="Opening hours" className="span-2">
                    <input
                      value={form.openingHours || ""}
                      onChange={(event) =>
                        patch("openingHours", event.target.value)
                      }
                      placeholder="Monday–Saturday, 9 am–7 pm"
                      maxLength={250}
                    />
                  </Field>
                </div>
              </section>
            </div>
            <aside>
              <section className="admin-card form-section">
                <h2>Social links</h2>
                {["instagram", "facebook"].map((name) => (
                  <Field
                    label={
                      name === "instagram" ? "Instagram URL" : "Facebook URL"
                    }
                    key={name}
                  >
                    <input
                      type="url"
                      value={form.social[name] || ""}
                      onChange={(event) =>
                        patch("social", {
                          ...form.social,
                          [name]: event.target.value,
                        })
                      }
                      placeholder={`https://${name}.com/your-store`}
                      maxLength={500}
                    />
                  </Field>
                ))}
                <p className="muted">
                  Leave a link blank to hide it from the footer.
                </p>
              </section>
            </aside>
          </div>
        </div>
        <div className={tab === "Delivery & maps" ? "" : "hidden"}>
          <div className="editor-layout">
            <div>
              <section className="admin-card form-section">
                <h2>Delivery areas</h2>
                <p className="muted">
                  Add area names and supported six-digit PIN codes. An empty
                  zone list leaves PIN-code restrictions off.
                </p>
                {form.deliveryZones.map((zone, index) => (
                  <div className="zone-row" key={index}>
                    <Field label={`Zone ${index + 1} name`}>
                      <input
                        required
                        value={zone.name}
                        maxLength={100}
                        onChange={(event) =>
                          patch(
                            "deliveryZones",
                            form.deliveryZones.map((value, at) =>
                              at === index
                                ? { ...value, name: event.target.value }
                                : value,
                            ),
                          )
                        }
                        placeholder="Virar West"
                      />
                    </Field>
                    <Field label="PIN codes, separated by commas">
                      <input
                        value={
                          Array.isArray(zone.pincodes)
                            ? zone.pincodes.join(", ")
                            : zone.pincodes
                        }
                        onChange={(event) =>
                          patch(
                            "deliveryZones",
                            form.deliveryZones.map((value, at) =>
                              at === index
                                ? { ...value, pincodes: event.target.value }
                                : value,
                            ),
                          )
                        }
                        placeholder="401303, 401305"
                      />
                    </Field>
                    <button
                      type="button"
                      className="icon-button danger-text"
                      aria-label={`Remove zone ${index + 1}`}
                      onClick={() =>
                        patch(
                          "deliveryZones",
                          form.deliveryZones.filter((_, at) => at !== index),
                        )
                      }
                    >
                      <Trash2 size={17} />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="button secondary"
                  onClick={() =>
                    patch("deliveryZones", [
                      ...form.deliveryZones,
                      { name: "", pincodes: [] },
                    ])
                  }
                >
                  <Plus size={16} />
                  Add delivery zone
                </button>
              </section>
              <section className="admin-card form-section">
                <h2>Store location</h2>
                <p className="muted">
                  These coordinates appear as the store pin on delivery and
                  contact maps.
                </p>
                <div className="form-grid">
                  <Field label="Store latitude">
                    <input
                      required
                      type="number"
                      step="any"
                      min="-90"
                      max="90"
                      value={form.storeLat ?? ""}
                      onChange={(event) =>
                        patch("storeLat", event.target.value)
                      }
                    />
                  </Field>
                  <Field label="Store longitude">
                    <input
                      required
                      type="number"
                      step="any"
                      min="-180"
                      max="180"
                      value={form.storeLng ?? ""}
                      onChange={(event) =>
                        patch("storeLng", event.target.value)
                      }
                    />
                  </Field>
                </div>
                {tab === "Delivery & maps" && (
                  <DeliveryMap
                    storeLocation={{
                      latitude: form.storeLat,
                      longitude: form.storeLng,
                    }}
                    editable
                    onPick={({ lat, lng }) =>
                      setForm((current) => ({
                        ...current,
                        storeLat: lat,
                        storeLng: lng,
                      }))
                    }
                    height={300}
                  />
                )}
              </section>
            </div>
            <aside>
              <section className="admin-card form-section">
                <h2>Order settings</h2>
                <Field label="Delivery charge (₹)">
                  <input
                    required
                    type="number"
                    step="0.01"
                    min="0"
                    max="10000"
                    value={form.deliveryCharge ?? 0}
                    onChange={(event) =>
                      patch("deliveryCharge", event.target.value)
                    }
                  />
                </Field>
                <Field label="Minimum order subtotal (₹)">
                  <input
                    required
                    type="number"
                    step="0.01"
                    min="0"
                    max="100000"
                    value={form.minimumOrder ?? 0}
                    onChange={(event) =>
                      patch("minimumOrder", event.target.value)
                    }
                  />
                </Field>
                <p className="muted">
                  The backend checks these amounts again before creating every
                  order.
                </p>
              </section>
              <section className="admin-card form-section">
                <h2>Map display</h2>
                <label className="toggle-field">
                  <span>
                    <strong>Show maps</strong>
                    <small>
                      Customers see only their own order destination.
                    </small>
                  </span>
                  <input
                    type="checkbox"
                    checked={form.mapEnabled !== false}
                    onChange={(event) =>
                      patch("mapEnabled", event.target.checked)
                    }
                  />
                </label>
                <InlineNotice>
                  Public OpenStreetMap tiles need an internet connection.
                  Private provider credentials belong in the backend
                  environment, never in this form.
                </InlineNotice>
                <p className="muted">
                  If maps are unavailable, addresses, order status and the
                  timeline still work.
                </p>
              </section>
            </aside>
          </div>
        </div>
        <div className="settings-save">
          <FormError error={error} />
          <span>Changes appear on the connected storefront after saving.</span>
          <SubmitButton busy={busy} disabled={uploads > 0}>
            <Save size={17} />
            Save website settings
          </SubmitButton>
        </div>
      </form>
    </>
  );
}
