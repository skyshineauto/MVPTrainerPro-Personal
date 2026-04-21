import React, { useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";

type NoticeTone = "idle" | "ok" | "err";

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [tone, setTone] = useState<NoticeTone>("idle");
  const [message, setMessage] = useState("");

  const redirectTo = useMemo(() => {
    const origin = window.location.origin.replace(/\/$/, "");
    return `${origin}/reset-password`;
  }, []);

  async function sendReset(e: React.FormEvent) {
    e.preventDefault();
    setTone("idle");
    setMessage("");

    const value = email.trim();
    if (!value) {
      setTone("err");
      setMessage("Enter your email address.");
      return;
    }

    setBusy(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(value, {
        redirectTo,
      });

      if (error) throw error;

      setTone("ok");
      setMessage(
        "Password reset email sent. Check your inbox and open the link in the same browser."
      );
    } catch (err: any) {
      setTone("err");
      setMessage(err?.message || "Could not send reset email.");
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
        <h1 style={styles.title}>Forgot Password</h1>
        <p style={styles.sub}>
          Enter your email and we’ll send you a secure password reset link.
        </p>

        <form onSubmit={sendReset} style={styles.form}>
          <label style={styles.label}>Email address</label>
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@domain.com"
            style={styles.input}
          />

          <button type="submit" disabled={busy} style={styles.primaryBtn}>
            {busy ? "SENDING..." : "SEND RESET LINK"}
          </button>

          <button
            type="button"
            style={styles.secondaryBtn}
            onClick={() => {
              window.location.pathname = "/login";
            }}
          >
            BACK TO LOGIN
          </button>
        </form>

        {message ? (
          <div
            style={{
              ...styles.notice,
              ...(tone === "ok" ? styles.noticeOk : styles.noticeErr),
            }}
          >
            {message}
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
    marginBottom: 24,
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
  },
  notice: {
    marginTop: 18,
    borderRadius: 14,
    padding: "12px 14px",
    fontWeight: 800,
    lineHeight: 1.4,
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