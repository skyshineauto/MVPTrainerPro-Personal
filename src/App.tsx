import React, { useEffect, useState } from "react";
import { supabase } from "./lib/supabase";
import { AppShell } from "./app/layout/AppShell";
import { routes } from "./app/routes";
import { LoginPage } from "./features/auth/LoginPage";
import { ForgotPasswordPage } from "./features/auth/ForgotPasswordPage";
import { ResetPasswordPage } from "./features/auth/ResetPasswordPage";
import { Card } from "./ui/Card";

function matchRoute(path: string) {
  for (const r of routes) {
    if (r.path === path) return { route: r, params: {} as any };

    if (r.path.includes(":")) {
      const [base] = r.path.split("/:");

      if (path.startsWith(base + "/")) {
        const paramName = r.path.split("/:")[1];
        const paramValue = path.slice((base + "/").length);

        return {
          route: r,
          params: { [paramName]: paramValue },
        };
      }
    }
  }

  return { route: routes[0], params: {} as any };
}

function normalizePath(path: string) {
  if (path.length > 1 && path.endsWith("/")) {
    return path.slice(0, -1);
  }

  return path;
}

function isLoginPath(path: string) {
  return normalizePath(path) === "/login";
}

function isForgotPasswordPath(path: string) {
  return normalizePath(path) === "/forgot-password";
}

function isResetPasswordPath(path: string) {
  return normalizePath(path) === "/reset-password";
}

function isPublicAuthPath(path: string) {
  return (
    isLoginPath(path) ||
    isForgotPasswordPath(path) ||
    isResetPasswordPath(path)
  );
}

async function routeAfterLogin(navigate: (to: string) => void) {
  try {
    const { data: userData, error: userError } =
      await supabase.auth.getUser();

    if (userError) throw userError;
    if (!userData.user) {
      navigate("/login");
      return;
    }

    const { data: activeBlock, error } = await supabase
      .from("program_blocks")
      .select("id")
      .eq("user_id", userData.user.id)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      navigate("/coach");
      return;
    }

    navigate(activeBlock?.id ? "/" : "/coach");
  } catch {
    navigate("/coach");
  }
}

export default function App() {
  const [path, setPath] = useState(
    normalizePath(window.location.pathname)
  );

  const [authChecked, setAuthChecked] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [routing, setRouting] = useState(false);

  const navigate = (to: string) => {
    const next = normalizePath(to);
    window.history.pushState({}, "", next);
    setPath(next);
  };

  useEffect(() => {
    const onPopState = () => {
      setPath(normalizePath(window.location.pathname));
    };

    window.addEventListener("popstate", onPopState);

    return () => {
      window.removeEventListener("popstate", onPopState);
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    async function checkInitialSession() {
      const { data } = await supabase.auth.getSession();

      if (!mounted) return;

      const hasSession = Boolean(data.session);
      const currentPath = normalizePath(window.location.pathname);

      setAuthed(hasSession);
      setAuthChecked(true);

      // A password-recovery page must always remain visible, even when
      // Supabase creates a temporary authenticated recovery session.
      if (isResetPasswordPath(currentPath)) {
        setRouting(false);
        return;
      }

      if (hasSession && isLoginPath(currentPath)) {
        setRouting(true);
        await routeAfterLogin(navigate);

        if (mounted) {
          setRouting(false);
        }

        return;
      }

      if (!hasSession && !isPublicAuthPath(currentPath)) {
        navigate("/login");
      }
    }

    void checkInitialSession();

    const { data: authListener } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (!mounted) return;

        const hasSession = Boolean(session);
        const currentPath = normalizePath(window.location.pathname);

        setAuthed(hasSession);
        setAuthChecked(true);

        // Supabase fires this event after a valid password-recovery link.
        // It must take priority over the normal signed-in dashboard.
        if (event === "PASSWORD_RECOVERY") {
          setRouting(false);

          if (!isResetPasswordPath(currentPath)) {
            navigate("/reset-password");
          }

          return;
        }

        if (!hasSession) {
          setRouting(false);

          if (!isPublicAuthPath(currentPath)) {
            navigate("/login");
          }

          return;
        }

        // Never route a recovery session away from the reset form.
        if (isResetPasswordPath(currentPath)) {
          setRouting(false);
          return;
        }

        if (isLoginPath(currentPath)) {
          setRouting(true);
          await routeAfterLogin(navigate);

          if (mounted) {
            setRouting(false);
          }
        }
      }
    );

    return () => {
      mounted = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  if (!authChecked) {
    return null;
  }

  // Password recovery is intentionally rendered before the normal auth gate.
  // This fixes recovery links opening the regular logged-in dashboard.
  if (isResetPasswordPath(path)) {
    return (
      <AppShell
        currentPath="/reset-password"
        hideChrome={true}
        navigate={navigate}
      >
        <ResetPasswordPage navigate={navigate} />
      </AppShell>
    );
  }

  if (isForgotPasswordPath(path)) {
    return (
      <AppShell
        currentPath="/forgot-password"
        hideChrome={true}
        navigate={navigate}
      >
        <ForgotPasswordPage navigate={navigate} />
      </AppShell>
    );
  }

  if (!authed) {
    return (
      <AppShell
        currentPath="/login"
        hideChrome={true}
        navigate={navigate}
      >
        <LoginPage navigate={navigate} />
      </AppShell>
    );
  }

  if (routing || isLoginPath(path)) {
    return (
      <AppShell
        currentPath="/login"
        hideChrome={true}
        navigate={navigate}
      >
        <div
          style={{
            minHeight: "100svh",
            display: "grid",
            placeItems: "center",
            padding: 18,
          }}
        >
          <div style={{ width: "min(520px, 100%)" }}>
            <Card title="MVP TRAINER" tone="blue">
              <div className="tr-sub">Routing…</div>
            </Card>
          </div>
        </div>
      </AppShell>
    );
  }

  const { route, params } = matchRoute(path);

  return (
    <AppShell
      currentPath={path}
      hideChrome={false}
      navigate={navigate}
    >
      {React.isValidElement(route.el)
        ? React.cloneElement(route.el as any, {
            params,
            navigate,
          })
        : route.el}
    </AppShell>
  );
}
