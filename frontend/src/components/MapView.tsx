import L from "leaflet";
import { Fragment, useEffect, useMemo, useRef } from "react";
import { MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap, useMapEvents } from "react-leaflet";
import { api } from "../lib/api";
import { dayColor, legSummary } from "../lib/format";
import { groupStops, isGroupVisible, legFor, useStore } from "../lib/store";
import type { PublicConfig, Stop } from "../lib/types";

const DEFAULT_CENTER: [number, number] = [25.0418, 121.5654];
const DEFAULT_ZOOM = 12;
const COARSE = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;

const iconCache = new Map<string, L.DivIcon>();
function stopIcon(label: string, color: string, selected: boolean, draft = false): L.DivIcon {
  const key = `${label}|${color}|${selected}|${draft}`;
  let icon = iconCache.get(key);
  if (!icon) {
    const safe = label.replace(/[<>&"]/g, "");
    icon = L.divIcon({
      className: "stop-marker",
      html: `<div class="stop-pin${selected ? " selected" : ""}${draft ? " draft" : ""}" style="background:${draft ? "" : color}">${safe}</div>`,
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    });
    iconCache.set(key, icon);
  }
  return icon;
}

function ClickToAdd() {
  const addMode = useStore((s) => s.addMode);
  const select = useStore((s) => s.select);
  const map = useMapEvents({
    click(e) {
      if (!useStore.getState().addMode) return;
      select({ kind: "draft", lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  useEffect(() => {
    const el = map.getContainer();
    el.classList.toggle("adding", addMode);
  }, [addMode, map]);
  return null;
}

export const mapHandle: { current: L.Map | null } = { current: null };

function ViewController() {
  const map = useMap();
  mapHandle.current = map;
  const project = useStore((s) => s.project);
  const selection = useStore((s) => s.selection);
  const stops = useStore((s) => s.stops);
  const lastProject = useRef<string | null>(null);

  // initial view per project: saved default, else fit all stops, else default
  useEffect(() => {
    if (!project || lastProject.current === project.id) return;
    lastProject.current = project.id;
    // wait for side panels to mount so the map has its final size
    const raf = requestAnimationFrame(() => {
      map.invalidateSize({ pan: false });
      if (project.map_center_lat != null && project.map_center_lon != null) {
        map.setView([project.map_center_lat, project.map_center_lon], project.map_zoom ?? DEFAULT_ZOOM);
      } else if (stops.length) {
        map.fitBounds(L.latLngBounds(stops.map((s) => [s.latitude, s.longitude] as [number, number])), { padding: [40, 40], maxZoom: 15 });
      } else {
        map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [project, stops, map]);

  // bring selected stop into view
  useEffect(() => {
    if (selection.kind !== "stop") return;
    const s = useStore.getState().stops.find((x) => x.id === selection.id);
    if (s && !map.getBounds().pad(-0.1).contains([s.latitude, s.longitude])) map.panTo([s.latitude, s.longitude]);
  }, [selection, map]);

  // container resizes (drawers / bottom sheet) need invalidateSize
  useEffect(() => {
    const ro = new ResizeObserver(() => map.invalidateSize({ pan: false }));
    ro.observe(map.getContainer());
    return () => ro.disconnect();
  }, [map]);
  return null;
}

function StopMarker({ stop, label, color }: { stop: Stop; label: string; color: string }) {
  const selected = useStore((s) => s.selection.kind === "stop" && s.selection.id === stop.id);
  const pos = useStore((s) => s.dragPos[stop.id]);
  const { select, setDragPos, save, upsertStop } = useStore.getState();
  const position: [number, number] = pos ?? [stop.latitude, stop.longitude];

  const handlers = useMemo(
    () => ({
      click: () => select({ kind: "stop", id: stop.id }),
      drag: (e: L.LeafletEvent) => {
        const ll = (e.target as L.Marker).getLatLng();
        setDragPos(stop.id, [ll.lat, ll.lng]);
      },
      dragend: (e: L.LeafletEvent) => {
        const ll = (e.target as L.Marker).getLatLng().wrap();
        const lat = Math.max(-90, Math.min(90, ll.lat));
        const lng = ll.lng;
        // keep the moved position locally even if saving fails (retry available)
        upsertStop({ ...stop, latitude: lat, longitude: lng });
        setDragPos(stop.id, null);
        save(() => api.updateStop(stop.id, { latitude: lat, longitude: lng })).then(upsertStop, () => undefined);
      },
    }),
    [stop, select, setDragPos, save, upsertStop],
  );

  return (
    <Marker
      position={position}
      icon={stopIcon(label, color, selected)}
      draggable={!COARSE || selected}
      eventHandlers={handlers}
      zIndexOffset={selected ? 1000 : 0}
      title={stop.title}
    >
      <Tooltip direction="top" offset={[0, -14]}>{stop.title}</Tooltip>
    </Marker>
  );
}

function DraftMarker() {
  const sel = useStore((s) => s.selection);
  const select = useStore((s) => s.select);
  const handlers = useMemo(
    () => ({
      dragend: (e: L.LeafletEvent) => {
        const ll = (e.target as L.Marker).getLatLng().wrap();
        select({ kind: "draft", lat: ll.lat, lng: ll.lng });
      },
    }),
    [select],
  );
  if (sel.kind !== "draft") return null;
  return <Marker position={[sel.lat, sel.lng]} icon={stopIcon("+", "", true, true)} draggable eventHandlers={handlers} zIndexOffset={2000} />;
}

function Routes() {
  const days = useStore((s) => s.days);
  const stops = useStore((s) => s.stops);
  const legs = useStore((s) => s.legs);
  const dragPos = useStore((s) => s.dragPos);
  const dayFilter = useStore((s) => s.dayFilter);
  const hiddenGroups = useStore((s) => s.hiddenGroups);
  const selection = useStore((s) => s.selection);
  const select = useStore((s) => s.select);

  const pos = (s: Stop): [number, number] => dragPos[s.id] ?? [s.latitude, s.longitude];

  return (
    <>
      {days.map((day) => {
        if (!isGroupVisible({ dayFilter, hiddenGroups }, day.id)) return null;
        const list = groupStops(stops, day.id);
        const color = dayColor(days, day.id);
        return list.slice(1).map((to, i) => {
          const from = list[i];
          const leg = legFor(legs, from.id, to.id);
          const selected = !!leg && selection.kind === "leg" && selection.id === leg.id;
          const onClick = () => leg && select({ kind: "leg", id: leg.id });
          const positions = [pos(from), pos(to)];
          return (
            <Fragment key={`${from.id}-${to.id}`}>
              <Polyline
                positions={positions}
                pathOptions={{
                  color: selected ? "#f59e0b" : color,
                  weight: selected ? 6 : 4,
                  opacity: 0.85,
                  dashArray: leg?.transport_mode ? undefined : "6 8",
                }}
                interactive={false}
              />
              {/* wide invisible hit target for easier clicking / tapping */}
              <Polyline positions={positions} pathOptions={{ color: "#000", opacity: 0, weight: 18 }} eventHandlers={{ click: onClick }}>
                <Tooltip sticky>
                  {from.title} → {to.title}：{legSummary(leg)}
                </Tooltip>
              </Polyline>
            </Fragment>
          );
        });
      })}
    </>
  );
}

function Markers() {
  const days = useStore((s) => s.days);
  const stops = useStore((s) => s.stops);
  const dayFilter = useStore((s) => s.dayFilter);
  const hiddenGroups = useStore((s) => s.hiddenGroups);
  const groups = [...days.map((d) => d.id), "unscheduled"];
  return (
    <>
      {groups.map((key) => {
        if (!isGroupVisible({ dayFilter, hiddenGroups }, key)) return null;
        const color = dayColor(days, key === "unscheduled" ? null : key);
        return groupStops(stops, key).map((s, i) => (
          <StopMarker key={s.id} stop={s} label={key === "unscheduled" ? "•" : String(i + 1)} color={color} />
        ));
      })}
    </>
  );
}

export default function MapView({ config }: { config: PublicConfig }) {
  return (
    <MapContainer center={DEFAULT_CENTER} zoom={DEFAULT_ZOOM} className="h-full w-full" worldCopyJump>
      <TileLayer url={config.tile_url} attribution={config.tile_attribution} maxZoom={config.tile_max_zoom} />
      <ClickToAdd />
      <ViewController />
      <Routes />
      <Markers />
      <DraftMarker />
    </MapContainer>
  );
}
