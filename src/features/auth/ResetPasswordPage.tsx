import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";

type PageState = "loading" | "ready" | "success" | "fatal";

function parseHashTokens() {
  const rawHash = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;

  const params = new URLSearchParams(rawHash);

  return {
    accessToken: params.get("access_token"),
    refreshToken: params.get("refresh_token"),
    type: params.get("type"),
  };
}

export function ResetPasswordPage({
  navigate,
}: {
  navigate?: (to: string) => void;
}) {
  const [pageState, setPageState] = useState<PageState>("loading");
  const [message, setMessage] = useState(
    "Preparing secure password reset..."
  );
  const [formError, setFormError] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const hasRecoveryParameters = useMemo(() => {
    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");
    const { accessToken, refreshToken, type } = parseHashTokens();

    return Boolean(
      code ||
        (type === "recovery" && accessToken && refreshToken)
    );
  }, []);

  useEffect(() => {
    let alive = true;

    async function prepareRecoverySession() {
      try {
        const url = new URL(window.location.href);
        const code = url.searchParams.get("code");

        if (code) {
          const { error } =
            await supabase.auth.exchangeCodeForSession(code);

          if (error) throw error;

          window.history.replaceState(
            {},
            document.title,
            "/reset-password"
          );

          if (!alive) return;

          setPageState("ready");
          setMessage("Enter your new password below.");
          return;
        }

        const { accessToken, refreshToken, type } =
          parseHashTokens();

        if (
          type === "recovery" &&
          accessToken &&
          refreshToken
        ) {
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });

          if (error) throw error;

          window.history.replaceState(
            {},
            document.title,
            "/reset-password"
          );

          if (!alive) return;

          setPageState("ready");
          setMessage("Enter your new password below.");
          return;
        }

        const {
          data: { session },
        } = await supabase.auth.getSession();

        // This also allows a user who is already signed in to set a new
        // password from the recovery page.
        if (session) {
          if (!alive) return;

          setPageState("ready");
          setMessage("Enter your new password below.");
          return;
        }

        throw new Error(
          "This recovery link is invalid or has expired. Request a new one."
        );
      } catch (error: any) {
        if (!alive) return;

        setPageState("fatal");
        setMessage(
          error?.message ||
            "This recovery link is invalid or has expired. Request a new one."
        );
      }
    }

    void prepareRecoverySession();

    return () => {
      alive = false;
    };
  }, []);

  async function updatePassword(
    event: React.FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    if (pageState !== "ready" || busy) {
      return;
    }

    setFormError("");

    if (password.length < 8) {
      setFormError("Password must be at least 8 characters.");
      return;
    }

    if (password !== confirmPassword) {
      setFormError("Passwords do not match.");
      return;
    }

    setBusy(true);
    setMessage("Updating password...");

    try {
      const { error } = await supabase.auth.updateUser({
        password,
      });

      if (error) throw error;

      setPassword("");
      setConfirmPassword("");
      setPageState("success");
      setMessage(
        "Password updated successfully. Your account is ready."
      );
    } catch (error: any) {
      setFormError(
        error?.message || "Could not update password."
      );
      setMessage("Enter your new password below.");
    } finally {
      setBusy(false);
    }
  }

  function goTo(path: string) {
    if (navigate) {
      navigate(path);
      return;
    }

    window.location.pathname = path;
  }

  return (
    <div style={styles.page}>
      <div style={styles.bgGlowA} />
      <div style={styles.bgGlowB} />

      <div style={styles.card}>
        <div style={styles.kicker}>MVP Trainer</div>
        <h1 style={styles.title}>Reset Password</h1>
        <p style={styles.sub}>
          Secure your account with a fresh password.
        </p>

        {pageState === "loading" ? (
          <div
            style={{
              ...styles.notice,
              ...styles.noticeInfo,
            }}
          >
            {message}
          </div>
        ) : null}

        {pageState === "fatal" ? (
          <>
            <div
              style={{
                ...styles.notice,
                ...styles.noticeErr,
              }}
            >
              {message}
            </div>

            <button
              type="button"
              style={{
                ...styles.secondaryBtn,
                marginTop: 18,
              }}
              onClick={() => goTo("/forgot-password")}
            >
              REQUEST NEW RESET LINK
            </button>

            <button
              type="button"
              style={{
                ...styles.textBtn,
                marginTop: 10,
              }}
              onClick={() => goTo("/login")}
            >
              BACK TO LOGIN
            </button>
          </>
        ) : null}

        {pageState === "ready" ? (
          <>
            <div
              style={{
                ...styles.notice,
                ...styles.noticeInfo,
              }}
            >
              {message}
            </div>

            {formError ? (
              <div
                style={{
                  ...styles.notice,
                  ...styles.noticeErr,
                  marginTop: 12,
                }}
              >
                {formError}
              </div>
            ) : null}

            <form
              onSubmit={updatePassword}
              style={{
                ...styles.form,
                marginTop: 18,
              }}
            >
              <label style={styles.label}>
                New password
              </label>

              <input
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) =>
                  setPassword(event.target.value)
                }
                placeholder="Minimum 8 characters"
                style={styles.input}
                disabled={busy}
              />

              <label style={styles.label}>
                Confirm password
              </label>

              <input
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) =>
                  setConfirmPassword(event.target.value)
                }
                placeholder="Re-enter password"
                style={styles.input}
                disabled={busy}
              />

              <button
                type="submit"
                disabled={busy}
                style={{
                  ...styles.primaryBtn,
                  opacity: busy ? 0.65 : 1,
                  cursor: busy ? "not-allowed" : "pointer",
                }}
              >
                {busy
                  ? "UPDATING..."
                  : "UPDATE PASSWORD"}
              </button>
            </form>
          </>
        ) : null}

        {pageState === "success" ? (
          <>
            <div
              style={{
                ...styles.notice,
                ...styles.noticeOk,
              }}
            >
              {message}
            </div>

            <button
              type="button"
              style={{
                ...styles.primaryBtn,
                width: "100%",
                marginTop: 18,
              }}
              onClick={() => goTo("/")}
            >
              RETURN TO MVP TRAINER
            </button>
          </>
        ) : null}

        {!hasRecoveryParameters &&
        pageState === "ready" ? (
          <div style={styles.sessionNote}>
            You are already signed in. Saving will update the
            password for the current MVP Trainer account.
          </div>
        ) : null}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    display: "grid",
    placeItems: "center",
    position: "relative",
    overflow: "hidden",
    background:
      "radial-gradient(circle at 15% 20%, rgba(0,160,255,.20), transparent 28%), radial-gradient(circle at 85% 18%, rgba(0,90,180,.14), transparent 24%), linear-gradient(180deg, #04101b 0%, #02070d 55%, #010409 100%)",
    padding: "24px",
  },
  bgGlowA: {
    position: "absolute",
    inset: "auto auto 8% 10%",
    width: 340,
    height: 340,
    borderRadius: "50%",
    background: "rgba(0,180,255,.10)",
    filter: "blur(70px)",
    pointerEvents: "none",
  },
  bgGlowB: {
    position: "absolute",
    inset: "10% 12% auto auto",
    width: 320,
    height: 320,
    borderRadius: "50%",
    background: "rgba(0,110,255,.08)",
    filter: "blur(80px)",
    pointerEvents: "none",
  },
  card: {
    width: "min(520px, 100%)",
    borderRadius: 24,
    border: "1px solid rgba(90,200,255,.28)",
    background:
      "linear-gradient(180deg, rgba(10,20,34,.94), rgba(3,9,16,.96))",
    boxShadow:
      "0 30px 120px rgba(0,0,0,.55), 0 0 26px rgba(0,170,255,.10), inset 0 1px 0 rgba(255,255,255,.08)",
    padding: 28,
    position: "relative",
    zIndex: 1,
  },
  kicker: {
    color: "rgba(120,220,255,.92)",
    fontSize: 12,
    fontWeight: 900,
    letterSpacing: ".22em",
    textTransform: "uppercase",
    marginBottom: 10,
  },
  title: {
    margin: 0,
    color: "#ffffff",
    fontSize: "clamp(28px, 5vw, 40px)",
    lineHeight: 1,
    fontWeight: 1000,
  },
  sub: {
    marginTop: 12,
    marginBottom: 18,
    color: "rgba(220,235,245,.78)",
    fontSize: 15,
    lineHeight: 1.5,
  },
  form: {
    display: "grid",
    gap: 12,
  },
  label: {
    color: "rgba(190,220,240,.92)",
    fontSize: 12,
    fontWeight: 900,
    letterSpacing: ".14em",
    textTransform: "uppercase",
  },
  input: {
    height: 52,
    borderRadius: 14,
    border: "1px solid rgba(90,170,220,.26)",
    background: "rgba(2,10,18,.92)",
    color: "#fff",
    padding: "0 14px",
    fontSize: 16,
    fontWeight: 700,
    outline: "none",
    boxShadow:
      "inset 0 1px 0 rgba(255,255,255,.04)",
  },
  primaryBtn: {
    height: 52,
    borderRadius: 14,
    border: "1px solid rgba(0,170,255,.46)",
    background:
      "linear-gradient(180deg, rgba(0,170,255,.20), rgba(0,90,180,.16))",
    color: "#fff",
    fontWeight: 1000,
    letterSpacing: ".14em",
    textTransform: "uppercase",
    cursor: "pointer",
  },
  secondaryBtn: {
    height: 48,
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,.12)",
    background:
      "linear-gradient(180deg, rgba(255,255,255,.05), rgba(0,0,0,.10))",
    color: "rgba(255,255,255,.92)",
    fontWeight: 900,
    letterSpacing: ".12em",
    textTransform: "uppercase",
    cursor: "pointer",
    width: "100%",
  },
  textBtn: {
    width: "100%",
    border: 0,
    background: "transparent",
    color: "rgba(120,220,255,.92)",
    fontWeight: 900,
    letterSpacing: ".10em",
    textTransform: "uppercase",
    cursor: "pointer",
    padding: 10,
  },
  notice: {
    borderRadius: 14,
    padding: "12px 14px",
    fontWeight: 800,
    lineHeight: 1.4,
  },
  noticeInfo: {
    border: "1px solid rgba(0,170,255,.22)",
    background: "rgba(0,170,255,.10)",
    color: "rgba(225,245,255,.96)",
  },
  noticeOk: {
    border: "1px solid rgba(0,200,120,.28)",
    background: "rgba(0,200,120,.10)",
    color: "rgba(220,255,240,.96)",
  },
  noticeErr: {
    border: "1px solid rgba(255,90,90,.28)",
    background: "rgba(255,90,90,.10)",
    color: "rgba(255,230,230,.96)",
  },
  sessionNote: {
    marginTop: 14,
    color: "rgba(210,230,242,.68)",
    fontSize: 13,
    lineHeight: 1.45,
    textAlign: "center",
  },
};
