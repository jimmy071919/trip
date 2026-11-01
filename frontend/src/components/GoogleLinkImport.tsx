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
  const startDraftFromPlace = useStore((s) => s.startDraftFromPlace);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const place = await api.resolveGoogleLink(url);
      const notice = [
        place.source === "google_places" ? "已從 Google 地圖帶入地點資訊，請確認後儲存。" : "已從連結帶入名稱與位置，請確認後儲存。",
        ...place.warnings,
      ].join(" ");
      startDraftFromPlace(placeToPrefill(place), notice);
      if (place.latitude != null && place.longitude != null) {
        mapHandle.current?.setView([place.latitude, place.longitude], Math.max(mapHandle.current.getZoom(), 16));
      }
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
          {busy ? "解析中…" : "定位"}
        </button>
      </div>
      {error && <p className="field-error">{error}</p>}
      {!placesEnabled && (
        <p className="mt-1 text-[11px] leading-snug text-slate-400">只會帶入名稱與座標；設定 GOOGLE_MAPS_API_KEY 後可一併帶入地址、電話、營業時間。</p>
      )}
    </form>
  );
}
