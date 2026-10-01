"use client";

// The trip on a real map (Leaflet + OpenStreetMap). Outlet positions are
// approximate: outlets.csv has no coordinates, so the server places each outlet
// near its district town (backend/app/services/geo.py) and the map says so.
// Without a connection the pins and the stop-order line still draw; only the
// map tiles may be missing (the service worker keeps the ones already seen).
//
// Browser only: load it through ./route-map-lazy.

import * as React from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { PlaceRef } from "@/lib/driver/types";

export type MapStopStatus = "planned" | "pending" | "arrived" | "delivered" | "partial" | "failed" | "rescheduled";

export interface MapStop {
  sequence: number;
  latitude: number;
  longitude: number;
  name: string;
  status: MapStopStatus;
}

export interface MapUser {
  latitude: number;
  longitude: number;
  accuracy: number;
}

export interface RouteMapProps {
  depot: PlaceRef | null;
  stops: MapStop[];
  /** The stop to highlight (the next one). */
  activeSequence?: number | null;
  /** full: pan and zoom; preview/strip: a fixed picture of the trip. */
  interactive?: boolean;
  user?: MapUser | null;
  /** Fit the view to this stop and its neighbours instead of the whole trip. */
  focusSequence?: number | null;
}

const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const PIN_CLASSES: Record<MapStopStatus, string> = {
  planned: "bg-primary",
  pending: "bg-primary",
  arrived: "bg-info",
  delivered: "bg-success",
  partial: "bg-warning",
  failed: "bg-destructive",
  rescheduled: "bg-muted-foreground",
};

function stopIcon(stop: MapStop, active: boolean): L.DivIcon {
  const size = active ? 36 : 30;
  const ring = active ? "ring-4 ring-primary/30" : "";
  return L.divIcon({
    className: "",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<span class="flex size-full items-center justify-center rounded-full border-2 border-white text-xs font-bold text-white shadow-md ${PIN_CLASSES[stop.status]} ${ring}">${stop.sequence}</span>`,
  });
}

const depotIcon = () =>
  L.divIcon({
    className: "",
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    html: '<span class="flex size-full items-center justify-center rounded-lg border-2 border-white bg-brand-strong text-[10px] font-bold text-white shadow-md">DC</span>',
  });

export default function RouteMap({
  depot,
  stops,
  activeSequence = null,
  interactive = true,
  user = null,
  focusSequence = null,
}: RouteMapProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const mapRef = React.useRef<L.Map | null>(null);
  const routeLayerRef = React.useRef<L.LayerGroup | null>(null);
  const userLayerRef = React.useRef<L.LayerGroup | null>(null);

  // Create the map once.
  React.useEffect(() => {
    if (!containerRef.current) return;
    const map = L.map(containerRef.current, {
      zoomControl: interactive,
      dragging: interactive,
      touchZoom: interactive,
      doubleClickZoom: interactive,
      scrollWheelZoom: false,
      boxZoom: false,
      keyboard: interactive,
      attributionControl: true,
    });
    map.attributionControl.setPrefix(false);
    L.tileLayer(TILE_URL, { maxZoom: 18, attribution: ATTRIBUTION }).addTo(map);
    routeLayerRef.current = L.layerGroup().addTo(map);
    userLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [interactive]);

  // Depot, stops and the stop-order line.
  React.useEffect(() => {
    const map = mapRef.current;
    const layer = routeLayerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();

    const ordered = [...stops].sort((a, b) => a.sequence - b.sequence);
    const points: L.LatLngExpression[] = [];
    if (depot) {
      L.marker([depot.latitude, depot.longitude], { icon: depotIcon(), title: depot.name, keyboard: false })
        .bindTooltip(depot.name)
        .addTo(layer);
      points.push([depot.latitude, depot.longitude]);
    }
    for (const stop of ordered) {
      const active = stop.sequence === activeSequence;
      L.marker([stop.latitude, stop.longitude], {
        icon: stopIcon(stop, active),
        title: `Stop ${stop.sequence} · ${stop.name}`,
        zIndexOffset: active ? 1000 : 0,
        keyboard: false,
      })
        .bindTooltip(`Stop ${stop.sequence} · ${stop.name}`)
        .addTo(layer);
      if (stop.status !== "rescheduled") points.push([stop.latitude, stop.longitude]);
    }
    if (points.length > 1) {
      // Theme colours come from classes: CSS beats the SVG attributes Leaflet writes.
      L.polyline(points, { className: "stroke-primary", weight: 4, opacity: 0.75, dashArray: "8 8" }).addTo(layer);
    }

    let focus: L.LatLngExpression[] = points;
    if (focusSequence != null) {
      const index = ordered.findIndex((stop) => stop.sequence === focusSequence);
      if (index >= 0) {
        focus = ordered
          .slice(Math.max(0, index - 1), index + 2)
          .map((stop): L.LatLngExpression => [stop.latitude, stop.longitude]);
      }
    }
    if (focus.length === 1) map.setView(focus[0], 14);
    else if (focus.length > 1) map.fitBounds(L.latLngBounds(focus), { padding: [28, 28], maxZoom: 15 });
    else map.setView([7.8731, 80.7718], 7); // Sri Lanka
  }, [depot, stops, activeSequence, focusSequence]);

  // The driver's own position, when they allowed it.
  React.useEffect(() => {
    const layer = userLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    if (!user) return;
    L.circle([user.latitude, user.longitude], {
      radius: Math.min(user.accuracy, 500),
      className: "stroke-info fill-info",
      weight: 1,
      fillOpacity: 0.12,
    }).addTo(layer);
    L.circleMarker([user.latitude, user.longitude], {
      radius: 8,
      className: "stroke-white fill-info",
      weight: 3,
      fillOpacity: 1,
    })
      .bindTooltip("You")
      .addTo(layer);
  }, [user]);

  return (
    <div
      ref={containerRef}
      className="size-full [&_.leaflet-tile-pane]:saturate-[0.4]"
      role="region"
      aria-label={`Route map: ${stops.length} stops, approximate positions`}
    />
  );
}
