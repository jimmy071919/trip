import { useStore } from "../lib/store";
import DayForm from "./DayForm";
import LegForm from "./LegForm";
import ProjectPanel from "./ProjectPanel";
import StopForm from "./StopForm";

export default function DetailPanel() {
  const sel = useStore((s) => s.selection);
  const stop = useStore((s) => (sel.kind === "stop" ? s.stops.find((x) => x.id === sel.id) : undefined));
  const leg = useStore((s) => (sel.kind === "leg" ? s.legs.find((x) => x.id === sel.id) : undefined));
  const day = useStore((s) => (sel.kind === "day" ? s.days.find((x) => x.id === sel.id) : undefined));

  if (sel.kind === "draft") return <StopForm key="draft" draft={{ lat: sel.lat, lng: sel.lng }} />;
  if (stop) return <StopForm key={stop.id} stop={stop} />;
  if (leg) return <LegForm key={leg.id + leg.updated_at} leg={leg} />;
  if (day) return <DayForm key={day.id} day={day} />;
  if (sel.kind === "project") return <ProjectPanel />;
  return (
    <div className="text-sm text-slate-500">
      <h2 className="mb-2 text-base font-semibold text-slate-700">使用方式</h2>
      <ul className="list-disc space-y-1 pl-5">
        <li>按「新增地點」，再點擊地圖放置標記。</li>
        <li>拖曳地圖上的標記可修正位置。</li>
        <li>左側清單用 ⋮⋮ 拖曳可調整同一天的順序。</li>
        <li>點擊地圖連線或清單中的「↓ 交通」可記錄交通方式。</li>
      </ul>
    </div>
  );
}
