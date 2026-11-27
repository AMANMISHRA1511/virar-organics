// Persist only a signed-in customer's explicit checkout attempt. This is not a
// guest address draft. Keeping the exact body prevents a reload from creating a
// new idempotency key while the first request's outcome is unknown.
const keyFor = (userId) => {
  if (!Number.isInteger(Number(userId)) || Number(userId) < 1)
    throw new Error("Sign in before starting checkout.");
  return `mm-checkout:user:${Number(userId)}`;
};
const ordered = (value) => {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, ordered(value[key])]),
    );
  return value;
};
export function checkoutFingerprint(payload) {
  const { idempotency_key: _key, ...body } = payload;
  return JSON.stringify(
    ordered({
      ...body,
      items: [...(body.items || [])]
        .map((item) => ({
          id: Number(item.id),
          quantity: Number(item.quantity),
        }))
        .sort((a, b) => a.id - b.id),
    }),
  );
}
export function readCheckoutAttempt(storage, userId) {
  const key = keyFor(userId);
  try {
    const saved = JSON.parse(storage.getItem(key) || "null");
    if (
      !saved ||
      saved.userId !== Number(userId) ||
      typeof saved.key !== "string" ||
      saved.key.length < 8 ||
      !saved.payload?.items?.length ||
      !saved.payload?.payment_method ||
      saved.fingerprint !== checkoutFingerprint(saved.payload)
    )
      return null;
    return saved;
  } catch {
    return null;
  }
}
export function prepareCheckoutAttempt(
  storage,
  userId,
  payload,
  newKey = () => crypto.randomUUID(),
) {
  const fingerprint = checkoutFingerprint(payload);
  const existing = readCheckoutAttempt(storage, userId);
  if (existing) {
    if (existing.fingerprint !== fingerprint) {
      const error = new Error(
        "A previous checkout is still unresolved. Recover or review that attempt before starting a different order.",
      );
      error.code = "PENDING_CHECKOUT";
      error.attempt = existing;
      throw error;
    }
    return existing;
  }
  const attempt = {
    userId: Number(userId),
    key: newKey(),
    fingerprint,
    payload: JSON.parse(JSON.stringify(payload)),
    status: "pending",
    createdAt: new Date().toISOString(),
  };
  try {
    storage.setItem(keyFor(userId), JSON.stringify(attempt));
  } catch {
    throw new Error(
      "This browser cannot save a checkout recovery key. Enable session storage before placing an order.",
    );
  }
  return attempt;
}
export function markCheckoutRejected(storage, userId, attempt, message) {
  const current = readCheckoutAttempt(storage, userId);
  if (current?.key !== attempt.key) return current;
  const rejected = { ...current, status: "rejected", message };
  storage.setItem(keyFor(userId), JSON.stringify(rejected));
  return rejected;
}
export function clearCheckoutAttempt(storage, userId, key) {
  const current = readCheckoutAttempt(storage, userId);
  if (current?.key === key) storage.removeItem(keyFor(userId));
}
