import { useState } from "react";
import { api, ApiError } from "../lib/api";
import { useStore } from "../lib/store";
import { Field, FormError } from "./Field";
import { mapHandle } from "./MapView";

const TIMEZONES = ["Asia/Taipei", "Asia/Tokyo", "Asia/Seoul", "Asia/Hong_Kong", "Asia/Shanghai", "Asia/Bangkok", "Asia/Singapore", "Europe/London", "Europe/Paris", "America/New_York", "America/Los_Angeles", "UTC"];

export default function ProjectPanel() {
  const project = useStore((s) => s.project)!;
  const { save, setProject } = useStore.getState();
  const [title, setTitle] = useState(project.title);
  const [description, setDescription] = useState(project.description ?? "");
  const [timezone, setTimezone] = useState(project.timezone);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [viewMsg, setViewMsg] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return setErrors({ title: "請輸入專案名稱" });
    setErrors({});
    setErr(null);
    try {
      setProject(await save(() => api.updateProject(project.id, { title: title.trim(), description, timezone })));
    } catch (e) {
      if (e instanceof ApiError) {
        setErrors(e.fields);
        setErr(e.message);
      }
    }
  };

  const saveView = async () => {
    const map = mapHandle.current;
    if (!map) return;
    const c = map.getCenter().wrap();
    try {
      setProject(
        await save(() =>
          api.updateProject(project.id, { map_center_lat: c.lat, map_center_lon: c.lng, map_zoom: Math.round(map.getZoom()) }),
        ),
      );
      setViewMsg("已將目前地圖位置設為預設檢視");
    } catch {
      setViewMsg(null);
    }
  };

  const tzOptions = TIMEZONES.includes(project.timezone) ? TIMEZONES : [project.timezone, ...TIMEZONES];
  return (
    <div>
      <form onSubmit={submit} noValidate>
        <h2 className="mb-3 text-base font-semibold">專案設定</h2>
        <FormError message={err} />
        <Field label="專案名稱 *" error={errors.title} htmlFor="p-title">
          <input id="p-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
        </Field>
        <Field label="描述" htmlFor="p-desc">
          <textarea id="p-desc" className="input min-h-[80px]" value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label="時區" error={errors.timezone} htmlFor="p-tz">
          <select id="p-tz" className="input" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
            {tzOptions.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </Field>
        <button className="btn-primary" type="submit">
          儲存
        </button>
      </form>
      <hr className="my-4" />
      <h3 className="mb-2 text-sm font-semibold">地圖預設檢視</h3>
      <p className="mb-2 text-xs text-slate-500">
        {project.map_center_lat != null
          ? `目前預設：${project.map_center_lat.toFixed(4)}, ${project.map_center_lon!.toFixed(4)}，縮放 ${project.map_zoom}`
          : "尚未設定；開啟專案時會自動縮放至所有地點。"}
      </p>
      <button className="btn-secondary" onClick={saveView}>
        以目前地圖位置作為預設
      </button>
      {viewMsg && <p className="mt-2 text-xs text-green-700">{viewMsg}</p>}
    </div>
  );
}
