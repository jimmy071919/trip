import { useState } from "react";
import { api, ApiError } from "../lib/api";
import type { User } from "../lib/types";
import { Field, FormError } from "./Field";

export default function LoginPage({ setup, onLogin }: { setup: boolean; onLogin: (u: User) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setFields({});
    if (setup && password !== confirm) return setFields({ confirm: "兩次輸入的密碼不一致" });
    if (setup && password.length < 8) return setFields({ password: "密碼至少 8 個字元" });
    setBusy(true);
    try {
      onLogin(setup ? await api.setup(username, password) : await api.login(username, password));
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.message);
        setFields(e.fields);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-lg border bg-white p-6 shadow-sm" noValidate>
        <h1 className="mb-1 text-xl font-bold text-blue-700">Map Trip Planner</h1>
        <p className="mb-4 text-sm text-slate-500">{setup ? "初始設定：建立管理者帳號" : "請登入"}</p>
        <FormError message={error} />
        <Field label="帳號" error={fields.username} htmlFor="u">
          <input id="u" className="input" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
        </Field>
        <Field label="密碼" error={fields.password} htmlFor="p">
          <input id="p" className="input" type="password" autoComplete={setup ? "new-password" : "current-password"} value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {setup && (
          <Field label="確認密碼" error={fields.confirm} htmlFor="c">
            <input id="c" className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>
        )}
        <button className="btn-primary w-full" type="submit" disabled={busy || !username || !password}>
          {busy ? "處理中…" : setup ? "建立並登入" : "登入"}
        </button>
      </form>
    </div>
  );
}
