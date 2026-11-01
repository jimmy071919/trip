import { saveStateOf, useStore } from "../lib/store";

export default function StatusBar({ attribution }: { attribution?: string }) {
  const state = useStore(saveStateOf);
  const failures = useStore((s) => s.failures);
  const validationError = useStore((s) => s.validationError);
  const { retryAll, dismissFailures } = useStore.getState();

  return (
    <footer className="flex items-center gap-3 border-t border-slate-200 bg-white px-3 py-1 text-xs" role="status" aria-live="polite" data-testid="save-status">
      {state === "saving" && <span className="text-blue-600">● 儲存中…</span>}
      {state === "saved" && <span className="text-green-700">✓ 已儲存</span>}
      {state === "idle" && <span className="text-slate-400">就緒</span>}
      {state === "error" && (
        <span className="flex flex-wrap items-center gap-2 text-red-600" data-testid="save-error">
          ✕ 儲存失敗{failures.length > 1 ? `（${failures.length} 項）` : ""}：{failures.at(-1)?.message ?? validationError}
          {failures.length > 0 && (
            <button className="rounded border border-red-300 px-2 py-0.5 hover:bg-red-50" onClick={retryAll}>
              重試
            </button>
          )}
          {failures.length === 0 && (
            <button className="text-slate-500 underline" onClick={dismissFailures}>
              關閉
            </button>
          )}
        </span>
      )}
      <span className="ml-auto hidden truncate text-slate-400 sm:inline">地圖連線為示意直線，非實際路線</span>
      {attribution && <span className="sr-only">{attribution}</span>}
    </footer>
  );
}
