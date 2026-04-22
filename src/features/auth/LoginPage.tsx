// src/features/auth/LoginPage.tsx
import React, { useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { Card } from "../../ui/Card";

export function LoginPage({
  navigate,
}: {
  navigate?: (to: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showPw, setShowPw] = useState(false);

  const bgUrl = "/login-bg.jpg";

  const canSubmit = useMemo(() => {
    if (busy) return false;
    if (!email.trim()) return false;
    if (!password.trim()) return false;
    return true;
  }, [email, password, busy]);

  async function onSignIn(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setBusy(true);
    setErr(null);

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) throw error;

      if (navigate) navigate("/");
      else window.location.pathname = "/";
    } catch (e: any) {
      setErr(e?.message ?? "Sign in failed.");
    } finally {
      setBusy(false);
    }
  }

  const EMBERS = Array.from({ length: 16 }).map((_, i) => ({
    i,
    x: `${6 + ((i * 7) % 88)}%`,
    size: `${6 + ((i * 5) % 14)}px`,
    dur: `${10 + ((i * 3) % 10)}s`,
    delay: `${-((i * 0.9) % 8)}s`,
    blur: `${0.6 + ((i * 0.15) % 1.2)}px`,
    op: `${0.18 + ((i * 0.04) % 0.22)}`,
  }));

  const SPARKS = Array.from({ length: 10 }).map((_, i) => ({
    i,
    x: `${10 + ((i * 9) % 80)}%`,
    size: `${2 + ((i * 2) % 3)}px`,
    dur: `${7 + ((i * 2) % 7)}s`,
    delay: `${-((i * 0.7) % 6)}s`,
    op: `${0.16 + ((i * 0.05) % 0.20)}`,
  }));

  const BOKEH = Array.from({ length: 6 }).map((_, i) => ({
    i,
    x: `${8 + ((i * 15) % 84)}%`,
    y: `${20 + ((i * 11) % 55)}%`,
    size: `${140 + ((i * 90) % 180)}px`,
    dur: `${14 + ((i * 4) % 10)}s`,
    delay: `${-((i * 1.1) % 9)}s`,
    op: `${0.10 + ((i * 0.03) % 0.12)}`,
  }));

  return (
    <div
      style={{
        minHeight: "100vh",
        position: "relative",
        overflow: "hidden",
        display: "grid",
        placeItems: "center",
        padding: "24px",
        background:
          "linear-gradient(180deg, rgba(2,8,14,.96), rgba(1,5,10,.985))",
      }}
    >
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: `
            linear-gradient(180deg, rgba(0,0,0,.40), rgba(0,0,0,.68)),
            radial-gradient(circle at 18% 16%, rgba(0,170,255,.18), transparent 26%),
            radial-gradient(circle at 84% 14%, rgba(255,140,0,.14), transparent 28%),
            url(${bgUrl})
          `,
          backgroundSize: "cover",
          backgroundPosition: "center center",
          filter: "saturate(.92) contrast(1.02) brightness(.82)",
          transform: "scale(1.02)",
        }}
      />

      <div className="tr-loginFX">
        <div className="tr-loginBokeh">
          {BOKEH.map((p) => (
            <span
              key={`bokeh-${p.i}`}
              style={
                {
                  ["--x" as any]: p.x,
                  ["--y" as any]: p.y,
                  ["--sz" as any]: p.size,
                  ["--dur" as any]: p.dur,
                  ["--delay" as any]: p.delay,
                  ["--op" as any]: p.op,
                } as any
              }
            />
          ))}
        </div>

        <div className="tr-loginEmbers">
          {EMBERS.map((p) => (
            <span
              key={`ember-${p.i}`}
              style={
                {
                  ["--x" as any]: p.x,
                  ["--sz" as any]: p.size,
                  ["--dur" as any]: p.dur,
                  ["--delay" as any]: p.delay,
                  ["--blur" as any]: p.blur,
                  ["--op" as any]: p.op,
                } as any
              }
            />
          ))}
        </div>

        <div className="tr-loginSparks">
          {SPARKS.map((p) => (
            <span
              key={`spark-${p.i}`}
              style={
                {
                  ["--x" as any]: p.x,
                  ["--sz" as any]: p.size,
                  ["--dur" as any]: p.dur,
                  ["--delay" as any]: p.delay,
                  ["--op" as any]: p.op,
                } as any
              }
            />
          ))}
        </div>
      </div>

      <div style={{ position: "relative", width: "min(600px, 100%)", zIndex: 2 }}>
        <div style={{ textAlign: "center", marginBottom: 14 }}>
          <div className="tr-loginHeroTitle">MVP Trainer Pro</div>
          <div style={{ marginTop: 6, fontWeight: 950, fontSize: 28, opacity: 0.95 }}>
            Sign in to continue
          </div>
          <div className="tr-sub" style={{ marginTop: 8 }}>
            Real AI Coach-driven programming. Track workouts. Fix issues.
          </div>
        </div>

        <div className="tr-loginShell">
          <Card title="Sign In" tone="blue">
            <div className="tr-loginInnerFrame">
              {err ? (
                <div
                  className="tr-rowbox"
                  style={{
                    borderColor: "rgba(255,80,80,.35)",
                    background: "rgba(210,245,255,.98)",
                    fontWeight: 900,
                  }}
                >
                  {err}
                </div>
              ) : null}

              <form onSubmit={onSignIn} className="tr-loginForm">
                <div style={{ display: "grid", gap: 8 }}>
                  <div className="tr-kicker tr-loginKicker">EMAIL ADDRESS</div>
                  <input
                    className="tr-loginInput"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@domain.com"
                    autoComplete="email"
                    inputMode="email"
                    style={{ height: 50 }}
                  />
                </div>

                <div style={{ display: "grid", gap: 8 }}>
                  <div className="tr-kicker tr-loginKicker">PASSWORD</div>
                  <input
                    className="tr-loginInput"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    type={showPw ? "text" : "password"}
                    autoComplete="current-password"
                    style={{ height: 50 }}
                  />

                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 10,
                      flexWrap: "wrap",
                    }}
                  >
                    <button
                      type="button"
                      className="tr-seg tr-loginShow"
                      onClick={() => setShowPw((v) => !v)}
                      style={{ flex: "0 0 auto" }}
                    >
                      {showPw ? "HIDE" : "SHOW"}
                    </button>

                    <button
                      type="button"
                      className="tr-loginForgot"
                      onClick={() => {
                        if (navigate) navigate("/forgot-password");
                        else window.location.pathname = "/forgot-password";
                      }}
                    >
                      Forgot password?
                    </button>
                  </div>

                  <div className="tr-sub tr-loginPrivacy" style={{ textAlign: "right" }}>
                    Your data stays private.
                  </div>
                </div>

                <div className="tr-loginActionsRow">
                  <button
                    type="submit"
                    disabled={!canSubmit}
                    className="tr-btn tr-loginBtnPrimary"
                  >
                    {busy ? "SIGNING IN…" : "SIGN IN"}
                  </button>

                  <button
                    type="button"
                    className="tr-btn tr-loginBtnSecondary"
                    onClick={() => window.location.reload()}
                  >
                    REFRESH
                  </button>
                </div>

                <div className="tr-sub" style={{ textAlign: "center", marginTop: 4 }}>
                  © 2026 MVP Trainer Pro
                </div>
              </form>
            </div>
          </Card>
        </div>
      </div>

      <style>{`
        .tr-loginHeroTitle{
          font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
          font-weight: 1000;
          font-size: clamp(48px, 6vw, 64px);
          letter-spacing: -0.02em;
          line-height: 1.02;
          color: rgba(255,140,0,.98);
          text-shadow:
            0 2px 0 rgba(0,0,0,.60),
            0 0 20px rgba(255,140,0,.22),
            0 0 44px rgba(255,140,0,.14);
          display: inline-block;
          padding: 2px 10px 6px;
        }

        .tr-loginFX{
          position:absolute;
          inset:0;
          pointer-events:none;
          z-index:0;
        }

        .tr-loginBokeh span{
          position:absolute;
          left: var(--x);
          top: var(--y);
          width: var(--sz);
          height: var(--sz);
          border-radius: 999px;
          opacity: var(--op);
          filter: blur(18px);
          background:
            radial-gradient(circle at 30% 30%,
              rgba(255,255,255,.10),
              rgba(0,170,255,.14) 38%,
              rgba(0,0,0,0) 70%);
          transform: translate3d(-50%, -50%, 0);
          animation: trBokehFloat var(--dur) ease-in-out infinite;
          animation-delay: var(--delay);
          mix-blend-mode: screen;
        }

        @keyframes trBokehFloat{
          0%   { transform: translate3d(-50%, -50%, 0) scale(1); }
          50%  { transform: translate3d(calc(-50% + 10px), calc(-50% - 12px), 0) scale(1.05); }
          100% { transform: translate3d(-50%, -50%, 0) scale(1); }
        }

        .tr-loginEmbers span{
          position:absolute;
          left: var(--x);
          bottom: -24px;
          width: var(--sz);
          height: var(--sz);
          border-radius: 999px;
          opacity: var(--op);
          filter: blur(var(--blur));
          background:
            radial-gradient(circle at 35% 35%,
              rgba(255,210,120,.96),
              rgba(255,150,0,.62) 45%,
              rgba(255,120,0,0) 72%);
          animation: trEmberRise var(--dur) linear infinite;
          animation-delay: var(--delay);
          mix-blend-mode: screen;
        }

        @keyframes trEmberRise{
          0%{
            transform: translate3d(0, 0, 0) scale(.9);
            opacity: var(--op);
          }
          85%{
            opacity: calc(var(--op) * .92);
          }
          100%{
            transform: translate3d(18px, -92vh, 0) scale(1.18);
            opacity: 0;
          }
        }

        .tr-loginSparks span{
          position:absolute;
          left: var(--x);
          bottom: 6%;
          width: var(--sz);
          height: 54px;
          opacity: var(--op);
          background:
            linear-gradient(180deg,
              rgba(255,220,160,0),
              rgba(255,170,40,.9) 26%,
              rgba(255,150,0,.38) 62%,
              rgba(255,150,0,0));
          filter: blur(.4px);
          transform: translateY(0) rotate(12deg);
          animation: trSparkRise var(--dur) linear infinite;
          animation-delay: var(--delay);
          mix-blend-mode: screen;
        }

        @keyframes trSparkRise{
          0%{
            transform: translate3d(0, 0, 0) rotate(12deg);
            opacity: var(--op);
          }
          100%{
            transform: translate3d(18px, -72vh, 0) rotate(18deg);
            opacity: 0;
          }
        }

        .tr-loginShell{
          border-radius: 28px;
          padding: 2px;
          background:
            linear-gradient(180deg, rgba(0,170,255,.22), rgba(255,140,0,.08));
          box-shadow:
            0 28px 110px rgba(0,0,0,.58),
            0 0 40px rgba(0,170,255,.10);
        }

        .tr-loginInnerFrame{
          border-radius: 24px;
          padding: 14px;
          background:
            linear-gradient(180deg, rgba(3,10,17,.84), rgba(2,7,12,.88));
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,.05),
            inset 0 0 0 1px rgba(0,170,255,.08);
        }

        .tr-loginForm{
          display: grid;
          gap: 14px;
        }

        .tr-loginKicker{
          color: rgba(220,245,255,.92) !important;
          letter-spacing: .14em !important;
          font-weight: 1000 !important;
        }

        .tr-loginInput{
          background: rgba(0,0,0,.62) !important;
          border: 1px solid rgba(0,170,255,.18) !important;
          border-radius: 14px !important;
          color: rgba(255,255,255,.94) !important;
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,.06),
            inset 0 0 0 1px rgba(0,0,0,.35),
            0 18px 50px rgba(0,0,0,.36) !important;
          padding: 0 14px;
          font-weight: 900;
          letter-spacing: .02em;
          width: 100%;
        }

        input.tr-loginInput::placeholder{
          color: rgba(180, 235, 255, .46) !important;
          letter-spacing: .06em;
          font-weight: 850;
        }

        input.tr-loginInput:focus{
          outline: none !important;
          border-color: rgba(0,170,255,.78) !important;
          box-shadow:
            inset 0 0 0 1px rgba(0,170,255,.18),
            0 0 0 1px rgba(0,170,255,.22) inset,
            0 0 22px rgba(0,170,255,.16),
            0 18px 55px rgba(0,0,0,.50) !important;
        }

        button.tr-loginShow{
          height: 40px !important;
          padding: 0 16px !important;
          border-radius: 14px !important;
          border: 1px solid rgba(0,170,255,.55) !important;
          background:
            radial-gradient(260px 120px at 50% 30%, rgba(0,170,255,.18), transparent 68%),
            linear-gradient(180deg, rgba(255,255,255,.10), rgba(0,0,0,.26)) !important;
          color: rgba(255,255,255,.96) !important;
          font-weight: 1100 !important;
          letter-spacing: .16em !important;
          box-shadow:
            inset 0 0 0 1px rgba(0,170,255,.10),
            inset 0 1px 0 rgba(255,255,255,.10),
            0 16px 50px rgba(0,0,0,.48),
            0 0 14px rgba(0,170,255,.10) !important;
          cursor: pointer;
        }

        .tr-loginForgot{
          appearance: none;
          border: 0;
          background: transparent;
          color: rgba(120,220,255,.94);
          font-weight: 900;
          letter-spacing: .06em;
          cursor: pointer;
          text-decoration: underline;
          text-underline-offset: 3px;
          padding: 4px 0;
        }

        .tr-loginForgot:hover{
          color: rgba(180,240,255,.98);
          text-shadow: 0 0 12px rgba(0,170,255,.16);
        }

        .tr-loginPrivacy{
          color: rgba(220,235,245,.70) !important;
        }

        .tr-loginActionsRow{
          display: grid;
          gap: 10px;
          justify-items: center;
          margin-top: 2px;
        }

        button.tr-loginBtnPrimary{
          width: 100%;
          max-width: 440px;
          height: 56px !important;
          border-radius: 16px !important;
          position: relative;
          overflow: hidden;
          border: 1px solid rgba(0,170,255,.86) !important;
          background:
            radial-gradient(520px 220px at 50% 35%,
              rgba(0,170,255,.28) 0%,
              rgba(0,170,255,.14) 36%,
              rgba(0,0,0,0) 72%),
            linear-gradient(180deg, rgba(0,170,255,.30), rgba(0,170,255,.12)) !important;
          color: rgba(255,255,255,.96) !important;
          font-weight: 1100 !important;
          letter-spacing: .12em !important;
          text-transform: uppercase !important;
          box-shadow:
            inset 0 0 0 1px rgba(0,170,255,.14),
            inset 0 1px 0 rgba(255,255,255,.10),
            0 26px 90px rgba(0,0,0,.62),
            0 0 22px rgba(0,170,255,.18),
            0 0 56px rgba(0,170,255,.12) !important;
          transition: transform .14s ease, filter .14s ease, border-color .14s ease;
          transform: translateZ(0);
          cursor: pointer;
        }

        button.tr-loginBtnPrimary::after{
          content:"";
          position:absolute;
          inset:-60% -40%;
          background: linear-gradient(115deg, transparent 0%, rgba(255,255,255,.22) 46%, rgba(255,255,255,.06) 54%, transparent 64%);
          transform: translateX(-80%);
          opacity: 0;
          pointer-events:none;
        }

        button.tr-loginBtnPrimary:hover{
          transform: translateY(-1px);
          filter: saturate(1.08) contrast(1.02);
          border-color: rgba(0,170,255,.98) !important;
        }

        button.tr-loginBtnPrimary:hover::after{
          opacity: .70;
          animation: trLoginSweep 1.1s ease forwards;
        }

        button.tr-loginBtnPrimary:disabled{
          opacity:.55;
          cursor:not-allowed;
          filter:none;
          transform:none;
        }

        button.tr-loginBtnSecondary{
          width: min(260px, 100%);
          height: 44px !important;
          border-radius: 14px !important;
          border: 1px solid rgba(255,255,255,.12) !important;
          background:
            linear-gradient(180deg, rgba(255,255,255,.08), rgba(0,0,0,.18)) !important;
          color: rgba(255,255,255,.92) !important;
          font-weight: 1000 !important;
          letter-spacing: .12em !important;
          text-transform: uppercase !important;
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,.08),
            0 20px 50px rgba(0,0,0,.44) !important;
          cursor: pointer;
        }

        @keyframes trLoginSweep{
          from { transform: translateX(-80%); }
          to   { transform: translateX(80%); }
        }

        @media (max-width: 640px){
          .tr-loginHeroTitle{
            font-size: clamp(40px, 10vw, 52px);
          }
        }
      `}</style>
    </div>
  );
}
