import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveStateOf, useStore } from "../lib/store";
import type { Leg, Stop } from "../lib/types";
import LegForm, { validateLegForm } from "./LegForm";
import StopForm, { validateStopForm } from "./StopForm";

const stop = (id: string, title: string): Stop => ({
  id, title, project_id: "p", day_id: "d", latitude: 35, longitude: 139, address: null, description: null,
  reference_url: null, arrival_time: null, stay_minutes: null, sort_order: 0, updated_at: "",
});
const leg: Leg = {
  id: "l1", project_id: "p", day_id: "d", from_stop_id: "a", to_stop_id: "b", is_active: true, transport_mode: null,
  route_name: null, duration_minutes: null, cost_amount: null, currency: null, description: null, reference_url: null, updated_at: "",
};

function mockFetch(impl: (url: string, init: RequestInit) => Promise<Response>) {
  const f = vi.fn(impl);
  vi.stubGlobal("fetch", f);
  return f;
}
const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

beforeEach(() => {
  useStore.setState({
    project: { id: "p", title: "T", description: null, timezone: "Asia/Tokyo", map_center_lat: null, map_center_lon: null, map_zoom: null, created_at: "", updated_at: "" },
    days: [{ id: "d", project_id: "p", date: "2026-11-05", title: null, sort_order: 0 }],
    stops: [stop("a", "東京車站"), stop("b", "淺草")],
    legs: [leg],
    inflight: 0, failures: [], validationError: null, savedOnce: false,
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("validation", () => {
  it("rejects out-of-range coordinates and missing title", () => {
    const e = validateStopForm({ title: " ", day_id: "", latitude: "91", longitude: "abc", address: "", arrival_time: "", stay_minutes: "-1", description: "", reference_url: "javascript:x" });
    expect(Object.keys(e).sort()).toEqual(["latitude", "longitude", "reference_url", "stay_minutes", "title"]);
  });
  it("rejects bad leg numbers", () => {
    const e = validateLegForm({ transport_mode: "", route_name: "", duration_minutes: "1.5", cost_amount: "-3", currency: "YENX", description: "", reference_url: "" });
    expect(Object.keys(e).sort()).toEqual(["cost_amount", "currency", "duration_minutes"]);
  });
});

describe("LegForm", () => {
  it("sends the edited transport info and shows it", async () => {
    const f = mockFetch((_u, init) => json({ ...leg, ...JSON.parse(String(init.body)), cost_amount: "210.00" }));
    render(<LegForm leg={leg} />);
    expect(screen.getByText("東京車站")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("交通方式"), "metro");
    await userEvent.type(screen.getByLabelText("路線／班次"), "銀座線");
    await userEvent.type(screen.getByLabelText("所需時間（分鐘）"), "25");
    await userEvent.type(screen.getByLabelText("費用"), "210");
    await userEvent.click(screen.getByRole("button", { name: "儲存變更" }));
    await waitFor(() => expect(f).toHaveBeenCalled());
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("/api/v1/legs/l1");
    expect(init.method).toBe("PATCH");
    expect((init.headers as Record<string, string>)["X-Requested-With"]).toBe("fetch");
    expect(JSON.parse(String(init.body))).toMatchObject({ transport_mode: "metro", route_name: "銀座線", duration_minutes: 25, cost_amount: "210", currency: "JPY" });
    await waitFor(() => expect(useStore.getState().legs[0].transport_mode).toBe("metro"));
    expect(saveStateOf(useStore.getState())).toBe("saved");
  });

  it("shows server field errors", async () => {
    mockFetch(() => json({ error: { code: "validation_error", message: "輸入資料有誤", fields: { route_name: "太長了" } } }, 422));
    render(<LegForm leg={leg} />);
    await userEvent.click(screen.getByRole("button", { name: "儲存變更" }));
    expect(await screen.findByText("太長了")).toBeInTheDocument();
  });
});

describe("StopForm", () => {
  it("shows 儲存失敗 when the API is unreachable (AC-09)", async () => {
    mockFetch(() => Promise.reject(new TypeError("Failed to fetch")));
    render(<StopForm stop={useStore.getState().stops[0]} />);
    await userEvent.clear(screen.getByLabelText("名稱 *"));
    await userEvent.type(screen.getByLabelText("名稱 *"), "新名稱");
    await userEvent.click(screen.getByRole("button", { name: "儲存" }));
    expect(await screen.findByText(/儲存失敗/)).toBeInTheDocument();
    expect(saveStateOf(useStore.getState())).toBe("error");
    expect(useStore.getState().failures).toHaveLength(1);
    expect(screen.getByLabelText("名稱 *")).toHaveValue("新名稱"); // edits are kept
  });

  it("creates a draft stop in the filtered day", async () => {
    useStore.setState({ dayFilter: "d" });
    const created = { ...stop("n", "車站"), latitude: 35.1, longitude: 139.2 };
    const f = mockFetch((u) =>
      u.endsWith("/bundle")
        ? json({ project: useStore.getState().project, days: useStore.getState().days, stops: [...useStore.getState().stops, created], legs: [] })
        : json(created, 201),
    );
    render(<StopForm draft={{ lat: 35.1, lng: 139.2 }} />);
    expect(screen.getByLabelText("日期")).toHaveValue("d");
    await userEvent.type(screen.getByLabelText("名稱 *"), "車站");
    await userEvent.click(screen.getByRole("button", { name: "儲存" }));
    await waitFor(() => expect(useStore.getState().selection).toEqual({ kind: "stop", id: "n" }));
    const body = JSON.parse(String(f.mock.calls[0][1].body));
    expect(body).toMatchObject({ title: "車站", day_id: "d", latitude: 35.1, longitude: 139.2 });
  });
});
