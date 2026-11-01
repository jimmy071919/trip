import { useCallback, useEffect, useState } from "react";
import LoginPage from "./components/LoginPage";
import Workspace from "./components/Workspace";
import { api, ApiError, setUnauthorizedHandler } from "./lib/api";
import { useStore } from "./lib/store";
import type { PublicConfig, User } from "./lib/types";

type Boot = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; config: PublicConfig; user: User | null; setup: boolean };

export default function App() {
  const [boot, setBoot] = useState<Boot>({ state: "loading" });

  const init = useCallback(async () => {
    setBoot({ state: "loading" });
    try {
      const [config, status] = await Promise.all([api.config(), api.authStatus()]);
      setBoot({ state: "ready", config, user: status.user, setup: status.setup_required });
    } catch (e) {
      setBoot({ state: "error", message: e instanceof ApiError ? e.message : String(e) });
    }
  }, []);

  useEffect(() => {
    init();
  }, [init]);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      useStore.getState().clearProject();
      setBoot((b) => (b.state === "ready" ? { ...b, user: null } : b));
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  if (boot.state === "loading") return <div className="flex h-full items-center justify-center text-slate-500">載入中…</div>;
  if (boot.state === "error")
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-slate-600">
        <p>{boot.message}</p>
        <button className="btn-primary" onClick={init}>
          重試
        </button>
      </div>
    );
  if (!boot.user)
    return <LoginPage setup={boot.setup} onLogin={(user) => setBoot({ ...boot, user, setup: false })} />;
  return (
    <Workspace
      config={boot.config}
      user={boot.user}
      onLogout={() => {
        useStore.getState().clearProject();
        setBoot({ ...boot, user: null });
      }}
    />
  );
}
