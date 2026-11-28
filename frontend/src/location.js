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
  onCoordinates = () => {},
}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const error = new Error("Location request cancelled.");
      error.name = "AbortError";
      reject(error);
      return;
    }
    if (!geolocation?.getCurrentPosition) {
      reject(new Error("Location is not available in this browser. Enter your address manually."));
      return;
    }
    let settled = false;
    let watchdog;
    let activeFetch;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      activeFetch?.abort();
      signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve(result);
    };
    const abort = () => {
      const error = new Error("Location request cancelled.");
      error.name = "AbortError";
      finish(error);
    };
    signal?.addEventListener("abort", abort, { once: true });
    // A hard deadline ensures the button always stops spinning even if the
    // browser ignores its geolocation timeout or a provider hangs.
    watchdog = setTimeout(() =>
      finish(new Error("Location request took too long. Please enter the address manually or retry with device Location enabled.")),
    65000);
    onPhase("permission");

    function positionAttempt(highAccuracy) {
      return new Promise((success, failure) => {
        let done = false, watchId, best, timer;
        const cleanup = () => {
          clearTimeout(timer);
          if (watchId != null) geolocation.clearWatch?.(watchId);
          signal?.removeEventListener("abort", cancel);
        };
        const complete = (error, position) => {
          if (done) return;
          done = true; cleanup();
          if (error) failure(error); else success(position);
        };
        const cancel = () => complete({code: 1});
        const accept = position => {
          const coords = position?.coords;
          if (!Number.isFinite(coords?.latitude) || !Number.isFinite(coords?.longitude)) return;
          if (done || !Number.isFinite(coords.accuracy) || coords.accuracy < 0 || Math.abs(coords.latitude)>90 || Math.abs(coords.longitude)>180) return;
          if (!best || coords.accuracy < best.coords.accuracy) best = position;
          if (coords.accuracy <= 50) complete(null, position);
        };
        const error = e => { if (e?.code === 1) complete(e); };
        const duration = highAccuracy ? 20000 : 10000;
        timer = setTimeout(() => best ? complete(null, best) : complete({code: 3}), duration);
        signal?.addEventListener("abort", cancel, {once:true});
        const options = {enableHighAccuracy: highAccuracy, maximumAge: 0, timeout: duration};
        try {
          if (typeof geolocation.watchPosition === "function") {
            watchId = geolocation.watchPosition(accept, error, options);
            if (done) geolocation.clearWatch?.(watchId);
            else geolocation.getCurrentPosition(accept, error, options);
          } else {
            geolocation.getCurrentPosition(p => complete(null,p), e => complete(e), options);
          }
        } catch (e) { complete(e); }
      });
    }
    async function fetchWithTimeout(url, settings, timeoutMs) {
      activeFetch = new AbortController();
      const controller = activeFetch;
      const cancel = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(url, { ...settings, signal: controller.signal });
        if (!response.ok) throw new Error("Address provider unavailable");
        const data = await response.json();
        if (!data || typeof data !== "object" || data.error || data.errorCode || !data.countryCode)
          throw new Error("Address provider returned incomplete data");
        return data;
      } finally {
        clearTimeout(cancel);
        if (activeFetch === controller) activeFetch = null;
      }
    }

    (async () => {
      let position;
      try {
        // Prefer a fresh precise fix, then retry network positioning.
        position = await positionAttempt(true);
      } catch (error) {
        if (error?.code === 1) {
          throw new Error("Location permission is denied. Allow Location for Chrome and this website, or enter the address manually.");
        }
        if (settled || signal?.aborted) return;
        onPhase("retry");
        try {
          position = await positionAttempt(false);
        } catch (last) {
          if (last?.code === 1)
            throw new Error("Location permission is denied. Enable Location permission or enter the address manually.");
          throw new Error("Your phone could not provide GPS coordinates. Switch on device Location, try outdoors or enter the address manually.");
        }
      }
      if (settled) return;
      const coordinates = position?.coords;
      if (!Number.isFinite(coordinates?.latitude) || !Number.isFinite(coordinates?.longitude) ||
          Math.abs(coordinates.latitude) > 90 || Math.abs(coordinates.longitude) > 180)
        throw new Error("The device returned invalid coordinates. Enter the address manually.");
      if (!Number.isFinite(coordinates.accuracy) || coordinates.accuracy > 100) throw new Error("Location is too approximate for delivery. Enable precise location in Chrome and retry.");
      onCoordinates({ latitude: coordinates.latitude, longitude: coordinates.longitude });
      onPhase("lookup");
      const query = new URLSearchParams({
        latitude: String(coordinates.latitude),
        longitude: String(coordinates.longitude),
        localityLanguage: "en",
      });
      let data;
      try {
        // Free client-originated reverse lookup avoids Render Free cold starts.
        data = await fetchWithTimeout(
          "https://api.bigdatacloud.net/data/reverse-geocode-client?" + query,
          { credentials: "omit", headers: { Accept: "application/json" }, referrerPolicy: "no-referrer" },
          7000,
        );
      } catch {
        if (settled || signal?.aborted) return;
        try {
          // Server-side fallback can use a separately configured Google
          // Geocoding key, but is NOT required for free address entry.
          data = await fetchWithTimeout(
            "/api/location/reverse?" + new URLSearchParams({
              latitude: String(coordinates.latitude),
              longitude: String(coordinates.longitude),
            }),
            { credentials: "same-origin", headers: { Accept: "application/json" } },
            15000,
          );
        } catch {
          throw new Error("GPS pin detected, but neither address lookup provider responded. Open the Google Maps link to review your pin, then fill area, city and PIN manually.");
        }
      }
      if (!settled) finish(null, parseLocationSuggestion(data, coordinates));
    })().catch(error => finish(error));
  });
}
