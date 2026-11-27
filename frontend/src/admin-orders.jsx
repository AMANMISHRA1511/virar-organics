import React, { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowRight, Bell, MapPin, Package, Save } from "lucide-react";
import {
  api,
  addressText,
  dateTime,
  listOf,
  makeQuery,
  money,
  orderNumber,
} from "./api";
import { useStore } from "./context";
import { useDebounced, useResource } from "./hooks";
import {
  BackLink,
  Badge,
  CsvLink,
  DeliveryMap,
  EmptyState,
  ErrorState,
  Field,
  FormError,
  InlineNotice,
  Loading,
  PageHeading,
  Pagination,
  SearchBox,
  SubmitButton,
  Timeline,
} from "./components";

export function AdminOrders() {
  const { revision } = useStore();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounced(search);
  const q = /^MM-0*\d+$/i.test(debouncedSearch)
    ? String(Number(debouncedSearch.replace(/^MM-/i, "")))
    : debouncedSearch;
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const query = makeQuery({ q, status });
  const result = useResource(`/admin/orders?${query}&page=${page}&limit=15`, [
    revision,
  ]);
  useEffect(() => setPage(1), [q, status]);
  return (
    <>
      <PageHeading
        eyebrow="FROM YOUR PANTRY TO THEIR DOOR"
        title="Orders"
        description="Keep every order moving, with clear updates along the way."
        actions={<CsvLink href={`/admin/orders/export?${query}`} />}
      />
      <section className="admin-card">
        <div className="admin-toolbar">
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder="Search customer or order number…"
            label="Search orders"
          />
          <select
            aria-label="Filter order status"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="">Every status</option>
            {[
              "Pending",
              "Paid",
              "Processing",
              "Shipped",
              "Delivered",
              "Cancelled",
            ].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </div>
        {result.loading ? (
          <Loading />
        ) : result.error ? (
          <ErrorState error={result.error} retry={result.reload} />
        ) : listOf(result.data).length ? (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Customer</th>
                    <th>Status</th>
                    <th>Payment</th>
                    <th>Total</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {listOf(result.data).map((order) => (
                    <tr key={order.id}>
                      <td>
                        <Link
                          className="table-link"
                          to={`/admin/orders/${order.id}`}
                        >
                          {orderNumber(order.id)}
                        </Link>
                        <small>{dateTime(order.created_at)}</small>
                      </td>
                      <td>
                        <strong>{order.name || order.customer_name}</strong>
                        <small>{order.email}</small>
                      </td>
                      <td>
                        <Badge>{order.status}</Badge>
                      </td>
                      <td>
                        <Badge>{order.payment_status}</Badge>
                        <small>
                          {order.payment_method === "mock"
                            ? "Simulation"
                            : order.payment_method?.toUpperCase()}
                        </small>
                      </td>
                      <td className="nowrap">{money(order.total)}</td>
                      <td>
                        <Link
                          className="icon-button"
                          to={`/admin/orders/${order.id}`}
                          aria-label={`View order ${order.id}`}
                        >
                          <ArrowRight size={18} />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="table-bottom">
              <span>{result.data.total} orders</span>
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
            title="No orders in this view"
            message="Try another search or status filter."
          />
        )}
      </section>
    </>
  );
}
export function AdminOrderDetail() {
  const { id } = useParams();
  const { revision, notify, refresh } = useStore();
  const result = useResource(`/admin/orders/${id}`, [revision]);
  const [form, setForm] = useState(null);
  const dirty = useRef(false);
  const driverDirty = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [driver, setDriver] = useState({ latitude: "", longitude: "" });
  const [driverBusy, setDriverBusy] = useState(false);
  const [driverError, setDriverError] = useState("");
  useEffect(() => {
    if (!result.data) return;
    const order = result.data;
    if (!dirty.current)
      setForm({
        status: order.status,
        tracking: order.tracking || "",
        delivery_notes: order.delivery_notes || "",
        latitude: order.latitude ?? "",
        longitude: order.longitude ?? "",
      });
    if (!driverDirty.current)
      setDriver({
        latitude: order.driver_lat ?? "",
        longitude: order.driver_lng ?? "",
      });
  }, [result.data]);
  const patch = (key, value) => {
    dirty.current = true;
    setForm((current) => ({ ...current, [key]: value }));
  };
  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const body = {
        ...form,
        latitude: form.latitude === "" ? null : Number(form.latitude),
        longitude: form.longitude === "" ? null : Number(form.longitude),
      };
      await api(`/admin/orders/${id}`, { method: "PATCH", body });
      dirty.current = false;
      result.reload();
      refresh();
      notify("Order updated. The customer’s timeline is current.");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  if (result.loading) return <Loading label="Opening order details…" />;
  if (result.error)
    return <ErrorState error={result.error} retry={result.reload} />;
  if (!result.data || !form) return null;
  const order = result.data;
  const next =
    {
      Pending:
        order.payment_method !== "cod" && order.payment_status !== "paid"
          ? ["Cancelled"]
          : ["Processing", "Cancelled"],
      Paid: ["Processing", "Cancelled"],
      Processing: ["Shipped", "Cancelled"],
      Shipped: ["Delivered"],
      Delivered: [],
      Cancelled: [],
    }[order.status] || [];
  return (
    <>
      <BackLink to="/admin/orders">All orders</BackLink>
      <PageHeading
        eyebrow={orderNumber(order.id)}
        title={`An order for ${order.name?.split(" ")[0] || "your customer"}`}
        description={`Placed ${dateTime(order.created_at)} · ${order.payment_method === "mock" ? "Simulated online payment" : order.payment_method === "cod" ? "Cash on delivery" : "Razorpay TEST"}`}
        actions={<><Badge>{order.status}</Badge><Link to={`/invoice/${order.id}`} className="button secondary small">View bill</Link><a href={`/api/orders/${order.id}/bill.pdf`} className="button secondary small">Download PDF</a></>}
      />
      <div className="editor-layout order-editor">
        <div>
          <section className="admin-card form-section">
            <h2>Order contents</h2>
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
                <b>{money(item.quantity * item.price)}</b>
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
              <span>Total</span>
              <span>{money(order.total)}</span>
            </div>
            <div className="summary-line">
              <span>Payment status</span>
              <Badge>{order.payment_status}</Badge>
            </div>
            {order.payment_status === "refund_required" && (
              <InlineNotice>
                Payment was received for a cancelled order. Review and process
                the refund with the provider; this application does not
                automatically issue refunds.
              </InlineNotice>
            )}
          </section>
          <section className="admin-card form-section">
            <h2>Customer & delivery</h2>
            <div className="customer-details">
              <div>
                <strong>{order.name}</strong>
                <p>{order.email}</p>
                <p>{order.phone}</p>
              </div>
              <div>
                <span className="eyebrow">DELIVERY ADDRESS</span>
                <p>{addressText(order.address)}</p>
                <p>
                  Delivery contact:{" "}
                  {order.address?.phone || order.phone || "Not provided"}
                </p>
              </div>
            </div>
            <DeliveryMap
              order={{
                ...order,
                latitude: form.latitude === "" ? undefined : form.latitude,
                longitude: form.longitude === "" ? undefined : form.longitude,
              }}
              editable
              onPick={({ lat, lng }) => {
                dirty.current = true;
                setForm((current) => ({
                  ...current,
                  latitude: lat,
                  longitude: lng,
                }));
              }}
              height={300}
            />
          </section>
          <section className="admin-card form-section">
            <h2>Order timeline</h2>
            <Timeline entries={order.timeline || []} />
          </section>
          <section className="admin-card form-section">
            <h2>Notification history</h2>
            {order.notifications?.length ? (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Channel</th>
                      <th>Event</th>
                      <th>Status</th>
                      <th>Attempts</th>
                    </tr>
                  </thead>
                  <tbody>
                    {order.notifications.map((notification) => (
                      <tr key={notification.id}>
                        <td>{notification.channel}</td>
                        <td>
                          {notification.event_key || notification.event_type}
                          <small>{dateTime(notification.created_at)}</small>
                        </td>
                        <td>
                          <Badge>{notification.status}</Badge>
                          {notification.error && (
                            <small className="danger-text">
                              {notification.error}
                            </small>
                          )}
                        </td>
                        <td>{notification.attempts}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted">
                Notification records will appear after order events.
              </p>
            )}
          </section>
        </div>
        <aside>
          <form className="admin-card form-section" onSubmit={save}>
            <h2>Keep the customer updated</h2>
            <Field label="Order status">
              <select
                value={form.status}
                onChange={(event) => patch("status", event.target.value)}
              >
                {[order.status, ...next].map((status) => (
                  <option key={status}>{status}</option>
                ))}
              </select>
            </Field>
            {form.status === "Cancelled" && order.status !== "Cancelled" && (
              <InlineNotice>
                Cancellation releases reserved stock once. Any received payment
                requires a separate refund review.
              </InlineNotice>
            )}
            <Field label="Shipment tracking reference">
              <input
                value={form.tracking}
                onChange={(event) => patch("tracking", event.target.value)}
                maxLength={150}
                placeholder="e.g. VO-VIRAR-2048"
              />
            </Field>
            <Field
              label="Delivery notes"
              hint="Shown to the customer with their order."
            >
              <textarea
                rows={3}
                value={form.delivery_notes}
                onChange={(event) =>
                  patch("delivery_notes", event.target.value)
                }
                maxLength={1000}
              />
            </Field>
            <div className="form-grid">
              <Field label="Destination latitude">
                <input
                  type="number"
                  step="any"
                  min="-90"
                  max="90"
                  value={form.latitude}
                  onChange={(event) => patch("latitude", event.target.value)}
                />
              </Field>
              <Field label="Destination longitude">
                <input
                  type="number"
                  step="any"
                  min="-180"
                  max="180"
                  value={form.longitude}
                  onChange={(event) => patch("longitude", event.target.value)}
                />
              </Field>
            </div>
            <FormError error={error} />
            <SubmitButton busy={busy}>
              <Save size={17} />
              Save order update
            </SubmitButton>
          </form>
          <form
            className="admin-card form-section"
            onSubmit={async (event) => {
              event.preventDefault();
              setDriverBusy(true);
              setDriverError("");
              try {
                await api(`/admin/orders/${id}/driver-location`, {
                  method: "POST",
                  body: {
                    latitude: Number(driver.latitude),
                    longitude: Number(driver.longitude),
                    source: "manual",
                  },
                });
                driverDirty.current = false;
                result.reload();
                refresh();
                notify("Manual delivery location recorded.");
              } catch (err) {
                setDriverError(err.message);
              } finally {
                setDriverBusy(false);
              }
            }}
          >
            <h2>Manual delivery location</h2>
            <p className="muted">
              Record a known courier position. This is labelled as a manual
              update, not a live GPS feed.
            </p>
            <Field label="Courier latitude">
              <input
                required
                type="number"
                step="any"
                min="-90"
                max="90"
                value={driver.latitude}
                onChange={(event) => {
                  driverDirty.current = true;
                  setDriver({ ...driver, latitude: event.target.value });
                }}
              />
            </Field>
            <Field label="Courier longitude">
              <input
                required
                type="number"
                step="any"
                min="-180"
                max="180"
                value={driver.longitude}
                onChange={(event) => {
                  driverDirty.current = true;
                  setDriver({ ...driver, longitude: event.target.value });
                }}
              />
            </Field>
            <FormError error={driverError} />
            {["Delivered", "Cancelled"].includes(order.status) && (
              <p className="muted">
                Location updates are closed for {order.status.toLowerCase()}{" "}
                orders.
              </p>
            )}
            <SubmitButton
              busy={driverBusy}
              disabled={["Delivered", "Cancelled"].includes(order.status)}
              className="secondary"
            >
              <MapPin size={16} />
              Record manual position
            </SubmitButton>
          </form>
        </aside>
      </div>
    </>
  );
}
export function AdminLocations() {
  const { revision } = useStore();
  const result = useResource("/admin/locations", [revision]);
  const [selected, setSelected] = useState(null);
  const points = listOf(result.data);
  return (
    <>
      <PageHeading
        eyebrow="GOOD THINGS, FINDING THEIR WAY"
        title="Delivery map"
        description="Authorized order destinations and the most recent reported positions."
      />
      <InlineNotice>
        Destination pins show customer addresses. Manual or courier location
        updates show the last recorded position; they do not imply continuous
        live tracking.
      </InlineNotice>
      {result.loading ? (
        <Loading />
      ) : result.error ? (
        <ErrorState error={result.error} retry={result.reload} />
      ) : (
        <div className="map-admin-layout">
          <section className="admin-card">
            <DeliveryMap
              locations={selected ? [selected] : points}
              order={selected}
              height={510}
            />
          </section>
          <section className="admin-card map-order-list">
            <div className="admin-card-header">
              <h2>{points.length} destinations</h2>
              {selected && (
                <button
                  className="link-button"
                  onClick={() => setSelected(null)}
                >
                  Show all
                </button>
              )}
            </div>
            {points.length ? (
              points.map((point) => (
                <div
                  key={point.id}
                  className={
                    selected?.id === point.id
                      ? "map-order selected"
                      : "map-order"
                  }
                >
                  <button onClick={() => setSelected(point)}>
                    <strong>
                      {orderNumber(point.id)} · {point.name || "Customer"}
                    </strong>
                    <p>{addressText(point.address)}</p>
                    <Badge>{point.status}</Badge>
                  </button>
                  <Link
                    className="icon-button"
                    to={`/admin/orders/${point.id}`}
                    aria-label={`Open order ${point.id}`}
                  >
                    <ArrowRight size={17} />
                  </Link>
                </div>
              ))
            ) : (
              <EmptyState
                icon={MapPin}
                title="No pins yet"
                message="Add destination coordinates from an order’s details."
              />
            )}
          </section>
        </div>
      )}
    </>
  );
}
export function AdminNotifications() {
  const { revision, notify } = useStore();
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [retrying, setRetrying] = useState(null);
  const result = useResource(
    `/admin/notifications?${makeQuery({ status, page, limit: 20 })}`,
    [revision],
  );
  return (
    <>
      <PageHeading
        eyebrow="EVERY MESSAGE, ACCOUNTED FOR"
        title="Notifications"
        description="Check whether providers accepted email and SMS events, or whether they were simulated, skipped or need another try."
      />
      <InlineNotice>
        “Simulated” means the local adapter processed the event without sending
        a real email or SMS. “Skipped” means no sending provider was configured.
        “Sent” and “accepted” indicate provider acceptance, not confirmed inbox
        or phone delivery.
      </InlineNotice>
      <section className="admin-card">
        <div className="admin-toolbar">
          <select
            aria-label="Filter notification status"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
          >
            <option value="">All notification states</option>
            {[
              "pending",
              "queued",
              "sending",
              "sent",
              "accepted",
              "simulated",
              "skipped",
              "failed",
            ].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </div>
        {result.loading ? (
          <Loading />
        ) : result.error ? (
          <ErrorState error={result.error} retry={result.reload} />
        ) : listOf(result.data).length ? (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Created</th>
                    <th>Channel / recipient</th>
                    <th>Event</th>
                    <th>Status</th>
                    <th>Attempts</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {listOf(result.data).map((item) => (
                    <tr key={item.id}>
                      <td className="nowrap">{dateTime(item.created_at)}</td>
                      <td>
                        <strong>{item.channel}</strong>
                        <small>{item.recipient}</small>
                      </td>
                      <td>
                        {item.event_key}
                        <small>{item.error || ""}</small>
                      </td>
                      <td>
                        <Badge>{item.status}</Badge>
                        {item.sent_at && (
                          <small>{dateTime(item.sent_at)}</small>
                        )}
                      </td>
                      <td>{item.attempts || 0}</td>
                      <td>
                        {item.status === "failed" && (
                          <button
                            className="button secondary small"
                            disabled={retrying === item.id}
                            onClick={async () => {
                              setRetrying(item.id);
                              try {
                                await api(
                                  `/admin/notifications/${item.id}/retry`,
                                  { method: "POST", body: {} },
                                );
                                result.reload();
                                notify(
                                  "Notification queued for another attempt.",
                                );
                              } catch (error) {
                                notify(error.message, "error");
                              } finally {
                                setRetrying(null);
                              }
                            }}
                          >
                            {retrying === item.id ? "Retrying…" : "Retry"}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={page}
              total={result.data.total}
              limit={20}
              onPage={setPage}
            />
          </>
        ) : (
          <EmptyState
            icon={Bell}
            title="No notifications in this view"
            message="Committed order and enquiry events create records here."
          />
        )}
      </section>
    </>
  );
}
