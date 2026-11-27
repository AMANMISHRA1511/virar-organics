// Generate the order bill on-device without relying on a print dialog or
// sending customer details to a third-party PDF service.
function ascii(value) {
  return String(value ?? "").replace(/₹/g, "INR ").replace(/[–—]/g, "-")
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .normalize("NFKD").replace(/[^\x20-\x7E]/g, "?");
}
function wrap(value, max = 85) {
  const result = [];
  for (const segment of ascii(value).split(/\r?\n/)) {
    let line = segment.trim();
    if (!line) { result.push(""); continue; }
    while (line.length > max) {
      let pos = line.lastIndexOf(" ", max);
      if (pos < max / 3) pos = max;
      result.push(line.slice(0, pos).trimEnd());
      line = line.slice(pos).trimStart();
    }
    result.push(line);
  }
  return result;
}
const money = amount => {
  const n = Number(amount);
  return "INR " + (Number.isFinite(n) ? n : 0).toFixed(2);
};
function escapePdf(s) {
  return ascii(s).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}
export function buildOrderBillPdf(order, settings = {}) {
  if (!order?.id || !Array.isArray(order.items)) throw new Error("Order is not ready. Reload and try again.");
  const code = "VO-" + String(order.id).padStart(6, "0");
  const a = order.address || {};
  const destination = [a.name || order.name, a.line1, a.line2, a.city, a.state, a.pincode, a.country || "India"].filter(Boolean).join(", ");
  const method = order.payment_method === "cod" ? "Cash on Delivery"
    : order.payment_method === "razorpay" ? "Razorpay TEST (not a real payment)" : "Simulation (not a real payment)";
  const lines = [
    "VIRAR ORGANICS - ORDER BILL", "",
    "Bill reference: " + code,
    "Order date: " + (order.created_at ? new Date(order.created_at).toLocaleString("en-IN") : "N/A"),
    "Order status: " + (order.status || "Pending"),
    "Payment method: " + method,
    "Payment status: " + (order.payment_status || "pending"), "",
    "SELLER: " + (settings.storeName || "Virar Organics"),
    settings.address || "", settings.contactEmail || "", "",
    "CUSTOMER: " + (order.name || ""), "Email: " + (order.email || ""),
    "Delivery: " + destination, "", "ITEMS",
    "--------------------------------------------------------------------------",
  ];
  for (const item of order.items) {
    lines.push(item.name + (item.unit ? " (" + item.unit + ")" : ""));
    lines.push("Qty " + Number(item.quantity) + " x " + money(item.price) + " = " +
      money(Number(item.quantity) * Number(item.price)));
  }
  lines.push("--------------------------------------------------------------------------",
    "Subtotal: " + money(order.subtotal),
    "Delivery charge: " + money(order.delivery_charge),
    "TOTAL: " + money(order.total), "",
    "ORDER BILL, NOT A GST TAX INVOICE.",
    "No GST rate, GSTIN, or tax amount has been assumed.",
    "COD is not paid until collected. TEST payments are not real collections.");
  const all = lines.flatMap(line => wrap(line));
  const pages = [];
  for (let i = 0; i < all.length; i += 45) pages.push(all.slice(i, i + 45));
  const objects = new Map([[1, "<< /Type /Catalog /Pages 2 0 R >>"],
    [3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"]]);
  const ids = [];
  pages.forEach((page, index) => {
    const pageId = 4 + index * 2, streamId = pageId + 1;
    ids.push(pageId + " 0 R");
    const stream = page.map((line, j) =>
      "BT /F1 " + (j === 0 ? 17 : 10) + " Tf 48 " + (790 - j * 16) +
      " Td (" + escapePdf(line) + ") Tj ET").join("\n") + "\n";
    objects.set(pageId, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents " + streamId + " 0 R >>");
    objects.set(streamId, "<< /Length " + stream.length + " >>\nstream\n" + stream + "endstream");
  });
  objects.set(2, "<< /Type /Pages /Count " + pages.length + " /Kids [" + ids.join(" ") + "] >>");
  let output = "%PDF-1.4\n";
  const offsets = [0], count = Math.max(...objects.keys());
  for (let i = 1; i <= count; i++) {
    offsets[i] = output.length;
    output += i + " 0 obj\n" + objects.get(i) + "\nendobj\n";
  }
  const xref = output.length;
  output += "xref\n0 " + (count + 1) + "\n0000000000 65535 f \n";
  for (let i = 1; i <= count; i++) output += String(offsets[i]).padStart(10, "0") + " 00000 n \n";
  output += "trailer\n<< /Size " + (count + 1) + " /Root 1 0 R >>\nstartxref\n" + xref + "\n%%EOF\n";
  return new Blob([output], { type: "application/pdf" });
}
export function downloadOrderBill(order, settings) {
  const blob = buildOrderBillPdf(order, settings);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "Virar-Organics-Bill-VO-" + String(order.id).padStart(6, "0") + ".pdf";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
