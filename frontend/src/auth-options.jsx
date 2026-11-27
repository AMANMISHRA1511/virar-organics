import React, { useEffect, useRef, useState } from "react";
import { Check, KeyRound, ShieldCheck, Smartphone } from "lucide-react";
import { api, getCsrf } from "./api";
import { useStore } from "./context";
import {
  Badge,
  Field,
  FormError,
  InlineNotice,
  Loading,
  Modal,
  SubmitButton,
} from "./components";

let googleScript;
function loadGoogleIdentity() {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (!googleScript)
    googleScript = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      script.onload = resolve;
      script.onerror = () => {
        googleScript = undefined;
        script.remove();
        reject(
          new Error(
            "Google sign-in could not load. You can still sign in with your email and password.",
          ),
        );
      };
      document.head.appendChild(script);
    });
  return googleScript;
}
function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M21.6 12.23c0-.71-.06-1.4-.18-2.07H12v3.92h5.38a4.6 4.6 0 0 1-1.99 3.02v2.5h3.22c1.88-1.73 2.99-4.28 2.99-7.37Z"
      />
      <path
        fill="#34A853"
        d="M12 22c2.7 0 4.96-.9 6.61-2.42l-3.22-2.5c-.9.6-2.05.96-3.39.96-2.6 0-4.8-1.76-5.59-4.12H3.09v2.58A10 10 0 0 0 12 22Z"
      />
      <path
        fill="#FBBC05"
        d="M6.41 13.92a6 6 0 0 1 0-3.84V7.5H3.09a10 10 0 0 0 0 9l3.32-2.58Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.96c1.47 0 2.79.51 3.83 1.51l2.87-2.87A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.91 5.5l3.32 2.58C7.2 7.72 9.4 5.96 12 5.96Z"
      />
    </svg>
  );
}
export function GoogleIdentity({ purpose = "signin", onSuccess }) {
  const { config, user, setUser, notify } = useStore();
  const [setup, setSetup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const container = useRef();
  const success = useRef(onSuccess);
  success.current = onSuccess;
  const enabled = Boolean(
    config.auth?.google?.enabled && config.auth?.google?.clientId,
  );
  const linked = Boolean(user?.google_linked || user?.googleLinked);
  useEffect(() => {
    if (!enabled || (purpose === "link" && linked)) return;
    let active = true;
    setLoading(true);
    setError("");
    Promise.all([
      loadGoogleIdentity(),
      api("/auth/google/challenge", { method: "POST", body: { purpose } }),
    ])
      .then(([, challenge]) => {
        if (!active || !container.current) return;
        window.google.accounts.id.initialize({
          client_id: config.auth.google.clientId,
          nonce: challenge.nonce,
          auto_select: false,
          callback: async ({ credential }) => {
            if (!active) return;
            setBusy(true);
            setError("");
            try {
              const result = await api("/auth/google", {
                method: "POST",
                body: { credential },
              });
              await getCsrf(true);
              const profile = result.user || result;
              setUser(profile);
              notify(
                purpose === "link"
                  ? "Your Google account is linked."
                  : "Signed in securely with Google.",
              );
              success.current?.(profile);
            } catch (err) {
              setError(err.message);
            } finally {
              if (active) setBusy(false);
            }
          },
        });
        container.current.replaceChildren();
        window.google.accounts.id.renderButton(container.current, {
          type: "standard",
          theme: "outline",
          size: "large",
          text: purpose === "link" ? "continue_with" : "signin_with",
          shape: "rectangular",
          width: Math.min(360, Math.max(220, container.current.clientWidth)),
        });
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
  }, [
    enabled,
    purpose,
    linked,
    config.auth?.google?.clientId,
    attempt,
    notify,
    setUser,
  ]);
  if (purpose === "link" && linked)
    return (
      <InlineNotice>
        <div className="linked-identity">
          <ShieldCheck size={19} />
          <span>
            Your Google account is linked. You can use Google to sign in.
          </span>
        </div>
      </InlineNotice>
    );
  return (
    <div className="google-identity">
      {enabled ? (
        <>
          {loading && <Loading inline label="Preparing Google sign-in…" />}
          <div
            ref={container}
            className={
              busy ? "google-button-container busy" : "google-button-container"
            }
          />
          {busy && <Loading inline label="Verifying your Google account…" />}
          <FormError error={error} />
          {error && (
            <button
              type="button"
              className="link-button"
              onClick={() => setAttempt((value) => value + 1)}
            >
              Retry Google sign-in
            </button>
          )}
        </>
      ) : (
        <>
          <button
            type="button"
            className="button secondary full google-setup-button"
            onClick={() => setSetup(true)}
          >
            <GoogleMark />
            {purpose === "link" ? "Link Google" : "Sign in with Google"}
            <small>Setup needed</small>
          </button>
          <p className="google-setup-hint">
            Google sign-in is included. Connect your Google client ID to enable
            it.
          </p>
        </>
      )}
      {setup && (
        <Modal title="Connect Google sign-in" onClose={() => setSetup(false)}>
          <p>
            This project supports real Google sign-in. It needs a Google OAuth
            client ID before it can verify an account.
          </p>
          <ol className="setup-steps">
            <li>
              Create a <strong>Web application</strong> OAuth client in Google
              Cloud Console and configure the consent screen.
            </li>
            <li>
              Add your frontend URL to{" "}
              <strong>Authorized JavaScript origins</strong>, such as{" "}
              <code>http://localhost:5173</code> and{" "}
              <code>http://127.0.0.1:5173</code> for local development.
            </li>
            <li>
              Set <code>GOOGLE_CLIENT_ID</code> in the backend <code>.env</code>{" "}
              file and restart the backend.
            </li>
            <li>
              Refresh this page. The official Google button will appear here.
            </li>
          </ol>
          <InlineNotice>
            Use your email and password while Google is unconfigured. This setup
            panel never pretends to authenticate a Google account. A customer
            with an existing password account should sign in first and link
            Google from their profile.
          </InlineNotice>
          <button className="button primary" onClick={() => setSetup(false)}>
            Got it
          </button>
        </Modal>
      )}
    </div>
  );
}
export function PhoneVerification() {
  const { user, setUser, config, notify } = useStore();
  const [phone, setPhone] = useState(user.phone || "");
  const [challenge, setChallenge] = useState(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState("");
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [completed, setCompleted] = useState(false);
  const mode = config.auth?.phone?.mode || "simulated";
  const remaining = Math.max(0, Math.ceil((resendAt - now) / 1000));
  const actuallyVerified =
    Boolean(user.phone_verified) &&
    phone === user.phone &&
    user.phone_verification_method !== "simulated";
  useEffect(() => {
    setPhone(user.phone || "");
    setChallenge(null);
  }, [user.phone]);
  useEffect(() => {
    if (!resendAt || resendAt <= Date.now()) return;
    const timer = setInterval(() => {
      const time = Date.now();
      setNow(time);
      if (time >= resendAt) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [resendAt]);
  const request = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setCompleted(false);
    try {
      const result = await api("/account/phone/request", {
        method: "POST",
        body: { phone },
      });
      setChallenge(result);
      setCode("");
      setResendAt(Date.now() + Number(result.retryAfter || 60) * 1000);
      setNow(Date.now());
      notify(
        result.mode === "simulated"
          ? "Demo code generated. No SMS was sent."
          : "Verification code requested. Check your phone.",
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const verify = async (event) => {
    event.preventDefault();
    setVerifying(true);
    setError("");
    try {
      const result = await api("/account/phone/verify", {
        method: "POST",
        body: { challengeId: challenge.challengeId, code },
      });
      const profile = result.user || result;
      setUser((current) => ({ ...current, ...profile }));
      setChallenge(null);
      setCode("");
      setCompleted(true);
      notify(
        profile.phone_verified
          ? "Phone number verified by SMS."
          : "Demo verification completed. No real phone ownership was verified.",
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setVerifying(false);
    }
  };
  return (
    <section className="form-card phone-verification">
      <div className="verification-heading">
        <div>
          <h2>Phone verification</h2>
          <p className="muted">
            Confirm your contact number for your customer account.
          </p>
        </div>
        {actuallyVerified ? (
          <Badge variant="active">SMS verified</Badge>
        ) : user.phone_verification_method === "simulated" &&
          phone === user.phone ? (
          <Badge variant="simulated">Demo checked</Badge>
        ) : (
          <Badge variant="neutral">Not verified</Badge>
        )}
      </div>
      {mode === "simulated" && (
        <InlineNotice>
          <strong>Free local demonstration</strong>
          <br />
          The code is displayed here instead of being sent by SMS. Completing it
          tests the OTP flow and does not prove ownership of a phone number.
        </InlineNotice>
      )}
      {mode === "disabled" ? (
        <InlineNotice>
          Phone verification is not configured. The store remains usable. Enable
          simulated mode for free local testing or configure an SMS provider in
          the backend environment.
        </InlineNotice>
      ) : (
        <>
          <form className="phone-request-form" onSubmit={request}>
            <Field label="Phone number to verify">
              <input
                type="tel"
                required
                maxLength={30}
                value={phone}
                onChange={(event) => {
                  setPhone(event.target.value);
                  setChallenge(null);
                  setCompleted(false);
                }}
                placeholder="+91 98765 43210"
                autoComplete="tel"
              />
            </Field>
            <SubmitButton
              busy={busy}
              disabled={remaining > 0 || verifying}
              className="secondary"
            >
              <Smartphone size={16} />
              {remaining > 0
                ? `Resend in ${remaining}s`
                : challenge
                  ? "Request another code"
                  : "Request verification code"}
            </SubmitButton>
          </form>
          {challenge && (
            <div className="otp-challenge">
              <p>
                {challenge.mode === "simulated"
                  ? "Demo code generated for this local test."
                  : "A verification code has been requested for your number."}{" "}
                This code is valid for{" "}
                {Math.ceil(Number(challenge.expiresIn || 300) / 60)} minutes
                from the request.
              </p>
              {challenge.mode === "simulated" && challenge.demoCode && (
                <div className="demo-otp-code">
                  <span>DEMO CODE · NO SMS SENT</span>
                  <code>{challenge.demoCode}</code>
                </div>
              )}
              <form onSubmit={verify} className="otp-verify-form">
                <Field label="Six-digit verification code">
                  <input
                    value={code}
                    onChange={(event) =>
                      setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
                    }
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    minLength={6}
                    maxLength={6}
                    required
                    placeholder="000000"
                  />
                </Field>
                <SubmitButton busy={verifying} disabled={busy}>
                  <KeyRound size={16} />
                  {challenge.mode === "simulated"
                    ? "Check demo code"
                    : "Verify phone"}
                </SubmitButton>
              </form>
            </div>
          )}
          {completed && (
            <div className="verification-completed">
              <Check size={17} />
              <span>
                {actuallyVerified
                  ? "Phone ownership verified using SMS."
                  : "Demo check completed. Real phone ownership remains unverified."}
              </span>
            </div>
          )}
        </>
      )}
      <FormError error={error} />
    </section>
  );
}
