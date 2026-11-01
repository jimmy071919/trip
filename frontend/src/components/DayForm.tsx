import { useState } from "react";
import { api, ApiError } from "../lib/api";
import { useStore } from "../lib/store";
import type { Day } from "../lib/types";
import { Field, FormError } from "./Field";

export default function DayForm({ day }: { day: Day }) {
  const { save, upsertDay, select } = useStore.getState();
  const count = useStore((s) => s.stops.filter((x) => x.day_id === day.id).length);
  const [date, setDate] = useState(day.date ?? "");
  const [title, setTitle] = useState(day.title ?? "");
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      upsertDay(await save(() => api.updateDay(day.id, { date: date || null, title })));
    } catch (e) {
      if (e instanceof ApiError) setErr(e.message);
    }
  };
  const remove = async () => {
    const msg = count
      ? `確定刪除此日期？\n其中 ${count} 個地點會移到「未排程」，此日期的交通紀錄將被刪除。`
      : "確定刪除此日期？";
    if (!window.confirm(msg)) return;
    try {
      await save(() => api.deleteDay(day.id), { refresh: true });
      select({ kind: "none" });
    } catch (e) {
      if (e instanceof ApiError) setErr(e.message);
    }
  };
  return (
    <form onSubmit={submit} noValidate>
      <h2 className="mb-3 text-base font-semibold">日期設定</h2>
      <FormError message={err} />
      <Field label="日期" htmlFor="day-date">
        <input id="day-date" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
      <Field label="標題" htmlFor="day-title">
        <input id="day-title" className="input" placeholder="例：淺草、上野一日遊" value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <div className="flex gap-2">
        <button className="btn-primary" type="submit">
          儲存
        </button>
        <button className="btn-danger ml-auto" type="button" onClick={remove}>
          刪除日期
        </button>
      </div>
    </form>
  );
}
