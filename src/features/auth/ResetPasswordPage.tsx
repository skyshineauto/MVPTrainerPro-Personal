import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";

type Status = "loading" | "ready" | "success" | "error";

function parseHashTokens() {
  const raw = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;

  const params = new URLSearchParams(raw);
  const access_token = params.get("access_token");
  const refresh_token = params.get("refresh_token");
  const type = params.get("type");

  return { access_token, refresh_token, type };
}

export function ResetPasswordPage({
  navigate,
}: {
  navigate?: (to: string) => void;
}) {
  const [status, setStatus] = useState<Status>("loading");
  const [message, setMessage] = useState("Preparing secure password reset...");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const hasRecoveryParams = useMemo(() => {
    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");
    const { access_token, refresh_token, type } = parseHashTokens();

    return Boolean(
      code || (type === "recovery" && access_token && refresh_token)
    );
  }, []);

  useEffect(() => {
    let alive = true;

    async function bootstrap() {
      try {
        const url = new URL(window.location.href);
        const code = url.searchParams.get("code");

        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;

          if (!alive) return;
          setStatus("ready");
          setMessage("Enter your new password below.");
          return;
        }

        const { access_token, refresh_token, type } = parseHashTokens();

        if (type === "recovery" && access_token && refresh_token) {
          const { error } = await supabase.auth.setSession({
            access_token,
            refresh_token,
          });
          if (error) throw error;

          window.history.replaceState({}, document.title, "/reset-password");

          if (!alive) return;
          setStatus("ready");
          setMessage("Enter your new password below.");
          return;
        }

        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (session) {
          if (!alive) return;
          setStatus("ready");
          setMessage("Enter your new password below.");
          return;
        }

        throw new Error("Recovery link is missing or invalid.");
      } catch (err: any) {
        if (!alive) return;
        setStatus("error");
        setMessage(
          err?.message ||
            "This recovery link is invalid or has expired. Request a new one."
        );
      }
    }

    void bootstrap();

    return () => {
      alive = false;
    };
  }, []);

  async function updatePassword(e: React.FormEvent) {
    e.preventDefault();

    if (status !== "ready") return;

    if (!password || password.length < 8) {
      setStatus("error");
      setMessage("Password must be at least 8 characters.");
      return;
    }

    if (password !== confirm) {
      setStatus("error");
      setMessage("Passwords do not match.");
      return;
    }

    setBusy(true);
    setStatus("ready");
    setMessage("Updating password...");

    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;

      setStatus("success");
      setMessage("Password updated successfully. You can sign in now.");
      setPassword("");
      setConfirm("");
    } catch (err: any) {
      setStatus("error");
      setMessage(err?.message || "Could not update password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.bgGlowA} />
      <div style={styles.bgGlowB} />

      <div style={styles.card}>
        <div style={styles.kicker}>MVP Trainer</div>
        <h1 style={styles.title}>Reset Password</h1>
        <p style={styles.sub}>Secure your account with a fresh password.</p>

        {status === "loading" ? (
          <div style={{ ...styles.notice, ...styles.noticeInfo }}>{message}</div>
        ) : null}

        {status === "error" ? (
          <>
            <div style={{ ...styles.notice, ...styles.noticeErr }}>{message}</div>

            {!hasRecoveryParams ? (
              <button
                type="button"
                style={{ ...styles.secondaryBtn, marginTop: 18 }}
                onClick={() => {
                  if (navigate) navigate("/forgot-password");
                  else window.location.pathname = "/forgot-password";
                }}
              >
                REQUEST NEW RESET LINK
              </button>
            ) : null}
          </>
        ) : null}

        {(status === "ready" || status === "success") && (
          <>
            <div
              style={{
                ...styles.notice,
                ...(status === "success" ? styles.noticeOk : styles.noticeInfo),
              }}
            >
              {message}
            </div>

            {status === "ready" && (
              <form onSubmit={updatePassword} style={{ ...styles.form, marginTop: 18 }}>
                <label style={styles.label}>New password</label>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Minimum 8 characters"
                  style={styles.input}
                />

                <label style={styles.label}>Confirm password</label>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Re-enter password"
                  style={styles.input}
                />

                <button type="submit" disabled={busy} style={styles.primaryBtn}>
                  {busy ? "UPDATING..." : "UPDATE PASSWORD"}
                </button>
              </form>
            )}

            {status === "success" && (
              <button
                type="button"
                style={{ ...styles.secondaryBtn, marginTop: 18 }}
                onClick={() => {
                  if (navigate) navigate("/login");
                  else window.location.pathname = "/login";
                }}
              >
                GO TO LOGIN
              </button>
            )}
          </>
        )}
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
    boxShadow: "inset 0 1px 0 rgba(255,255,255,.04)",
  },
  primaryBtn: {
    height: 52,
    marginTop: 8,
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
};
