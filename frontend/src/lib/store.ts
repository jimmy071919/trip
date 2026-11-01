import { create } from "zustand";
import { api, ApiError } from "./api";
import { sortStops } from "./format";
import type { Bundle, Day, Leg, Project, Stop } from "./types";

export type SaveState = "idle" | "saving" | "saved" | "error";
export interface Failure {
  id: number;
  message: string;
  retry: () => Promise<unknown>;
}
let failureSeq = 0;
export type Selection =
  | { kind: "none" }
  | { kind: "stop"; id: string }
  | { kind: "leg"; id: string }
  | { kind: "draft"; lat: number; lng: number }
  | { kind: "day"; id: string }
  | { kind: "project" };

/** "all" or a day id or "unscheduled" */
export type DayFilter = string;

interface State {
  project: Project | null;
  days: Day[];
  stops: Stop[];
  legs: Leg[];
  loading: boolean;
  loadError: string | null;

  selection: Selection;
  addMode: boolean;
  dayFilter: DayFilter;
  hiddenGroups: Record<string, boolean>; // key: day id | "unscheduled"
  /** pre-filled fields for the next draft stop (e.g. from a Google Maps link) */
  draftPrefill: Partial<Stop> | null;
  draftNotice: string | null;
  startDraftFromPlace: (p: Partial<Stop>, notice: string | null) => void;
  /** live marker positions while dragging, so lines follow the cursor */
  dragPos: Record<string, [number, number]>;

  inflight: number;
  savedOnce: boolean;
  /** failed writes not yet recovered; each can be retried */
  failures: Failure[];
  /** last validation error (fix the form, nothing to retry) */
  validationError: string | null;
  retryAll: () => void;
  dismissFailures: () => void;

  loadProject: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
  clearProject: () => void;
  applyBundle: (b: Bundle) => void;

  select: (s: Selection) => void;
  setAddMode: (on: boolean) => void;
  setDayFilter: (f: DayFilter) => void;
  toggleGroup: (key: string) => void;
  setDragPos: (id: string, pos: [number, number] | null) => void;

  /**
   * Run a write operation with save-status tracking. On failure the status
   * shows "儲存失敗" with a retry that re-runs the same operation.
   * Resolves to the operation result, or rejects with the ApiError so callers
   * (forms) can show field errors.
   */
  save: <T>(op: () => Promise<T>, opts?: { refresh?: boolean }) => Promise<T>;

  upsertStop: (s: Stop) => void;
  upsertLeg: (l: Leg) => void;
  upsertDay: (d: Day) => void;
  setProject: (p: Project) => void;
  /** optimistic local reorder */
  reorderLocal: (groupKey: string, ids: string[]) => void;
}

export const useStore = create<State>((set, get) => ({
  project: null,
  days: [],
  stops: [],
  legs: [],
  loading: false,
  loadError: null,
  selection: { kind: "none" },
  addMode: false,
  dayFilter: "all",
  hiddenGroups: {},
  draftPrefill: null,
  draftNotice: null,
  dragPos: {},
  inflight: 0,
  savedOnce: false,
  failures: [],
  validationError: null,

  async loadProject(id) {
    set({ loading: true, loadError: null, selection: { kind: "none" }, addMode: false, dayFilter: "all", hiddenGroups: {} });
    try {
      const b = await api.bundle(id);
      get().applyBundle(b);
      try {
        localStorage.setItem("mtp:lastProject", id);
      } catch {
        /* ignore */
      }
    } catch (e) {
      set({ loadError: e instanceof ApiError ? e.message : String(e) });
    } finally {
      set({ loading: false });
    }
  },

  async refresh() {
    const p = get().project;
    if (!p) return;
    const b = await api.bundle(p.id);
    get().applyBundle(b);
  },

  clearProject() {
    set({ project: null, days: [], stops: [], legs: [], selection: { kind: "none" }, addMode: false });
  },

  applyBundle(b) {
    set((s) => {
      const sel = s.selection;
      let selection = sel;
      if (sel.kind === "stop" && !b.stops.some((x) => x.id === sel.id)) selection = { kind: "none" };
      if (sel.kind === "leg" && !b.legs.some((x) => x.id === sel.id)) selection = { kind: "none" };
      let dayFilter = s.dayFilter;
      if (dayFilter !== "all" && dayFilter !== "unscheduled" && !b.days.some((d) => d.id === dayFilter)) dayFilter = "all";
      return { project: b.project, days: b.days, stops: b.stops, legs: b.legs, selection, dayFilter };
    });
  },

  select(selection) {
    set({
      selection,
      addMode: selection.kind === "draft" ? false : get().addMode,
      ...(selection.kind === "draft" ? {} : { draftPrefill: null, draftNotice: null }),
    });
  },
  setAddMode(on) {
    const sel = get().selection;
    set({
      addMode: on,
      selection: on && sel.kind === "draft" ? { kind: "none" } : sel,
      draftPrefill: null,
      draftNotice: null,
    });
  },
  startDraftFromPlace(prefill, notice) {
    const { latitude, longitude } = prefill;
    if (latitude != null && longitude != null) {
      set({ draftPrefill: prefill, draftNotice: notice, addMode: false, selection: { kind: "draft", lat: latitude, lng: longitude } });
    } else {
      // no coordinates: user clicks the map, the form is pre-filled
      set({ draftPrefill: prefill, draftNotice: notice, addMode: true, selection: { kind: "none" } });
    }
  },
  setDayFilter(dayFilter) {
    set({ dayFilter });
  },
  toggleGroup(key) {
    set((s) => ({ hiddenGroups: { ...s.hiddenGroups, [key]: !s.hiddenGroups[key] } }));
  },
  setDragPos(id, pos) {
    set((s) => {
      const next = { ...s.dragPos };
      if (pos) next[id] = pos;
      else delete next[id];
      return { dragPos: next };
    });
  },

  async save(op, opts = {}) {
    let failureId: number | null = null;
    const attempt = async (): Promise<any> => {
      set((s) => ({ inflight: s.inflight + 1 }));
      try {
        const result = await op();
        if (opts.refresh) await get().refresh().catch(() => undefined);
        set((s) => ({
          inflight: s.inflight - 1,
          savedOnce: true,
          validationError: null,
          failures: failureId == null ? s.failures : s.failures.filter((f) => f.id !== failureId),
        }));
        return result;
      } catch (e) {
        const msg = e instanceof ApiError ? e.message : "未知錯誤";
        if (e instanceof ApiError && e.status === 422) {
          // must be fixed in the form; resending the same payload is pointless
          set((s) => ({ inflight: s.inflight - 1, validationError: msg }));
        } else {
          if (failureId == null) failureId = ++failureSeq;
          const id = failureId;
          set((s) => ({
            inflight: s.inflight - 1,
            failures: [...s.failures.filter((f) => f.id !== id), { id, message: msg, retry: attempt }],
          }));
        }
        throw e;
      }
    };
    return attempt();
  },

  retryAll() {
    for (const f of get().failures) f.retry().catch(() => undefined);
  },
  dismissFailures() {
    set({ failures: [], validationError: null });
  },

  upsertStop(stop) {
    set((s) => ({ stops: s.stops.some((x) => x.id === stop.id) ? s.stops.map((x) => (x.id === stop.id ? stop : x)) : [...s.stops, stop] }));
  },
  upsertLeg(leg) {
    set((s) => ({ legs: s.legs.some((x) => x.id === leg.id) ? s.legs.map((x) => (x.id === leg.id ? leg : x)) : [...s.legs, leg] }));
  },
  upsertDay(day) {
    set((s) => ({ days: s.days.some((x) => x.id === day.id) ? s.days.map((x) => (x.id === day.id ? day : x)) : [...s.days, day] }));
  },
  setProject(project) {
    set({ project });
  },
  reorderLocal(groupKey, ids) {
    const pos = new Map(ids.map((id, i) => [id, i]));
    set((s) => ({
      stops: s.stops.map((x) =>
        (x.day_id ?? "unscheduled") === groupKey && pos.has(x.id) ? { ...x, sort_order: pos.get(x.id)! } : x,
      ),
      // drop legs of this day locally; refresh will bring the correct ones
      legs: groupKey === "unscheduled" ? s.legs : s.legs.filter((l) => l.day_id !== groupKey),
    }));
  },
}));

/* ---------- selectors ---------- */
export function saveStateOf(s: Pick<State, "inflight" | "failures" | "validationError" | "savedOnce">): SaveState {
  if (s.failures.length || s.validationError) return "error";
  if (s.inflight > 0) return "saving";
  return s.savedOnce ? "saved" : "idle";
}

export function groupStops(stops: Stop[], key: string): Stop[] {
  return sortStops(stops.filter((s) => (s.day_id ?? "unscheduled") === key));
}

export function isGroupVisible(state: Pick<State, "dayFilter" | "hiddenGroups">, key: string): boolean {
  if (state.hiddenGroups[key]) return false;
  return state.dayFilter === "all" || state.dayFilter === key;
}

export function legFor(legs: Leg[], from: string, to: string): Leg | undefined {
  return legs.find((l) => l.from_stop_id === from && l.to_stop_id === to);
}
