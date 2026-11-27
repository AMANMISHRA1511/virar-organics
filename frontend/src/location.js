// Pure address helpers. The lookup request itself is made only after an explicit
// customer click and a fresh browser geolocation result in AddressFields.
const text = (value) => (typeof value === "string" ? value.trim() : "");
export function parseLocationSuggestion(data, coordinates) {
  if (!data || typeof data !== "object" || data.error || data.errorCode) {
    throw new Error(
      "The address lookup could not identify this location. Enter the address manually.",
    );
  }
  const latitude = coordinates?.latitude;
  const longitude = coordinates?.longitude;
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  ) {
    throw new Error(
      "The browser did not provide valid coordinates. Enter the address manually.",
    );
  }
  const indian = text(data.countryCode).toUpperCase() === "IN";
  const postcode = text(data.postcode);
  const accuracy = coordinates?.accuracy;
  return {
    area: text(data.locality),
    city: text(data.city) || text(data.locality),
    state: text(data.principalSubdivision),
    pincode: indian && /^\d{6}$/.test(postcode) ? postcode : "",
    country: text(data.countryName) || (indian ? "India" : ""),
    lat: latitude,
    lng: longitude,
    accuracy:
      Number.isFinite(accuracy) && accuracy >= 0 ? Math.round(accuracy) : null,
    countryCode: text(data.countryCode).toUpperCase(),
    warning: !indian
      ? "This location is outside India or its country could not be confirmed. Enter and check your delivery address manually."
      : !/^\d{6}$/.test(postcode)
        ? "The lookup did not return a six-digit PIN code. Please enter your PIN code manually."
        : "",
  };
}
export function mergeLocationSuggestion(current, suggestion, dirtyFields = []) {
  const dirty = new Set(dirtyFields);
  const result = { ...current };
  for (const field of ["area", "city", "state", "pincode", "country"]) {
    if (field === "country" && suggestion.countryCode !== "IN") continue;
    if (suggestion[field] && !dirty.has(field))
      result[field] = suggestion[field];
  }
  // Unit-level details are always retained: location cannot find a flat/room.
  const manualDestination = [
    "area",
    "city",
    "state",
    "pincode",
    "country",
  ].some((field) => dirty.has(field));
  result.lat = manualDestination ? null : suggestion.lat;
  result.lng = manualDestination ? null : suggestion.lng;
  result.accuracy = manualDestination ? null : suggestion.accuracy;
  return result;
}
export function emptyAddress(user = {}) {
  return {
    label: "Home",
    name: user.name || "",
    phone: user.phone || "",
    flat: "",
    building: "",
    area: "",
    landmark: "",
    city: "",
    state: "",
    pincode: "",
    country: "India",
    lat: null,
    lng: null,
    accuracy: null,
    is_default: false,
  };
}
export function addressPayload(value) {
  const address = { ...emptyAddress(), ...value };
  const line1 =
    [address.flat, address.building, address.area].filter(Boolean).join(", ") ||
    address.line1 ||
    "";
  const line2 = address.landmark || address.line2 || "";
  const lat =
    address.lat === "" || address.lat == null ? null : Number(address.lat);
  const lng =
    address.lng === "" || address.lng == null ? null : Number(address.lng);
  return {
    label: address.label,
    name: address.name,
    phone: address.phone,
    flat: address.flat,
    building: address.building,
    area: address.area,
    landmark: address.landmark,
    city: address.city,
    state: address.state,
    pincode: address.pincode,
    country: address.country || "India",
    line1,
    line2,
    lat,
    lng,
    accuracy:
      lat == null || lng == null || address.accuracy == null
        ? null
        : Number(address.accuracy),
    is_default: Boolean(address.is_default),
  };
}

export function requestCurrentLocation({
  geolocation,
  fetchImpl = globalThis.fetch,
  signal,
  onPhase = () => {},
}) {
  return new Promise((resolve, reject) => {
    let finished = false;
    let timer;
    const requestController = new AbortController();
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    };
    const fail = (error) => {
      if (!finished) {
        finished = true;
        cleanup();
        reject(error);
      }
    };
    const abort = () => {
      requestController.abort();
      const error = new Error("Location lookup was cancelled.");
      error.name = "AbortError";
      fail(error);
    };
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
    if (!geolocation?.getCurrentPosition) {
      fail(
        new Error(
          "This browser cannot share a location. Enter your address manually.",
        ),
      );
      return;
    }
    onPhase("permission");
    geolocation.getCurrentPosition(
      async (position) => {
        if (finished) return;
        try {
          const coordinates = position?.coords;
          if (
            !Number.isFinite(coordinates?.latitude) ||
            !Number.isFinite(coordinates?.longitude) ||
            Math.abs(coordinates.latitude) > 90 ||
            Math.abs(coordinates.longitude) > 180
          )
            throw new Error(
              "The browser did not provide valid coordinates. Enter your address manually.",
            );
          if (
            Number.isFinite(position.timestamp) &&
            Date.now() - position.timestamp > 60000
          )
            throw new Error(
              "The browser returned an older location. Request a fresh location or enter your address manually.",
            );
          onPhase("lookup");
          const url = new URL(
            "https://api.bigdatacloud.net/data/reverse-geocode-client",
          );
          url.search = new URLSearchParams({
            latitude: String(coordinates.latitude),
            longitude: String(coordinates.longitude),
            localityLanguage: "en",
          }).toString();
          timer = setTimeout(() => {
            requestController.abort();
            fail(
              new Error(
                "The address lookup timed out. Enter your address manually, or try again.",
              ),
            );
          }, 10000);
          const response = await fetchImpl(url, {
            credentials: "omit",
            referrerPolicy: "no-referrer",
            signal: requestController.signal,
          });
          if (!response.ok)
            throw new Error(
              "The address lookup is temporarily unavailable. Enter your address manually.",
            );
          const suggestion = parseLocationSuggestion(
            await response.json(),
            coordinates,
          );
          if (finished) return;
          finished = true;
          cleanup();
          resolve(suggestion);
        } catch (error) {
          fail(error);
        }
      },
      (error) => {
        if (finished) return;
        fail(
          new Error(
            error.code === 1
              ? "Location permission was denied. You can enter your full address below; no location lookup was made."
              : error.code === 3
                ? "The browser could not find your location in time. Enter the address manually, or try again."
                : "Your current location could not be determined. Enter your address manually.",
          ),
        );
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    );
  });
}
