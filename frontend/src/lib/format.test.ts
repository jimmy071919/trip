import { describe, expect, it } from "vitest";
import { dayLabel, formatMinutes, legSummary } from "./format";
import type { Leg } from "./types";

describe("format", () => {
  it("formats minutes", () => {
    expect(formatMinutes(15)).toBe("15 分鐘");
    expect(formatMinutes(60)).toBe("1 小時");
    expect(formatMinutes(95)).toBe("1 小時 35 分");
  });
  it("labels days", () => {
    expect(dayLabel({ id: "x", project_id: "p", date: "2026-11-05", title: null, sort_order: 0 }, 0)).toBe("11/5（四）");
    expect(dayLabel({ id: "x", project_id: "p", date: null, title: null, sort_order: 0 }, 2)).toBe("Day 3");
  });
  it("summarises legs and flags unset ones (LEG-07)", () => {
    expect(legSummary(undefined)).toBe("未設定交通方式");
    const leg = { transport_mode: "train", route_name: "JR", duration_minutes: 40, cost_amount: "580.00", currency: "JPY" } as Leg;
    expect(legSummary(leg)).toBe("🚆 火車／高鐵・JR・40 分鐘・JPY 580");
  });
});
