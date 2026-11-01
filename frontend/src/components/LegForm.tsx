import { useState } from "react";
import { api, ApiError } from "../lib/api";
import { useStore } from "../lib/store";
import { TRANSPORT_LABELS, TRANSPORT_MODES, type Leg, type TransportMode } from "../lib/types";
import { Field, FormError } from "./Field";

const CURRENCIES = ["TWD", "JPY", "USD", "EUR", "KRW", "CNY", "HKD", "THB", "SGD", "GBP"];

interface Form {
  transport_mode: string;
  route_name: string;
  duration_minutes: string;
  cost_amount: string;
  currency: string;
  description: string;
  reference_url: string;
}

const toForm = (l: Leg): Form => ({
  transport_mode: l.transport_mode ?? "",
  route_name: l.route_name ?? "",
  duration_minutes: l.duration_minutes != null ? String(l.duration_minutes) : "",
  cost_amount: l.cost_amount != null ? String(Number(l.cost_amount)) : "",
  currency: l.currency ?? "",
  description: l.description ?? "",
  reference_url: l.reference_url ?? "",
});

export function validateLegForm(f: Form): Record<string, string> {
  const e: Record<string, string> = {};
  if (f.duration_minutes.trim() && !/^\d+$/.test(f.duration_minutes.trim())) e.duration_minutes = "請輸入 0 以上的整數";
  if (f.cost_amount.trim() && !/^\d+(\.\d{1,2})?$/.test(f.cost_amount.trim())) e.cost_amount = "請輸入 0 以上的金額（最多兩位小數）";
  if (f.currency.trim() && !/^[A-Za-z]{3}$/.test(f.currency.trim())) e.currency = "請輸入 3 碼幣別代碼";
  if (f.reference_url.trim() && !/^https?:\/\/\S+$/i.test(f.reference_url.trim())) e.reference_url = "網址須以 http:// 或 https:// 開頭";
  return e;
}

export default function LegForm({ leg }: { leg: Leg }) {
  const stops = useStore((s) => s.stops);
  const { save, upsertLeg, select } = useStore.getState();
  const defaultCurrency = useStore((s) => (s.project?.timezone === "Asia/Tokyo" ? "JPY" : "TWD"));
  const from = stops.find((s) => s.id === leg.from_stop_id);
  const to = stops.find((s) => s.id === leg.to_stop_id);
  const [form, setForm] = useState<Form>(() => toForm(leg));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const v = validateLegForm(form);
    setErrors(v);
    setFormError(null);
    if (Object.keys(v).length) return;
    const cost = form.cost_amount.trim();
    const payload: Partial<Leg> = {
      transport_mode: (form.transport_mode || null) as TransportMode | null,
      route_name: form.route_name,
      duration_minutes: form.duration_minutes.trim() ? Number(form.duration_minutes) : null,
      cost_amount: cost || null,
      currency: cost ? form.currency.trim() || defaultCurrency : form.currency.trim() || null,
      description: form.description,
      reference_url: form.reference_url,
    };
    setBusy(true);
    try {
      const updated = await save(() => api.updateLeg(leg.id, payload));
      upsertLeg(updated);
      setForm(toForm(updated));
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fields);
        setFormError(err.status === 422 ? err.message : `儲存失敗：${err.message}`);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate>
      <h2 className="mb-1 text-base font-semibold">
        <button type="button" className="hover:underline" onClick={() => from && select({ kind: "stop", id: from.id })}>
          {from?.title ?? "?"}
        </button>
        <span className="mx-1 text-slate-400">→</span>
        <button type="button" className="hover:underline" onClick={() => to && select({ kind: "stop", id: to.id })}>
          {to?.title ?? "?"}
        </button>
      </h2>
      <p className="mb-3 text-xs text-slate-500">交通資訊為人工紀錄；地圖上的連線僅示意兩地的交通關係，並非實際路線。</p>
      <FormError message={formError} />
      <Field label="交通方式" error={errors.transport_mode} htmlFor="leg-mode">
        <select id="leg-mode" className="input" value={form.transport_mode} onChange={set("transport_mode")}>
          <option value="">未設定</option>
          {TRANSPORT_MODES.map((m) => (
            <option key={m} value={m}>
              {TRANSPORT_LABELS[m]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="路線／班次" error={errors.route_name} htmlFor="leg-route">
        <input id="leg-route" className="input" placeholder="例：JR 山手線、銀座線" value={form.route_name} onChange={set("route_name")} />
      </Field>
      <Field label="所需時間（分鐘）" error={errors.duration_minutes} htmlFor="leg-duration">
        <input id="leg-duration" className="input" inputMode="numeric" value={form.duration_minutes} onChange={set("duration_minutes")} />
      </Field>
      <div className="grid grid-cols-[1fr_7rem] gap-2">
        <Field label="費用" error={errors.cost_amount} htmlFor="leg-cost">
          <input id="leg-cost" className="input" inputMode="decimal" value={form.cost_amount} onChange={set("cost_amount")} />
        </Field>
        <Field label="幣別" error={errors.currency} htmlFor="leg-currency">
          <input
            id="leg-currency"
            className="input uppercase"
            list="currency-list"
            placeholder={defaultCurrency}
            maxLength={3}
            value={form.currency}
            onChange={set("currency")}
          />
          <datalist id="currency-list">
            {CURRENCIES.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
      </div>
      <Field label="內容備註" error={errors.description} htmlFor="leg-desc">
        <textarea id="leg-desc" className="input min-h-[96px]" placeholder="轉乘、出口、末班車…" value={form.description} onChange={set("description")} />
      </Field>
      <Field label="參考網址" error={errors.reference_url} htmlFor="leg-url">
        <input id="leg-url" className="input" type="url" placeholder="https://" value={form.reference_url} onChange={set("reference_url")} />
        {leg.reference_url && (
          <a className="mt-1 inline-block text-xs text-blue-600 hover:underline" href={leg.reference_url} target="_blank" rel="noopener noreferrer">
            開啟連結 ↗
          </a>
        )}
      </Field>
      <button type="submit" className="btn-primary" disabled={busy}>
        {busy ? "儲存中…" : "儲存變更"}
      </button>
    </form>
  );
}
