import { useState } from "react";
import { api, ApiError } from "../lib/api";
import { useStore } from "../lib/store";
import type { ResolvedPlace, Stop } from "../lib/types";
import { mapHandle } from "./MapView";

export function placeToPrefill(p: ResolvedPlace): Partial<Stop> {
  const lines: string[] = [];
  if (p.phone) lines.push(`電話：${p.phone}`);
  if (p.website) lines.push(`網站：${p.website}`);
  if (p.rating != null) lines.push(`Google 評分：${p.rating}`);
  if (p.opening_hours.length) lines.push("營業時間：", ...p.opening_hours.map((h) => `  ${h}`));
  return {
    title: p.name ?? "",
    latitude: p.latitude ?? undefined,
    longitude: p.longitude ?? undefined,
    address: p.address,
    description: lines.length ? lines.join("\n") : null,
    reference_url: p.google_maps_url,
  };
}

export default function GoogleLinkImport({ placesEnabled, onDone }: { placesEnabled: boolean; onDone?: () => void }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { startDraftFromPlace, save, select, upsertStop } = useStore.getState();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const project = useStore.getState().project;
    if (!url.trim() || !project) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const place = await api.resolveGoogleLink(url);
      const prefill = placeToPrefill(place);
      if (place.latitude == null || place.longitude == null) {
        // nothing could locate it: let the user click the map, form stays pre-filled
        startDraftFromPlace(prefill, place.warnings.join(" "));
        onDone?.();
        setUrl("");
        return;
      }
      const filter = useStore.getState().dayFilter;
      const dayId = filter !== "all" && filter !== "unscheduled" ? filter : null;
      const created = await save(
        () =>
          api.createStop(project.id, {
            ...prefill,
            title: (prefill.title || place.address || "Google 地圖地點").slice(0, 200),
            day_id: dayId,
          }),
        { refresh: true },
      );
      upsertStop(created);
      select({ kind: "stop", id: created.id });
      mapHandle.current?.setView([created.latitude, created.longitude], Math.max(mapHandle.current.getZoom(), 16));
      setNotice([`已新增「${created.title}」`, ...place.warnings].join("。"));
      setUrl("");
      onDone?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="border-b border-slate-200 p-2">
      <label className="label" htmlFor="gmaps-url">
        從 Google 地圖連結新增
      </label>
      <div className="flex gap-1.5">
        <input
          id="gmaps-url"
          className="input"
          placeholder="貼上 maps.app.goo.gl/… 或 google.com/maps/…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onPaste={(e) => {
            // auto-submit on paste for a one-step flow
            const text = e.clipboardData.getData("text");
            if (/google\.|goo\.gl/.test(text)) setTimeout(() => (e.target as HTMLInputElement).form?.requestSubmit(), 0);
          }}
        />
        <button className="btn-secondary shrink-0" type="submit" disabled={busy || !url.trim()}>
          {busy ? "新增中…" : "新增"}
        </button>
      </div>
      {error && <p className="field-error">{error}</p>}
      {notice && <p className="mt-1 text-xs text-green-700" data-testid="gmaps-notice">{notice}</p>}
      {!placesEnabled && !notice && (
        <p className="mt-1 text-[11px] leading-snug text-slate-400">會帶入名稱與座標；設定 GOOGLE_MAPS_API_KEY 後可一併帶入地址、電話、營業時間。</p>
      )}
    </form>
  );
}
