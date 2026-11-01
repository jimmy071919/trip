import { TRANSPORT_ICONS, TRANSPORT_LABELS, type Day, type Leg } from "./types";

export const DAY_COLORS = ["#2563eb", "#dc2626", "#16a34a", "#9333ea", "#ea580c", "#0891b2", "#c026d3", "#65a30d"];
export const UNSCHEDULED_COLOR = "#64748b";

export function dayColor(days: Day[], dayId: string | null): string {
  if (!dayId) return UNSCHEDULED_COLOR;
  const idx = days.findIndex((d) => d.id === dayId);
  return DAY_COLORS[(idx < 0 ? 0 : idx) % DAY_COLORS.length];
}

const WEEK = ["日", "一", "二", "三", "四", "五", "六"];

export function dayLabel(day: Day, index: number): string {
  const parts: string[] = [];
  if (day.date) {
    const [y, m, d] = day.date.split("-").map(Number);
    const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    parts.push(`${m}/${d}（${WEEK[wd]}）`);
  }
  if (day.title) parts.push(day.title);
  return parts.length ? parts.join(" ") : `Day ${index + 1}`;
}

export function formatMinutes(min: number | null): string {
  if (min == null) return "";
  if (min < 60) return `${min} 分鐘`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} 小時 ${m} 分` : `${h} 小時`;
}

export function legSummary(leg: Leg | undefined): string {
  if (!leg || !leg.transport_mode) return "未設定交通方式";
  const parts = [`${TRANSPORT_ICONS[leg.transport_mode]} ${TRANSPORT_LABELS[leg.transport_mode]}`];
  if (leg.route_name) parts.push(leg.route_name);
  if (leg.duration_minutes != null) parts.push(formatMinutes(leg.duration_minutes));
  if (leg.cost_amount != null) parts.push(`${leg.currency ?? ""} ${Number(leg.cost_amount).toLocaleString()}`.trim());
  return parts.join("・");
}

export function hhmm(t: string | null): string {
  return t ? t.slice(0, 5) : "";
}

/** Stops of a day / unscheduled sorted by sort_order. */
export function sortStops<T extends { sort_order: number | null }>(stops: T[]): T[] {
  return [...stops].sort((a, b) => (a.sort_order ?? 1e9) - (b.sort_order ?? 1e9));
}
