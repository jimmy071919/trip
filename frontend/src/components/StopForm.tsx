import { useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";
import { dayLabel, hhmm } from "../lib/format";
import { useStore } from "../lib/store";
import type { Stop } from "../lib/types";
import { Field, FormError } from "./Field";

interface Form {
  title: string;
  day_id: string; // "" = unscheduled
  latitude: string;
  longitude: string;
  address: string;
  arrival_time: string;
  stay_minutes: string;
  description: string;
  reference_url: string;
}

function toForm(s: Partial<Stop>): Form {
  return {
    title: s.title ?? "",
    day_id: s.day_id ?? "",
    latitude: s.latitude != null ? String(+s.latitude.toFixed(6)) : "",
    longitude: s.longitude != null ? String(+s.longitude.toFixed(6)) : "",
    address: s.address ?? "",
    arrival_time: hhmm(s.arrival_time ?? null),
    stay_minutes: s.stay_minutes != null ? String(s.stay_minutes) : "",
    description: s.description ?? "",
    reference_url: s.reference_url ?? "",
  };
}

export function validateStopForm(f: Form): Record<string, string> {
  const e: Record<string, string> = {};
  if (!f.title.trim()) e.title = "請輸入地點名稱";
  const lat = Number(f.latitude);
  const lon = Number(f.longitude);
  if (f.latitude.trim() === "" || !Number.isFinite(lat) || lat < -90 || lat > 90) e.latitude = "緯度須介於 -90 ～ 90";
  if (f.longitude.trim() === "" || !Number.isFinite(lon) || lon < -180 || lon > 180) e.longitude = "經度須介於 -180 ～ 180";
  if (f.stay_minutes.trim() !== "" && (!/^\d+$/.test(f.stay_minutes.trim()))) e.stay_minutes = "請輸入 0 以上的整數";
  if (f.reference_url.trim() && !/^https?:\/\/\S+$/i.test(f.reference_url.trim())) e.reference_url = "網址須以 http:// 或 https:// 開頭";
  return e;
}

function toPayload(f: Form): Partial<Stop> {
  return {
    title: f.title.trim(),
    day_id: f.day_id || null,
    latitude: Number(f.latitude),
    longitude: Number(f.longitude),
    address: f.address,
    arrival_time: f.arrival_time || null,
    stay_minutes: f.stay_minutes.trim() === "" ? null : Number(f.stay_minutes),
    description: f.description,
    reference_url: f.reference_url,
  };
}

export default function StopForm({ stop, draft }: { stop?: Stop; draft?: { lat: number; lng: number } }) {
  const days = useStore((s) => s.days);
  const dayFilter = useStore((s) => s.dayFilter);
  const project = useStore((s) => s.project)!;
  const { save, select, upsertStop, setAddMode } = useStore.getState();

  const prefill = useStore((s) => s.draftPrefill);
  const notice = useStore((s) => s.draftNotice);
  const initialDay = dayFilter !== "all" && dayFilter !== "unscheduled" ? dayFilter : "";
  const [form, setForm] = useState<Form>(() =>
    stop
      ? toForm(stop)
      : toForm({ ...(draft ? prefill : null), latitude: draft!.lat, longitude: draft!.lng, day_id: initialDay || null }),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // follow marker drags
  const lat = stop?.latitude ?? draft?.lat;
  const lng = stop?.longitude ?? draft?.lng;
  useEffect(() => {
    if (lat == null || lng == null) return;
    setForm((f) => ({ ...f, latitude: String(+lat.toFixed(6)), longitude: String(+lng.toFixed(6)) }));
  }, [lat, lng]);
  useEffect(() => {
    if (stop) setForm((f) => ({ ...f, day_id: stop.day_id ?? "" }));
  }, [stop?.day_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const v = e.target.value;
    setForm((f) => ({ ...f, [k]: v }));
    // typing coordinates moves the draft marker
    if (draft && (k === "latitude" || k === "longitude")) {
      const next = { ...form, [k]: v };
      const la = Number(next.latitude);
      const lo = Number(next.longitude);
      if (Number.isFinite(la) && Number.isFinite(lo) && Math.abs(la) <= 90 && Math.abs(lo) <= 180)
        select({ kind: "draft", lat: la, lng: lo });
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const v = validateStopForm(form);
    setErrors(v);
    setFormError(null);
    if (Object.keys(v).length) return;
    setBusy(true);
    const payload = toPayload(form);
    try {
      if (stop) {
        const dayChanged = (stop.day_id ?? "") !== form.day_id;
        const updated = await save(() => api.updateStop(stop.id, payload), { refresh: dayChanged });
        upsertStop(updated);
      } else {
        const created = await save(() => api.createStop(project.id, payload), { refresh: true });
        select({ kind: "stop", id: created.id });
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fields);
        setFormError(err.status === 422 ? err.message : `儲存失敗：${err.message}`);
      }
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!stop) return;
    if (!window.confirm(`確定要刪除「${stop.title}」？\n與此地點相連的路段與交通紀錄也會一併刪除。`)) return;
    try {
      await save(() => api.deleteStop(stop.id), { refresh: true });
      select({ kind: "none" });
    } catch (err) {
      if (err instanceof ApiError) setFormError(`刪除失敗：${err.message}`);
    }
  };

  const cancel = () => {
    select({ kind: "none" });
    setAddMode(false);
  };

  return (
    <form onSubmit={submit} noValidate>
      <h2 className="mb-3 text-base font-semibold">{stop ? "地點詳情" : "新增地點"}</h2>
      <FormError message={formError} />
      {!stop && notice && (
        <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{notice}</div>
      )}
      <Field label="名稱 *" error={errors.title} htmlFor="stop-title">
        <input id="stop-title" className="input" value={form.title} onChange={set("title")} autoFocus={!stop} maxLength={200} />
      </Field>
      <Field label="日期" error={errors.day_id} htmlFor="stop-day">
        <select id="stop-day" className="input" value={form.day_id} onChange={set("day_id")}>
          <option value="">未排程</option>
          {days.map((d, i) => (
            <option key={d.id} value={d.id}>
              {dayLabel(d, i)}
            </option>
          ))}
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="緯度 *" error={errors.latitude} htmlFor="stop-lat">
          <input id="stop-lat" className="input" inputMode="decimal" value={form.latitude} onChange={set("latitude")} />
        </Field>
        <Field label="經度 *" error={errors.longitude} htmlFor="stop-lon">
          <input id="stop-lon" className="input" inputMode="decimal" value={form.longitude} onChange={set("longitude")} />
        </Field>
      </div>
      <Field label="地址" error={errors.address} htmlFor="stop-address">
        <input id="stop-address" className="input" value={form.address} onChange={set("address")} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="預計抵達時間" error={errors.arrival_time} htmlFor="stop-arrival">
          <input id="stop-arrival" type="time" className="input" value={form.arrival_time} onChange={set("arrival_time")} />
        </Field>
        <Field label="停留（分鐘）" error={errors.stay_minutes} htmlFor="stop-stay">
          <input id="stop-stay" className="input" inputMode="numeric" value={form.stay_minutes} onChange={set("stay_minutes")} />
        </Field>
      </div>
      <Field label="內容／備註" error={errors.description} htmlFor="stop-desc">
        <textarea id="stop-desc" className="input min-h-[96px]" value={form.description} onChange={set("description")} />
      </Field>
      <Field label="參考網址" error={errors.reference_url} htmlFor="stop-url">
        <input id="stop-url" className="input" type="url" placeholder="https://" value={form.reference_url} onChange={set("reference_url")} />
        {stop?.reference_url && (
          <a className="mt-1 inline-block text-xs text-blue-600 hover:underline" href={stop.reference_url} target="_blank" rel="noopener noreferrer">
            開啟連結 ↗
          </a>
        )}
      </Field>
      <div className="flex gap-2">
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? "儲存中…" : "儲存"}
        </button>
        {stop ? (
          <button type="button" className="btn-danger ml-auto" onClick={remove}>
            刪除
          </button>
        ) : (
          <button type="button" className="btn-secondary" onClick={cancel}>
            取消
          </button>
        )}
      </div>
    </form>
  );
}
