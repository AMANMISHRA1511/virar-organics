let csrfToken;
let csrfPromise;
export async function getCsrf(force = false) {
  if (csrfToken && !force) return csrfToken;
  if (!csrfPromise || force) {
    csrfPromise = fetch("/api/csrf", { credentials: "same-origin" })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            "Could not establish a secure connection. Please retry.",
          );
        csrfToken = (await response.json()).csrfToken;
        return csrfToken;
      })
      .finally(() => {
        csrfPromise = undefined;
      });
  }
  return csrfPromise;
}
export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export async function api(path, options = {}) {
  const { method = "GET", body, signal, retryCsrf = true } = options;
  const headers = { Accept: "application/json" };
  if (body !== undefined && !(body instanceof FormData))
    headers["Content-Type"] = "application/json";
  if (!["GET", "HEAD"].includes(method))
    headers["X-CSRF-Token"] = await getCsrf();
  const response = await fetch(`/api${path}`, {
    method,
    headers,
    credentials: "same-origin",
    signal,
    body:
      body === undefined
        ? undefined
        : body instanceof FormData
          ? body
          : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (
      response.status === 403 &&
      retryCsrf &&
      /csrf/i.test(`${data.error || ""} ${data.code || ""}`)
    ) {
      await getCsrf(true);
      return api(path, { ...options, retryCsrf: false });
    }
    if (
      response.status === 401 &&
      !["/login", "/register", "/me"].includes(path)
    )
      window.dispatchEvent(new Event("mm:session-expired"));
    throw new ApiError(
      data.error || `Request failed (${response.status}). Please retry.`,
      response.status,
      data.code,
    );
  }
  return data;
}
export async function uploadImages(files, onProgress = () => {}) {
  const token = await getCsrf();
  const accepted = ["image/jpeg", "image/png", "image/webp"];
  if (!files.length) return [];
  if (files.length > 8) throw new Error("Choose up to eight images at a time.");
  for (const file of files) {
    if (!accepted.includes(file.type))
      throw new Error(`${file.name}: choose a JPG, PNG or WebP image.`);
    if (file.size > 5 * 1024 * 1024)
      throw new Error(`${file.name}: the limit is 5 MB per image.`);
  }
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/admin/upload");
    xhr.setRequestHeader("X-CSRF-Token", token);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable)
        onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onerror = () =>
      reject(
        new Error("Upload interrupted. Check your connection and try again."),
      );
    xhr.onload = () => {
      let data;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        reject(new Error("The server returned an unreadable upload response."));
        return;
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else
        reject(new Error(data.error || "Image upload failed. Please retry."));
    };
    const form = new FormData();
    for (const file of files) form.append("images", file);
    xhr.send(form);
  });
}
export const money = (value) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(Number(value || 0));
export const priceOf = (product) =>
  Number(product.effective_price ?? product.sale_price ?? product.price ?? 0);
export const imagesOf = (product) => {
  try {
    return typeof product.images === "string"
      ? JSON.parse(product.images)
      : product.images || [];
  } catch {
    return [];
  }
};
export const listOf = (data) =>
  Array.isArray(data) ? data : data?.items || [];
export const dateTime = (value) =>
  value
    ? new Date(value).toLocaleString("en-IN", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";
export const dateOnly = (value) =>
  value
    ? new Date(value).toLocaleDateString("en-IN", { dateStyle: "medium" })
    : "—";
export const dateInput = (value) => (value ? String(value).slice(0, 10) : "");
export const makeQuery = (values) =>
  new URLSearchParams(
    Object.entries(values).filter(
      ([, value]) =>
        value !== "" &&
        value !== undefined &&
        value !== null &&
        value !== false,
    ),
  ).toString();
export const addressText = (address) =>
  typeof address === "string"
    ? address
    : address
      ? [
          address.name,
          address.line1,
          address.line2,
          address.city,
          address.state,
          address.pincode,
        ]
          .filter(Boolean)
          .join(", ")
      : "Address not provided";
export const orderNumber = (id) => `MM-${String(id).padStart(5, "0")}`;
