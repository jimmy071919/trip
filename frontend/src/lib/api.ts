import type { AuthStatus, Bundle, Day, Leg, Project, PublicConfig, ResolvedPlace, Stop, User } from "./types";

const BASE = "/api/v1";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields: Record<string, string> = {},
  ) {
    super(message);
  }
  get isNetwork() {
    return this.status === 0;
  }
}

type Handler = () => void;
let onUnauthorized: Handler | null = null;
export function setUnauthorizedHandler(h: Handler | null) {
  onUnauthorized = h;
}

export async function request<T>(method: string, path: string, body?: unknown, opts: { raw?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = { "X-Requested-With": "fetch" };
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(BASE + path, { method, headers, body: payload, credentials: "same-origin" });
  } catch {
    throw new ApiError(0, "network", "無法連線到伺服器，請檢查網路後重試");
  }
  if (res.status === 204) return undefined as T;
  let data: any = null;
  const text = await res.text();
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON (e.g. proxy error page) */
  }
  if (!res.ok) {
    const err = data?.error;
    if (res.status === 401 && path !== "/auth/login" && onUnauthorized) onUnauthorized();
    throw new ApiError(
      res.status,
      err?.code ?? "http_error",
      err?.message ?? (res.status >= 500 ? "伺服器暫時無法處理，請稍後重試" : `請求失敗（${res.status}）`),
      err?.fields ?? {},
    );
  }
  return (opts.raw ? text : data) as T;
}

export const api = {
  config: () => request<PublicConfig>("GET", "/config"),
  authStatus: () => request<AuthStatus>("GET", "/auth/status"),
  setup: (username: string, password: string) => request<User>("POST", "/auth/setup", { username, password }),
  login: (username: string, password: string) => request<User>("POST", "/auth/login", { username, password }),
  logout: () => request<void>("POST", "/auth/logout"),

  listProjects: () => request<Project[]>("GET", "/projects"),
  createProject: (body: Partial<Project>) => request<Project>("POST", "/projects", body),
  updateProject: (id: string, body: Partial<Project>) => request<Project>("PATCH", `/projects/${id}`, body),
  deleteProject: (id: string) => request<void>("DELETE", `/projects/${id}`),
  bundle: (id: string) => request<Bundle>("GET", `/projects/${id}/bundle`),
  exportProject: (id: string) => request<string>("GET", `/projects/${id}/export`, undefined, { raw: true }),
  importProject: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return request<Project>("POST", "/projects/import", fd);
  },

  createDay: (projectId: string, body: Partial<Day>) => request<Day>("POST", `/projects/${projectId}/days`, body),
  updateDay: (id: string, body: Partial<Day>) => request<Day>("PATCH", `/days/${id}`, body),
  deleteDay: (id: string) => request<void>("DELETE", `/days/${id}`),
  setStopOrder: (dayId: string, stopIds: string[]) => request<Stop[]>("PUT", `/days/${dayId}/stop-order`, { stop_ids: stopIds }),
  setUnscheduledOrder: (projectId: string, stopIds: string[]) =>
    request<Stop[]>("PUT", `/projects/${projectId}/unscheduled-order`, { stop_ids: stopIds }),

  createStop: (projectId: string, body: Partial<Stop>) => request<Stop>("POST", `/projects/${projectId}/stops`, body),
  updateStop: (id: string, body: Partial<Stop>) => request<Stop>("PATCH", `/stops/${id}`, body),
  deleteStop: (id: string) => request<void>("DELETE", `/stops/${id}`),

  updateLeg: (id: string, body: Partial<Leg>) => request<Leg>("PATCH", `/legs/${id}`, body),

  resolveGoogleLink: (url: string) => request<ResolvedPlace>("POST", "/places/resolve-google-link", { url }),
};
