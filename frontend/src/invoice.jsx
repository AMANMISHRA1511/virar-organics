import React, { useEffect, useState } from "react";
import { downloadOrderBill } from "./invoice-download";
import { Link, useParams } from "react-router-dom";
import { useResource } from "./hooks";
import { useStore } from "./context";
import { addressText, dateTime, money } from "./api";
import "./invoice.css";

export function OrderInvoicePage() {
  const { id } = useParams();
  const [downloadError, setDownloadError] = useState("");
  const { user, settings, authLoading } = useStore();
  const orderId = /^[1-9][0-9]*$/.test(id || "") ? id : "invalid";
  const { data: order, loading, error, reload } = useResource(
    `/orders/${orderId}`,
    [orderId],
  );
  const back = user?.role === "admin" ? `/admin/orders/${id}` : `/account/orders/${id}`;
  useEffect(() => {
    if (order?.id) document.title = `Bill VO-${String(order.id).padStart(6, "0")} | Virar Organics`;
    return () => { document.title = "Virar Organics"; };
  }, [order?.id]);
  const paymentLabel = order?.payment_method === "cod"
    ? "Cash on Delivery"
    : order?.payment_method === "mock"
      ? "Simulated payment - no money collected"
      : "Razorpay TEST - no real money collected";
  const paid = order?.payment_status === "paid";
  const statusLabel = order?.status === "Cancelled"
    ? "Cancelled"
    : paid && order?.payment_method === "razorpay"
      ? "Test payment captured"
      : paid
        ? "Paid"
        : order?.payment_status === "refund_required"
          ? "Refund review required"
          : "Payment not received";
  const documentId = order?.id ? `VO-${String(order.id).padStart(6, "0")}` : "";
  const itemTotal = (item) => Math.round(Number(item.price || 0) * 100) * Number(item.quantity || 0);
  const show = order && user && (user.role === "admin" || user.role === "customer");
  return (
    <main className="invoice-shell">
      <div className="invoice-tools">
        <Link to={back}>Back to order</Link>
        <div className="invoice-download-actions">
          <button type="button" className="button primary" disabled={!show} onClick={() => {
            setDownloadError("");
            try { downloadOrderBill(order, settings); }
            catch (error) { setDownloadError(error.message || "Download failed. Please retry."); }
          }}>Download PDF</button>
          <button type="button" className="button secondary" disabled={!show} onClick={() => window.print()}>Print</button>
        </div>
      </div>
      {downloadError && <p className="invoice-message" role="alert">{downloadError}</p>}
      {authLoading || loading ? <p className="invoice-message">Loading your bill…</p>
      : error ? <div className="invoice-message" role="alert">
          <p>{error.message || "Bill could not be loaded. Please sign in to the correct account."}</p>
          <button className="button secondary" onClick={reload}>Retry</button>
          <p><Link to="/login">Customer sign in</Link> · <Link to="/admin/login">Admin sign in</Link></p>
        </div>
      : !show ? <p className="invoice-message">Sign in to access your own order bill.</p>
      : <article className="invoice-paper" aria-label={`Order bill ${documentId}`}>
          <header className="invoice-head">
            <div>
              <p className="invoice-eyebrow">VIRAR ORGANICS</p>
              <h1>Order bill</h1>
              <p className="invoice-subtitle">Order summary and payment record</p>
            </div>
            <div className="invoice-meta">
              <strong>{documentId}</strong>
              <span>Order #{order.id}</span>
              <span>{dateTime(order.created_at)}</span>
            </div>
          </header>
          <div className="invoice-summary">
            <section>
              <h2>Seller</h2>
              <strong>{settings.storeName || "Virar Organics"}</strong>
              {settings.address && <p>{settings.address}</p>}
              {settings.contactEmail && <p>{settings.contactEmail}</p>}
              {settings.contactPhone && <p>{settings.contactPhone}</p>}
            </section>
            <section>
              <h2>Bill to / Delivery</h2>
              <strong>{order.name || order.address?.name || "Customer"}</strong>
              <p>{addressText(order.address)}</p>
              {order.email && <p>{order.email}</p>}
              {(order.address?.phone || order.phone) && <p>{order.address?.phone || order.phone}</p>}
            </section>
          </div>
          <div className="invoice-scroll">
            <table className="invoice-table">
              <thead><tr><th>Item</th><th>Qty</th><th>Unit price</th><th>Amount</th></tr></thead>
              <tbody>
                {(order.items || []).map((item, i) =>
                  <tr key={i}>
                    <td><strong>{item.name}</strong>{item.unit && <small>{item.unit}</small>}</td>
                    <td>{Number(item.quantity)}</td>
                    <td>{money(item.price)}</td>
                    <td>{money(itemTotal(item) / 100)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="invoice-calculation">
            <div><span>Subtotal</span><strong>{money(order.subtotal)}</strong></div>
            <div><span>Delivery charge</span><strong>{money(order.delivery_charge)}</strong></div>
            <div className="invoice-grand"><span>Order total</span><strong>{money(order.total)}</strong></div>
          </div>
          <section className="invoice-payment">
            <h2>Payment & order status</h2>
            <p><strong>Method:</strong> {paymentLabel}</p>
            <p><strong>Payment:</strong> {statusLabel}</p>
            <p><strong>Order:</strong> {order.status}</p>
            {order.status === "Cancelled" && <p>This order has been cancelled. Any refund is handled separately.</p>}
          </section>
          <footer className="invoice-foot">
            <p>This document is an order bill, not a GST tax invoice. GST is not separately charged or itemised in this document.</p>
            <p>Generated from the order stored by Virar Organics. For payment disputes, use your order reference above.</p>
          </footer>
        </article>}
    </main>
  );
}
