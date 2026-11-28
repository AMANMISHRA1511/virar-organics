import React, { useEffect, useRef, useState } from "react";
import {
  LocateFixed,
  MapPin,
  Pencil,
  Plus,
  Save,
  Star,
  Trash2,
} from "lucide-react";
import { api, addressText } from "./api";
import { useStore } from "./context";
import { useResource } from "./hooks";
import {
  Badge,
  ConfirmAction,
  DeliveryMap,
  EmptyState,
  ErrorState,
  Field,
  FormError,
  InlineNotice,
  Loading,
  Modal,
  PageHeading,
  SubmitButton,
} from "./components";
import {
  addressPayload,
  emptyAddress,
  mergeLocationSuggestion,
  requestCurrentLocation,
} from "./location";

const INDIAN_STATES = [
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chhattisgarh",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
  "Andaman and Nicobar Islands",
  "Chandigarh",
  "Dadra and Nagar Haveli and Daman and Diu",
  "Delhi",
  "Jammu and Kashmir",
  "Ladakh",
  "Lakshadweep",
  "Puducherry"
];

export function AddressFields({
  value,
  onChange,
  showLabel = false,
  showDefault = false,
  disabled = false,
}) {
  const { user, config, settings } = useStore();
  const allowedPincodes = [...new Set((settings.deliveryZones || []).flatMap(zone => zone.pincodes || []))].filter(pin => /^\d{6}$/.test(pin)).sort();
  const pinServiceable = allowedPincodes.includes(String(value.pincode || ""));
  const dirty = useRef(new Set());
  const requestNumber = useRef(0);
  const lookupController = useRef(null);
  const [location, setLocation] = useState({
    busy: false,
    message: "",
    error: "",
  });
  const [suggestion, setSuggestion] = useState(null);
  useEffect(
    () => () => {
      requestNumber.current += 1;
      lookupController.current?.abort();
    },
    [],
  );
  const change = (field, next) => {
    dirty.current.add(field);
    const changesDestination = [
      "area",
      "city",
      "state",
      "pincode",
      "country",
    ].includes(field);
    onChange((previous) => ({
      ...previous,
      [field]: next,
      ...(changesDestination
        ? { lat: null, lng: null, accuracy: null }
        : ["lat", "lng"].includes(field)
          ? { accuracy: null }
          : {}),
    }));
    if (changesDestination && value.lat != null && value.lng != null)
      setLocation({
        busy: location.busy,
        error: "",
        message:
          "The delivery pin was cleared because your destination details changed. Review the address and add a new pin if needed.",
      });
  };
  const locate = async () => {
    if (
      user?.role !== "customer" ||
      disabled ||
      location.busy ||
      config.location?.enabled === false
    )
      return;
    if (!window.isSecureContext) {
      setLocation({
        busy: false,
        message: "",
        error:
          "Location access requires HTTPS or localhost. Enter your address below.",
      });
      return;
    }
    const request = ++requestNumber.current;
    const controller = new AbortController();
    lookupController.current = controller;
    setSuggestion(null);
    try {
      const found = await requestCurrentLocation({
        geolocation: navigator.geolocation,
        signal: controller.signal,
        onPhase: (phase) =>
          setLocation({
            busy: true,
            message:
              phase === "permission"
                ? "Waiting for your browser's location permission…"
                : "Finding your area from the current device location…",
            error: "",
          }),
      });
      if (request !== requestNumber.current) return;
      setSuggestion(found);
      if (found.countryCode === "IN")
        onChange((previous) =>
          mergeLocationSuggestion(previous, found, [...dirty.current]),
        );
      setLocation({
        busy: false,
        message:
          found.countryCode !== "IN"
            ? "The detected location is outside India or could not be confirmed. Your delivery details were kept unchanged; enter the address manually."
            : ["area", "city", "state", "pincode", "country"].some((field) =>
                  dirty.current.has(field),
                )
              ? "Location suggestions are ready. Your manually edited destination was kept, so no location pin was attached. Use the suggestions only if they match your delivery address."
              : `Location found${found.accuracy != null ? ` · approximate accuracy ±${found.accuracy} m` : ""}. Review the suggested area and PIN code, then enter your flat or room details.`,
        error: "",
      });
    } catch (error) {
      if (request !== requestNumber.current) return;
      setLocation({ busy: false, message: "", error: error.message });
    }
  };
  const field = (key, label, extra = {}) => (
    <Field
      label={label}
      className={extra.wide ? "span-2" : ""}
      hint={extra.hint}
    >
      <input
        name={key}
        value={value[key] ?? ""}
        onChange={(event) => change(key, event.target.value)}
        disabled={disabled}
        required={extra.required}
        maxLength={extra.maxLength || 150}
        minLength={extra.minLength}
        autoComplete={extra.autoComplete}
        type={extra.type || "text"}
        inputMode={extra.inputMode}
        pattern={extra.pattern}
        placeholder={extra.placeholder}
        readOnly={extra.readOnly}
      />
    </Field>
  );
  return (
    <>
      <div className="location-assistance">
        <button
          type="button"
          className="button secondary"
          disabled={
            disabled || location.busy || config.location?.enabled === false
          }
          onClick={locate}
        >
          <LocateFixed size={18} />
          {location.busy ? "Finding your location…" : "Use my current location"}
        </button>
        <p>
          Location coordinates are used only when you ask to locate your address.
          Confirm the suggested PIN, city and area before saving.
        </p>
        {config.location?.enabled === false && (
          <p className="muted">
            Location assistance is disabled. You can enter every detail
            manually.
          </p>
        )}
        {location.message && (
          <p className="location-feedback" role="status" aria-live="polite">
            {location.message}
          </p>
        )}
        <FormError error={location.error} />
        {suggestion?.warning && (
          <InlineNotice>{suggestion.warning}</InlineNotice>
        )}
        {suggestion && (
          <div className="location-suggestion">
            <MapPin size={17} />
            <span>
              {[
                suggestion.area,
                suggestion.city !== suggestion.area && suggestion.city,
                suggestion.state,
                suggestion.pincode,
              ]
                .filter(Boolean)
                .join(", ") || "No address fields were returned."}
            </span>
            {suggestion.countryCode === "IN" && (
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  onChange((previous) =>
                    mergeLocationSuggestion(previous, suggestion),
                  );
                  setLocation({
                    busy: false,
                    error: "",
                    message:
                      "Location suggestions and the matching pin were applied. Confirm the address and your flat or room details.",
                  });
                  for (const key of [
                    "area",
                    "city",
                    "state",
                    "pincode",
                    "country",
                  ])
                    dirty.current.delete(key);
                }}
              >
                Use these suggestions
              </button>
            )}
          </div>
        )}
        {suggestion && (
          <small>
            Address suggestions by{" "}
            <a
              href="https://www.bigdatacloud.com/"
              target="_blank"
              rel="noreferrer"
            >
              BigDataCloud
            </a>
            . Flat, room and building details remain yours to enter.
          </small>
        )}
      </div>
      <div className="form-grid">
        {showLabel &&
          field("label", "Address label", {
            placeholder: "Home, work…",
            required: true,
            maxLength: 40,
            wide: true,
          })}
        {field("name", "Full name", {
          required: true,
          autoComplete: "name",
          maxLength: 100,
        })}
        {field("phone", "Mobile number", {
          required: true,
          autoComplete: "tel",
          type: "tel",
          maxLength: 20,
        })}
        {field("flat", "Flat / room number", {
          hint: "Enter manually; location cannot detect your room.",
          maxLength: 80,
        })}
        {field("building", "Building / street", {
          required: true,
          minLength: 3,
          autoComplete: "address-line1",
          maxLength: 150,
        })}
        {field("landmark", "Landmark (optional)", { maxLength: 150 })}
        {field("area", "Area / locality", {
          required: true,
          autoComplete: "address-line2",
          maxLength: 150,
        })}
        {field("city", "City", {
          required: true,
          autoComplete: "address-level2",
          maxLength: 100,
        })}
        <Field label="State / Union territory">
          <select name="state" required value={value.state || ""} disabled={disabled}
            autoComplete="address-level1" onChange={event => change("state", event.target.value)}>
            <option value="">Select state</option>
            {value.state && !INDIAN_STATES.includes(value.state) &&
              <option value={value.state}>{value.state} (saved)</option>}
            {INDIAN_STATES.map(state => <option key={state} value={state}>{state}</option>)}
          </select>
        </Field>
        <Field label="PIN code" hint="Enter any Indian six-digit PIN. Delivery coverage is checked separately at checkout.">
          <input name="pincode" value={value.pincode || ""}
            onChange={event => change("pincode", event.target.value.replace(/\D/g, "").slice(0, 6))}
            disabled={disabled} required inputMode="numeric" pattern="[1-9][0-9]{5}" maxLength={6}
            autoComplete="postal-code" placeholder="Enter 6-digit Indian PIN" />
          {value.pincode?.length === 6 && allowedPincodes.length > 0 &&
            <small role="status">{pinServiceable
              ? "This PIN is currently serviceable."
              : "You can save this address, but delivery to this PIN is not currently available."}</small>}
        </Field>
        <Field label="Country">
          <select name="country" disabled={disabled} required value="India" onChange={() => change("country", "India")}>
            <option value="India">India</option>
          </select>
        </Field>
      </div>
      {showDefault && (
        <label className="check-field address-default-check">
          <input
            type="checkbox"
            checked={Boolean(value.is_default)}
            onChange={(event) => change("is_default", event.target.checked)}
            disabled={disabled}
          />
          <span>Use as my default delivery address</span>
        </label>
      )}
      <details className="location-details">
        <summary>
          <MapPin size={17} />
          Review or adjust the delivery pin (optional)
        </summary>
        <p className="muted">
          The pin helps find the building. It does not determine a flat or room
          number.
        </p>
        <DeliveryMap
          order={{ latitude: value.lat, longitude: value.lng }}
          editable={!disabled}
          height={230}
          onPick={({ lat, lng }) =>
            onChange((previous) => ({ ...previous, lat, lng, accuracy: null }))
          }
        />
        <div className="form-grid">
          <Field label="Latitude">
            <input
              type="number"
              step="any"
              min="-90"
              max="90"
              value={value.lat ?? ""}
              onChange={(event) => change("lat", event.target.value)}
              disabled={disabled}
            />
          </Field>
          <Field label="Longitude">
            <input
              type="number"
              step="any"
              min="-180"
              max="180"
              value={value.lng ?? ""}
              onChange={(event) => change("lng", event.target.value)}
              disabled={disabled}
            />
          </Field>
        </div>
      </details>
    </>
  );
}
export function AddressCard({ address, actions }) {
  return (
    <article className="saved-address-card">
      <div className="address-card-top">
        <span className="address-icon">
          <MapPin size={20} />
        </span>
        <h3>{address.label || "Delivery address"}</h3>
        {address.is_default && <Badge variant="delivered">Default</Badge>}
      </div>
      <strong>{address.name}</strong>
      <p>{addressText({ ...address, name: "" })}</p>
      <p className="muted">{address.phone}</p>
      {address.accuracy != null && (
        <small>
          Saved location accuracy: approximately ±{Math.round(address.accuracy)}{" "}
          m
        </small>
      )}
      {actions && <div className="address-card-actions">{actions}</div>}
    </article>
  );
}
export function AccountAddresses() {
  const { user, revision, refresh, notify } = useStore();
  const result = useResource("/account/addresses", [revision]);
  const [edit, setEdit] = useState(null),
    [remove, setRemove] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const open = (address) => {
    setError("");
    setEdit(
      address
        ? {
            ...emptyAddress(user),
            ...address,
            building: address.building || address.line1 || "",
            landmark: address.landmark || address.line2 || "",
          }
        : emptyAddress(user),
    );
  };
  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(
        edit.id ? `/account/addresses/${edit.id}` : "/account/addresses",
        { method: edit.id ? "PATCH" : "POST", body: addressPayload(edit) },
      );
      setEdit(null);
      result.reload();
      refresh();
      notify("Delivery address saved to your account.");
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  };
  const makeDefault = async (address) => {
    try {
      await api(`/account/addresses/${address.id}`, {
        method: "PATCH",
        body: { is_default: true },
      });
      result.reload();
      refresh();
      notify("Default delivery address updated.");
    } catch (failure) {
      notify(failure.message, "error");
    }
  };
  return (
    <>
      <PageHeading
        eyebrow="YOUR EVERYDAY DESTINATIONS"
        title="Saved addresses"
        description="Keep delivery details with your account and choose them at checkout."
        actions={
          <button className="button primary" onClick={() => open()}>
            <Plus size={17} />
            Add address
          </button>
        }
      />
      {result.loading ? (
        <Loading label="Loading your addresses…" />
      ) : result.error ? (
        <ErrorState error={result.error} retry={result.reload} />
      ) : !result.data?.items?.length ? (
        <EmptyState
          icon={MapPin}
          title="A place for the good things"
          message="Add your first address. Your flat, building and landmark stay editable."
          action={
            <button className="button secondary" onClick={() => open()}>
              Add your first address
            </button>
          }
        />
      ) : (
        <div className="saved-address-grid">
          {result.data.items.map((address) => (
            <AddressCard
              key={address.id}
              address={address}
              actions={
                <>
                  <button
                    className="link-button"
                    onClick={() => open(address)}
                    aria-label={`Edit ${address.label || "address"}`}
                  >
                    <Pencil size={14} />
                    Edit
                  </button>
                  {!address.is_default && (
                    <button
                      className="link-button"
                      onClick={() => makeDefault(address)}
                    >
                      <Star size={14} />
                      Make default
                    </button>
                  )}
                  <button
                    className="link-button danger-text"
                    onClick={() => setRemove(address)}
                    aria-label={`Delete ${address.label || "address"}`}
                  >
                    <Trash2 size={14} />
                    Delete
                  </button>
                </>
              }
            />
          ))}
        </div>
      )}
      {edit && (
        <Modal
          wide
          title={edit.id ? "Edit delivery address" : "Add delivery address"}
          onClose={() => !busy && setEdit(null)}
        >
          <form className="form-stack" onSubmit={save}>
            <AddressFields
              value={edit}
              onChange={setEdit}
              showLabel
              showDefault
              disabled={busy}
            />
            <FormError error={error} />
            <div className="form-actions">
              <SubmitButton busy={busy}>
                <Save size={16} />
                Save address
              </SubmitButton>
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() => setEdit(null)}
              >
                Cancel
              </button>
            </div>
          </form>
        </Modal>
      )}
      {remove && (
        <ConfirmAction
          title="Delete this saved address?"
          message="Existing order delivery details are kept with those orders. This removes the address from your account's saved choices."
          confirmText="Delete address"
          danger
          onClose={() => setRemove(null)}
          onConfirm={async () => {
            await api(`/account/addresses/${remove.id}`, { method: "DELETE" });
            result.reload();
            refresh();
            notify("Saved address deleted.");
          }}
        />
      )}
    </>
  );
}
