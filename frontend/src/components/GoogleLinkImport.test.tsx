import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStore } from "../lib/store";
import type { ResolvedPlace } from "../lib/types";
import GoogleLinkImport, { placeToPrefill } from "./GoogleLinkImport";

const place: ResolvedPlace = {
  name: "淺草寺", latitude: 35.7147, longitude: 139.7966, precise: true, address: "東京都台東區淺草2-3-1",
  phone: "03-3842-0181", website: "https://www.senso-ji.jp/", opening_hours: ["星期一: 06:00–17:00"], rating: 4.5,
  google_maps_url: "https://www.google.com/maps/place/x", source: "google_places", warnings: [],
};

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));

beforeEach(() => {
  useStore.setState({
    project: { id: "p", title: "T", description: null, timezone: "Asia/Tokyo", map_center_lat: null, map_center_lon: null, map_zoom: null, created_at: "", updated_at: "" },
    dayFilter: "d",
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  useStore.setState({ selection: { kind: "none" }, addMode: false, draftPrefill: null, draftNotice: null });
});

describe("Google Maps link import", () => {
  it("maps place details into stop fields", () => {
    const p = placeToPrefill(place);
    expect(p).toMatchObject({ title: "淺草寺", address: "東京都台東區淺草2-3-1", reference_url: "https://www.google.com/maps/place/x" });
    expect(p.description).toContain("電話：03-3842-0181");
    expect(p.description).toContain("星期一: 06:00–17:00");
  });

  it("creates the stop immediately in the filtered day and selects it", async () => {
    const created = { id: "s1", project_id: "p", day_id: "d", title: "淺草寺", latitude: 35.7147, longitude: 139.7966, address: place.address, description: null, reference_url: place.google_maps_url, arrival_time: null, stay_minutes: null, sort_order: 0, updated_at: "" };
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith("/resolve-google-link")) return json(place);
      if (url.endsWith("/stops")) return json(created, 201);
      return json({ project: useStore.getState().project, days: [], stops: [created], legs: [] }); // bundle refresh
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<GoogleLinkImport placesEnabled />);
    await userEvent.type(screen.getByLabelText("從 Google 地圖連結新增"), "https://maps.app.goo.gl/abc");
    await userEvent.click(screen.getByRole("button", { name: "新增" }));
    await waitFor(() => expect(useStore.getState().selection).toEqual({ kind: "stop", id: "s1" }));
    const createCall = fetchMock.mock.calls.find(([u]) => String(u).endsWith("/stops"))!;
    expect(JSON.parse(String((createCall as unknown as [string, RequestInit])[1].body))).toMatchObject({
      title: "淺草寺", latitude: 35.7147, longitude: 139.7966, day_id: "d", address: "東京都台東區淺草2-3-1",
    });
    expect(await screen.findByTestId("gmaps-notice")).toHaveTextContent("已新增「淺草寺」");
  });

  it("falls back to click-to-place only when nothing could locate the link", async () => {
    const noCoords = { ...place, latitude: null, longitude: null, source: "url", warnings: ["連結中沒有座標，請在地圖上點選地點位置"] };
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify(noCoords), { status: 200 }))));
    render(<GoogleLinkImport placesEnabled={false} />);
    await userEvent.type(screen.getByLabelText("從 Google 地圖連結新增"), "https://maps.google.com/?q=x");
    await userEvent.click(screen.getByRole("button", { name: "新增" }));
    await waitFor(() => expect(useStore.getState().addMode).toBe(true));
    expect(useStore.getState().draftNotice).toContain("沒有座標");
    // clicking the map keeps the prefill
    useStore.getState().select({ kind: "draft", lat: 1, lng: 2 });
    expect(useStore.getState().draftPrefill?.title).toBe("淺草寺");
  });

  it("shows the server's error for non-Google links", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify({ error: { code: "invalid", message: "這不是 Google 地圖的連結", fields: {} } }), { status: 422 }))));
    render(<GoogleLinkImport placesEnabled />);
    await userEvent.type(screen.getByLabelText("從 Google 地圖連結新增"), "https://example.com");
    await userEvent.click(screen.getByRole("button", { name: "新增" }));
    expect(await screen.findByText("這不是 Google 地圖的連結")).toBeInTheDocument();
  });
});
