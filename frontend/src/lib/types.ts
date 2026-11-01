export type UUID = string;

export interface User { id: UUID; username: string }
export interface AuthStatus { user: User | null; setup_required: boolean }

export interface Project {
  id: UUID;
  title: string;
  description: string | null;
  timezone: string;
  map_center_lat: number | null;
  map_center_lon: number | null;
  map_zoom: number | null;
  created_at: string;
  updated_at: string;
}

export interface Day {
  id: UUID;
  project_id: UUID;
  date: string | null;
  title: string | null;
  sort_order: number;
}

export interface Stop {
  id: UUID;
  project_id: UUID;
  day_id: UUID | null;
  title: string;
  latitude: number;
  longitude: number;
  address: string | null;
  description: string | null;
  reference_url: string | null;
  arrival_time: string | null;
  stay_minutes: number | null;
  sort_order: number | null;
  updated_at: string;
}

export const TRANSPORT_MODES = [
  "walk", "bicycle", "scooter", "car", "bus", "metro", "train", "taxi", "ferry", "flight", "other",
] as const;
export type TransportMode = (typeof TRANSPORT_MODES)[number];

export const TRANSPORT_LABELS: Record<TransportMode, string> = {
  walk: "步行",
  bicycle: "腳踏車",
  scooter: "機車",
  car: "汽車",
  bus: "公車",
  metro: "捷運／地鐵",
  train: "火車／高鐵",
  taxi: "計程車",
  ferry: "渡輪",
  flight: "飛機",
  other: "其他",
};

export const TRANSPORT_ICONS: Record<TransportMode, string> = {
  walk: "🚶", bicycle: "🚲", scooter: "🛵", car: "🚗", bus: "🚌", metro: "🚇",
  train: "🚆", taxi: "🚕", ferry: "⛴️", flight: "✈️", other: "•",
};

export interface Leg {
  id: UUID;
  project_id: UUID;
  day_id: UUID;
  from_stop_id: UUID;
  to_stop_id: UUID;
  is_active: boolean;
  transport_mode: TransportMode | null;
  route_name: string | null;
  duration_minutes: number | null;
  cost_amount: string | null;
  currency: string | null;
  description: string | null;
  reference_url: string | null;
  updated_at: string;
}

export interface Bundle { project: Project; days: Day[]; stops: Stop[]; legs: Leg[] }

export interface PublicConfig {
  tile_url: string;
  tile_attribution: string;
  tile_max_zoom: number;
  default_timezone: string;
  transport_modes: string[];
  google_places_enabled: boolean;
}

export interface ResolvedPlace {
  name: string | null;
  latitude: number | null;
  longitude: number | null;
  precise: boolean;
  address: string | null;
  phone: string | null;
  website: string | null;
  opening_hours: string[];
  rating: number | null;
  google_maps_url: string | null;
  source: "url" | "google_places" | "nominatim";
  warnings: string[];
}
