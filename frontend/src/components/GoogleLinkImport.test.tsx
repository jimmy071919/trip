import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useStore } from "../lib/store";
import type { ResolvedPlace } from "../lib/types";
import GoogleLinkImport, { placeToPrefill } from "./GoogleLinkImport";

const place: ResolvedPlace = {
  name: "淺草寺", latitude: 35.7147, longitude: 139.7966, precise: true, address: "東京都台東區淺草2-3-1",
  phone: "03-3842-0181", website: "https://www.senso-ji.jp/", opening_hours: ["星期一: 06:00–17:00"], rating: 4.5,
  google_maps_url: "https://www.google.com/maps/place/x", source: "google_places", warnings: [],
};

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

  it("opens a pre-filled draft at the resolved location", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify(place), { status: 200 }))));
    render(<GoogleLinkImport placesEnabled />);
    await userEvent.type(screen.getByLabelText("從 Google 地圖連結新增"), "https://maps.app.goo.gl/abc");
    await userEvent.click(screen.getByRole("button", { name: "定位" }));
    await waitFor(() => expect(useStore.getState().selection).toEqual({ kind: "draft", lat: 35.7147, lng: 139.7966 }));
    expect(useStore.getState().draftPrefill?.title).toBe("淺草寺");
  });

  it("falls back to click-to-place when the link has no coordinates", async () => {
    const noCoords = { ...place, latitude: null, longitude: null, source: "url", warnings: ["連結中沒有座標，請在地圖上點選地點位置"] };
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify(noCoords), { status: 200 }))));
    render(<GoogleLinkImport placesEnabled={false} />);
    await userEvent.type(screen.getByLabelText("從 Google 地圖連結新增"), "https://maps.google.com/?q=x");
    await userEvent.click(screen.getByRole("button", { name: "定位" }));
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
    await userEvent.click(screen.getByRole("button", { name: "定位" }));
    expect(await screen.findByText("這不是 Google 地圖的連結")).toBeInTheDocument();
  });
});
