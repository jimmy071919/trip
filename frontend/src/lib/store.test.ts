import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./api";
import { saveStateOf, useStore } from "./store";

const reset = () => useStore.setState({ inflight: 0, failures: [], validationError: null, savedOnce: false });

describe("save status (SYS-02 / AC-09)", () => {
  beforeEach(reset);

  it("goes saving → saved on success", async () => {
    let resolve!: (v: number) => void;
    const p = useStore.getState().save(() => new Promise<number>((r) => (resolve = r)));
    expect(saveStateOf(useStore.getState())).toBe("saving");
    resolve(1);
    await expect(p).resolves.toBe(1);
    expect(saveStateOf(useStore.getState())).toBe("saved");
  });

  it("shows failure with retry on network error and never reports 'saved'", async () => {
    const op = vi.fn().mockRejectedValueOnce(new ApiError(0, "network", "無法連線")).mockResolvedValueOnce("ok");
    await expect(useStore.getState().save(op)).rejects.toBeInstanceOf(ApiError);
    expect(saveStateOf(useStore.getState())).toBe("error");
    expect(useStore.getState().failures).toHaveLength(1);

    // an unrelated successful save must not hide the unsaved failure
    await useStore.getState().save(() => Promise.resolve(1));
    expect(saveStateOf(useStore.getState())).toBe("error");

    useStore.getState().retryAll();
    await vi.waitFor(() => expect(useStore.getState().failures).toHaveLength(0));
    expect(op).toHaveBeenCalledTimes(2);
    expect(saveStateOf(useStore.getState())).toBe("saved");
  });

  it("does not offer retry for validation errors", async () => {
    await expect(useStore.getState().save(() => Promise.reject(new ApiError(422, "validation_error", "輸入資料有誤")))).rejects.toThrow();
    expect(useStore.getState().failures).toHaveLength(0);
    expect(useStore.getState().validationError).toBe("輸入資料有誤");
    expect(saveStateOf(useStore.getState())).toBe("error");
  });
});

describe("reorderLocal", () => {
  it("renumbers the group and drops that day's legs until refresh", () => {
    const base = { project_id: "p", latitude: 0, longitude: 0, address: null, description: null, reference_url: null, arrival_time: null, stay_minutes: null, updated_at: "" };
    useStore.setState({
      stops: [
        { ...base, id: "a", day_id: "d", title: "A", sort_order: 0 },
        { ...base, id: "b", day_id: "d", title: "B", sort_order: 1 },
        { ...base, id: "u", day_id: null, title: "U", sort_order: 0 },
      ],
      legs: [{ id: "l", day_id: "d", from_stop_id: "a", to_stop_id: "b" } as never],
    });
    useStore.getState().reorderLocal("d", ["b", "a"]);
    const s = useStore.getState();
    expect(s.stops.find((x) => x.id === "b")!.sort_order).toBe(0);
    expect(s.stops.find((x) => x.id === "u")!.sort_order).toBe(0);
    expect(s.legs).toHaveLength(0);
  });
});
