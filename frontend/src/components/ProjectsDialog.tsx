import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../lib/api";
import { useStore } from "../lib/store";
import type { Project } from "../lib/types";

export default function ProjectsDialog({ onClose, onOpen, closable }: { onClose: () => void; onOpen: (id: string) => void; closable: boolean }) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const current = useStore((s) => s.project?.id);
  const { save, clearProject } = useStore.getState();

  const load = () =>
    api.listProjects().then(setProjects, (e) => setError(e instanceof ApiError ? e.message : String(e)));
  useEffect(() => {
    load();
  }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    try {
      const p = await save(() => api.createProject({ title: title.trim() }));
      onOpen(p.id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  };

  const remove = async (p: Project) => {
    if (!window.confirm(`確定要刪除專案「${p.title}」？\n所有日期、地點與交通紀錄都會永久刪除，無法復原。`)) return;
    if (window.prompt(`請輸入專案名稱「${p.title}」以確認刪除`) !== p.title) return;
    try {
      await save(() => api.deleteProject(p.id));
      if (current === p.id) clearProject();
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  };

  const importFile = async (file: File) => {
    setError(null);
    try {
      const p = await save(() => api.importProject(file));
      onOpen(p.id);
    } catch (e) {
      if (e instanceof ApiError) {
        const details = Object.entries(e.fields)
          .slice(0, 5)
          .map(([k, v]) => `${k}: ${v}`)
          .join("；");
        setError(`匯入失敗：${e.message}${details ? `（${details}）` : ""}`);
      }
    }
  };

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="專案">
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-lg bg-white shadow-xl">
        <div className="flex items-center border-b p-4">
          <h2 className="text-lg font-semibold">我的專案</h2>
          {closable && (
            <button className="btn-ghost ml-auto" onClick={onClose} aria-label="關閉">
              ✕
            </button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {error && <div className="mb-3 rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700">{error}</div>}
          {projects === null ? (
            <p className="text-sm text-slate-500">載入中…</p>
          ) : projects.length === 0 ? (
            <p className="text-sm text-slate-500">還沒有專案，建立第一個吧！</p>
          ) : (
            <ul className="divide-y">
              {projects.map((p) => (
                <li key={p.id} className="flex items-center gap-2 py-2">
                  <button className="min-w-0 flex-1 text-left" onClick={() => onOpen(p.id)}>
                    <div className={`truncate font-medium ${p.id === current ? "text-blue-700" : ""}`}>{p.title}</div>
                    {p.description && <div className="truncate text-xs text-slate-500">{p.description}</div>}
                  </button>
                  <button className="btn-ghost text-red-600" onClick={() => remove(p)}>
                    刪除
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="space-y-2 border-t p-4">
          <form onSubmit={create} className="flex gap-2">
            <input className="input" placeholder="新專案名稱，例如：東京五日遊" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
            <button className="btn-primary shrink-0" type="submit" disabled={!title.trim()}>
              建立
            </button>
          </form>
          <button className="btn-secondary w-full" onClick={() => fileRef.current?.click()}>
            從 JSON 備份匯入…
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) importFile(f);
            }}
          />
        </div>
      </div>
    </div>
  );
}
