import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useShallow } from "zustand/react/shallow";
import { api } from "../lib/api";
import { dayColor, dayLabel, hhmm, legSummary } from "../lib/format";
import { groupStops, legFor, useStore } from "../lib/store";
import type { Stop } from "../lib/types";
import GoogleLinkImport from "./GoogleLinkImport";

function SortableStop({ stop, index, color, numbered }: { stop: Stop; index: number; color: string; numbered: boolean }) {
  const selected = useStore((s) => s.selection.kind === "stop" && s.selection.id === stop.id);
  const select = useStore((s) => s.select);
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: stop.id });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`group flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm ${
        selected ? "border-amber-400 bg-amber-50" : "border-transparent bg-white hover:border-slate-200"
      } ${isDragging ? "z-10 shadow-lg" : ""}`}
      data-testid="stop-item"
    >
      <button
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        className="cursor-grab touch-none px-0.5 text-slate-400 hover:text-slate-600 active:cursor-grabbing"
        aria-label={`拖曳排序 ${stop.title}`}
        title="拖曳排序"
      >
        ⋮⋮
      </button>
      <span
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
        style={{ background: color }}
      >
        {numbered ? index + 1 : "•"}
      </span>
      <button className="min-w-0 flex-1 text-left" onClick={() => select({ kind: "stop", id: stop.id })}>
        <div className="truncate font-medium">{stop.title}</div>
        {(stop.arrival_time || stop.stay_minutes != null) && (
          <div className="truncate text-xs text-slate-500">
            {hhmm(stop.arrival_time)}
            {stop.arrival_time && stop.stay_minutes != null ? "・" : ""}
            {stop.stay_minutes != null ? `停留 ${stop.stay_minutes} 分` : ""}
          </div>
        )}
      </button>
    </li>
  );
}

function LegButton({ from, to }: { from: Stop; to: Stop }) {
  const leg = useStore((s) => legFor(s.legs, from.id, to.id));
  const selected = useStore((s) => !!leg && s.selection.kind === "leg" && s.selection.id === leg.id);
  const select = useStore((s) => s.select);
  const unset = !leg?.transport_mode;
  return (
    <li className="pl-9">
      <button
        disabled={!leg}
        onClick={() => leg && select({ kind: "leg", id: leg.id })}
        className={`w-full truncate rounded px-2 py-0.5 text-left text-xs ${
          selected ? "bg-amber-100 text-amber-800" : unset ? "text-slate-400 hover:bg-slate-100" : "text-slate-600 hover:bg-slate-100"
        }`}
        title={`${from.title} → ${to.title}`}
      >
        ↓ {leg ? legSummary(leg) : "更新中…"}
      </button>
    </li>
  );
}

function Group({ groupKey, label, color }: { groupKey: string; label: string; color: string }) {
  const stops = useStore(useShallow((s) => groupStops(s.stops, groupKey)));
  const hidden = useStore((s) => !!s.hiddenGroups[groupKey]);
  const { toggleGroup, select, save, reorderLocal, project } = useStore.getState();
  const isDay = groupKey !== "unscheduled";

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const ids = stops.map((s) => s.id);
    const next = arrayMove(ids, ids.indexOf(String(e.active.id)), ids.indexOf(String(e.over.id)));
    reorderLocal(groupKey, next);
    const pid = project?.id ?? useStore.getState().project!.id;
    save(() => (isDay ? api.setStopOrder(groupKey, next) : api.setUnscheduledOrder(pid, next)), { refresh: true }).catch(
      () => undefined,
    );
  };

  return (
    <section className="mb-3">
      <header className="mb-1 flex items-center gap-2 px-1">
        <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: color }} />
        <button
          className="min-w-0 flex-1 truncate text-left text-sm font-semibold hover:underline"
          onClick={() => isDay && select({ kind: "day", id: groupKey })}
          title={isDay ? "編輯日期" : undefined}
        >
          {label}
        </button>
        <span className="text-xs text-slate-400">{stops.length}</span>
        <button
          className="rounded px-1 text-xs text-slate-500 hover:bg-slate-200"
          onClick={() => toggleGroup(groupKey)}
          title={hidden ? "在地圖顯示" : "在地圖隱藏"}
          aria-pressed={!hidden}
        >
          {hidden ? "顯示" : "隱藏"}
        </button>
      </header>
      {stops.length === 0 ? (
        <p className="px-2 py-1 text-xs text-slate-400">{isDay ? "尚無地點；新增時選擇此日期即可加入" : "沒有未排程地點"}</p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={stops.map((s) => s.id)} strategy={verticalListSortingStrategy}>
            <ul className={`space-y-0.5 ${hidden ? "opacity-50" : ""}`}>
              {stops.map((s, i) => (
                <FragmentRow key={s.id} stop={s} next={stops[i + 1]} index={i} color={color} isDay={isDay} />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}
    </section>
  );
}

function FragmentRow({ stop, next, index, color, isDay }: { stop: Stop; next?: Stop; index: number; color: string; isDay: boolean }) {
  return (
    <>
      <SortableStop stop={stop} index={index} color={color} numbered={isDay} />
      {isDay && next && <LegButton from={stop} to={next} />}
    </>
  );
}

export default function StopList({ placesEnabled = false, onPlaceResolved }: { placesEnabled?: boolean; onPlaceResolved?: () => void }) {
  const days = useStore((s) => s.days);
  const dayFilter = useStore((s) => s.dayFilter);
  const project = useStore((s) => s.project);
  const { save, upsertDay, select, setAddMode } = useStore.getState();

  const addDay = () => {
    if (!project) return;
    const last = days.filter((d) => d.date).at(-1)?.date;
    let date: string | null = null;
    if (last) {
      const d = new Date(last + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() + 1);
      date = d.toISOString().slice(0, 10);
    }
    save(() => api.createDay(project.id, { date })).then((d) => {
      upsertDay(d);
      select({ kind: "day", id: d.id });
    }, () => undefined);
  };

  const shown = days.map((d, i) => ({ d, i })).filter(({ d }) => dayFilter === "all" || dayFilter === d.id);
  return (
    <div className="flex h-full flex-col">
      <div className="flex gap-2 border-b border-slate-200 p-2">
        <button className="btn-secondary flex-1" onClick={addDay}>
          ＋ 新增日期
        </button>
        <button className="btn-primary flex-1" onClick={() => setAddMode(true)}>
          ＋ 新增地點
        </button>
      </div>
      <GoogleLinkImport placesEnabled={placesEnabled} onDone={onPlaceResolved} />
      <div className="flex-1 overflow-y-auto p-2">
        {shown.map(({ d, i }) => (
          <Group key={d.id} groupKey={d.id} label={dayLabel(d, i)} color={dayColor(days, d.id)} />
        ))}
        {(dayFilter === "all" || dayFilter === "unscheduled") && <Group groupKey="unscheduled" label="未排程地點" color="#64748b" />}
      </div>
    </div>
  );
}
