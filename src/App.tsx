import React, { useEffect, useState } from "react";
import { supabase } from "./lib/supabase";
import { AppShell } from "./app/layout/AppShell";
import { routes } from "./app/routes";
import { LoginPage } from "./features/auth/LoginPage";
import { Card } from "./ui/Card";

function matchRoute(path: string) {
  for (const r of routes) {
    if (r.path === path) return { route: r, params: {} as any };
    if (r.path.includes(":")) {
      const [base] = r.path.split("/:"); // e.g. "/workout"
      if (path.startsWith(base + "/")) {
        const paramName = r.path.split("/:")[1];
        const paramValue = path.slice((base + "/").length);
        return { route: r, params: { [paramName]: paramValue } };
      }
    }
  }
  return { route: routes[0], params: {} as any };
}

function normalizePath(p: string) {
  if (p.length > 1 && p.endsWith("/")) return p.slice(0, -1);
  return p;
}

function isLoginPath(p: string) {
  const n = normalizePath(p);
  return n === "/login" || n.startsWith("/login");
}

async function routeAfterLogin(navigate: (to: string) => void) {
  try {
    const { data: u, error: uErr } = await supabase.auth.getUser();
    if (uErr) throw uErr;
    if (!u.user) return navigate("/login");

    const { data: ab, error } = await supabase
      .from("program_blocks")
      .select("id")
      .eq("user_id", u.user.id)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) return navigate("/coach"); // RLS fallback

    if (ab?.id) navigate("/");
    else navigate("/coach");
  } catch {
    navigate("/coach");
  }
}

export default function App() {
  const [path, setPath] = useState(normalizePath(window.location.pathname));

  const [authChecked, setAuthChecked] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [routing, setRouting] = useState(false);

  const navigate = (to: string) => {
    const next = normalizePath(to);
    window.history.pushState({}, "", next);
    setPath(next);
  };

  useEffect(() => {
    const onPop = () => setPath(normalizePath(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    let mounted = true;

    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;

      const ok = !!data.session;
      setAuthed(ok);
      setAuthChecked(true);

      const p = normalizePath(window.location.pathname);

      if (ok && isLoginPath(p)) {
        setRouting(true);
        await routeAfterLogin(navigate);
        setRouting(false);
      }
      if (!ok && !isLoginPath(p)) {
        navigate("/login");
      }
    })();

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, session) => {
      const ok = !!session;
      setAuthed(ok);
      setAuthChecked(true);

      const p = normalizePath(window.location.pathname);

      if (!ok) {
        setRouting(false);
        if (!isLoginPath(p)) navigate("/login");
        return;
      }

      // ok=true
      if (isLoginPath(p)) {
        setRouting(true);
        await routeAfterLogin(navigate);
        setRouting(false);
      }
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  if (!authChecked) return null;

  // ✅ Logged out: always render login screen
  if (!authed) {
    return (
      <AppShell currentPath="/login" hideChrome={true} navigate={navigate}>
        <LoginPage navigate={navigate} />
      </AppShell>
    );
  }

  // ✅ Logged in but redirecting away from /login: show routing card (never blank)
  if (routing && isLoginPath(path)) {
    return (
      <AppShell currentPath="/login" hideChrome={true} navigate={navigate}>
        <div style={{ minHeight: "100svh", display: "grid", placeItems: "center", padding: 18 }}>
          <div style={{ width: "min(520px, 100%)" }}>
            <Card title="MVP TRAINER" tone="blue">
              <div className="tr-sub">Routing…</div>
            </Card>
          </div>
        </div>
      </AppShell>
    );
  }

  // ✅ No hooks here (no useMemo). Safe.
  const { route, params } = matchRoute(path);

  return (
    <AppShell currentPath={path} hideChrome={isLoginPath(path)} navigate={navigate}>
      {React.isValidElement(route.el)
        ? React.cloneElement(route.el as any, { params, navigate })
        : route.el}
    </AppShell>
  );
}