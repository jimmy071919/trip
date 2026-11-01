import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { dayLabel } from "../lib/format";
import { useStore } from "../lib/store";
import type { PublicConfig, User } from "../lib/types";
import DetailPanel from "./DetailPanel";
import MapView from "./MapView";
import ProjectsDialog from "./ProjectsDialog";
import StatusBar from "./StatusBar";
import StopList from "./StopList";

function lastProjectId(): string | null {
  try {
    return localStorage.getItem("mtp:lastProject");
  } catch {
    return null;
  }
}

export default function Workspace({ config, user, onLogout }: { config: PublicConfig; user: User; onLogout: () => void }) {
  const project = useStore((s) => s.project);
  const days = useStore((s) => s.days);
  const loading = useStore((s) => s.loading);
  const loadError = useStore((s) => s.loadError);
  const addMode = useStore((s) => s.addMode);
  const dayFilter = useStore((s) => s.dayFilter);
  const selection = useStore((s) => s.selection);
  const hasFailures = useStore((s) => s.failures.length > 0);
  const { loadProject, setAddMode, setDayFilter, select } = useStore.getState();

  const [showProjects, setShowProjects] = useState(false);
  const [listOpen, setListOpen] = useState(false); // mobile drawer
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const last = lastProjectId();
    if (last) loadProject(last);
    else setShowProjects(true);
  }, [loadProject]);

  useEffect(() => {
    if (loadError) setShowProjects(true);
  }, [loadError]);

  // don't lose unsaved (failed) changes silently
  useEffect(() => {
    if (!hasFailures) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [hasFailures]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const st = useStore.getState();
      if (st.addMode) setAddMode(false);
      else if (st.selection.kind === "draft") select({ kind: "none" });
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [setAddMode, select]);

  // close list drawer when entering add mode on mobile so the map is reachable
  useEffect(() => {
    if (addMode) setListOpen(false);
  }, [addMode]);

  const openProject = (id: string) => {
    setShowProjects(false);
    loadProject(id);
  };

  const exportJson = async () => {
    if (!project) return;
    try {
      const text = await api.exportProject(project.id);
      const blob = new Blob([text], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      const stamp = new Date().toISOString().slice(0, 10);
      a.download = `${project.title.replace(/[\\/:*?"<>|]/g, "_")}-${stamp}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch (e) {
      window.alert(`匯出失敗：${e instanceof Error ? e.message : e}`);
    }
  };

  const logout = async () => {
    await api.logout().catch(() => undefined);
    onLogout();
  };

  const detailOpen = selection.kind !== "none";

  return (
    <div className="flex h-full flex-col">
      <header className="z-[1100] flex items-center gap-2 border-b border-slate-200 bg-white px-3 py-2">
        <button className="btn-ghost px-2 md:hidden" onClick={() => setListOpen((v) => !v)} aria-label="行程清單">
          ☰
        </button>
        <span className="hidden font-bold text-blue-700 lg:inline">Map Trip Planner</span>
        <button className="btn-secondary max-w-[40vw] truncate" onClick={() => setShowProjects(true)} title="切換專案">
          <span className="truncate">{project ? project.title : "選擇專案"}</span> ▾
        </button>
        {project && (
          <>
            <select
              className="input w-auto max-w-[32vw] py-1"
              value={dayFilter}
              onChange={(e) => setDayFilter(e.target.value)}
              aria-label="日期篩選"
            >
              <option value="all">全部日期</option>
              {days.map((d, i) => (
                <option key={d.id} value={d.id}>
                  {dayLabel(d, i)}
                </option>
              ))}
              <option value="unscheduled">未排程</option>
            </select>
            <button className="btn-ghost hidden sm:inline-flex" onClick={() => select({ kind: "project" })}>
              ⚙ 設定
            </button>
          </>
        )}
        <div className="relative ml-auto flex items-center gap-2">
          {project && (
            <button className="btn-secondary hidden sm:inline-flex" onClick={exportJson}>
              匯出
            </button>
          )}
          <button className="btn-ghost" onClick={() => setMenuOpen((v) => !v)} aria-haspopup="menu">
            👤 <span className="hidden sm:inline">{user.username}</span>
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full mt-1 w-40 rounded-md border bg-white py-1 shadow-lg" role="menu" onMouseLeave={() => setMenuOpen(false)}>
              {project && (
                <>
                  <button className="block w-full px-3 py-1.5 text-left text-sm hover:bg-slate-100 sm:hidden" onClick={() => { setMenuOpen(false); select({ kind: "project" }); }}>
                    專案設定
                  </button>
                  <button className="block w-full px-3 py-1.5 text-left text-sm hover:bg-slate-100 sm:hidden" onClick={() => { setMenuOpen(false); exportJson(); }}>
                    匯出 JSON
                  </button>
                </>
              )}
              <button className="block w-full px-3 py-1.5 text-left text-sm hover:bg-slate-100" onClick={logout}>
                登出
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        {project && (
          <aside
            className={`${listOpen ? "fixed inset-y-0 left-0 z-[1050] w-[85vw] max-w-xs pt-14 shadow-xl" : "hidden"} border-r border-slate-200 bg-slate-50 md:static md:z-auto md:block md:w-72 md:pt-0 md:shadow-none`}
          >
            <StopList placesEnabled={config.google_places_enabled} onPlaceResolved={() => setListOpen(false)} />
          </aside>
        )}
        {listOpen && <div className="fixed inset-0 z-[1040] bg-black/30 md:hidden" onClick={() => setListOpen(false)} />}

        <main className="relative min-w-0 flex-1">
          <MapView config={config} />
          {addMode && (
            <div className="absolute left-1/2 top-3 z-[1000] flex -translate-x-1/2 items-center gap-3 rounded-full bg-amber-500 px-4 py-2 text-sm font-medium text-white shadow-lg">
              點擊地圖以放置新地點
              <button className="rounded-full bg-white/25 px-2 py-0.5 hover:bg-white/40" onClick={() => setAddMode(false)}>
                取消
              </button>
            </div>
          )}
          {project && !addMode && selection.kind !== "draft" && (
            <button
              className="btn-primary absolute bottom-6 right-4 z-[1000] rounded-full px-4 py-3 shadow-lg md:hidden"
              onClick={() => setAddMode(true)}
            >
              ＋ 地點
            </button>
          )}
          {loading && <div className="absolute inset-0 z-[1000] flex items-center justify-center bg-white/60 text-sm">載入中…</div>}
        </main>

        {project && (
          <aside
            className={`${detailOpen ? "fixed inset-x-0 bottom-0 z-[1050] max-h-[60vh] rounded-t-xl shadow-[0_-4px_16px_rgba(0,0,0,0.15)]" : "hidden"} overflow-y-auto border-l border-slate-200 bg-white p-4 md:static md:z-auto md:block md:max-h-none md:w-80 md:rounded-none md:shadow-none`}
          >
            {detailOpen && (
              <button className="btn-ghost float-right -mr-2 -mt-2 px-2" onClick={() => select({ kind: "none" })} aria-label="關閉詳情">
                ✕
              </button>
            )}
            <DetailPanel />
          </aside>
        )}
      </div>

      <StatusBar />

      {(showProjects || !project) && !loading && (
        <ProjectsDialog closable={!!project} onClose={() => setShowProjects(false)} onOpen={openProject} />
      )}
    </div>
  );
}
