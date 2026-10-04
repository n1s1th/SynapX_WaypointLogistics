"use client";

import React, { useState } from "react";
import {
  Building2,
  Truck,
  Store,
  Tablet,
  MapPin,
  Snowflake,
  Sun,
  CheckCircle2,
  RefreshCw,
  UserRoundCheck,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AdminUser, DepotDetail } from "@/services/admin-service";

interface DepotsTabProps {
  depotsData: { peliyagoda: DepotDetail; kandy: DepotDetail } | null;
  users: AdminUser[];
  isLoading: boolean;
  onRefresh: () => void;
  onAssignDispatcher: (depot: "peliyagoda" | "kandy", userId: number | string | null) => Promise<void>;
}

export function DepotsTab({ depotsData, users, isLoading, onRefresh, onAssignDispatcher }: DepotsTabProps) {
  const [activeDepotKey, setActiveDepotKey] = useState<"peliyagoda" | "kandy">("peliyagoda");
  const [activeSubTab, setActiveSubTab] = useState<"vehicles" | "outlets" | "docks">("vehicles");
  const [isSavingDispatcher, setIsSavingDispatcher] = useState(false);
  const [dispatcherError, setDispatcherError] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ type: "success" | "error"; message: string } | null>(null);

  if (isLoading || !depotsData) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-8 bg-slate-200 rounded w-1/3" />
        <div className="h-44 bg-slate-200 rounded-lg" />
        <div className="h-64 bg-slate-200 rounded-lg" />
      </div>
    );
  }

  const currentDepot = depotsData[activeDepotKey];
  const dispatchers = users.filter(
    (user) => user.role.toUpperCase() === "DISPATCHER" && user.is_active,
  );

  const updateDispatcher = async (value: string) => {
    setIsSavingDispatcher(true);
    setDispatcherError(null);
    setNotification(null);
    try {
      const param = value === "unassigned" ? null : (/^\d+$/.test(value) ? Number(value) : value);
      await onAssignDispatcher(activeDepotKey, param);
      const assignedUser = dispatchers.find(
        (d) => String(d.id) === value || d.keycloak_id === value || d.email === value
      );
      setNotification({
        type: "success",
        message: value === "unassigned"
          ? `Cleared dispatcher assignment for ${currentDepot.name}.`
          : `Assigned ${assignedUser?.full_name || "dispatcher"} to ${currentDepot.name}. Workspace scope active immediately.`,
      });
    } catch (error) {
      setDispatcherError(error instanceof Error ? error.message : "Could not update the depot dispatcher.");
    } finally {
      setIsSavingDispatcher(false);
    }
  };


  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Building2 className="size-5 text-primary" />
            <span>Depots &amp; Hub Logistics</span>
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Operational details and asset allocations for the primary Peliyagoda and Kandy distribution centers.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={onRefresh}
          className="text-xs gap-1.5 border-border"
        >
          <RefreshCw className={`size-3.5 ${isLoading ? "animate-spin" : ""}`} />
          <span>Refresh</span>
        </Button>
      </div>

      {/* Depot Selector Tabs */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => setActiveDepotKey("peliyagoda")}
          className={`flex-1 p-4 rounded-xl border text-left transition-all ${
            activeDepotKey === "peliyagoda"
              ? "bg-[#18385F] text-white border-[#18385F] shadow-sm"
              : "bg-white border-border text-foreground hover:border-primary/40"
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="font-extrabold text-sm">Peliyagoda Central Depot</div>
            <Badge
              variant="outline"
              className={
                activeDepotKey === "peliyagoda"
                  ? "bg-white/20 text-white border-white/30"
                  : "bg-blue-50 text-blue-900 border-blue-200"
              }
            >
              Primary Hub
            </Badge>
          </div>
          <div
            className={`text-xs mt-1 ${
              activeDepotKey === "peliyagoda" ? "text-white/80" : "text-muted-foreground"
            }`}
          >
            Western Province &bull; 75 Outlets &bull; {depotsData.peliyagoda.vehicle_count} Vehicles
          </div>
        </button>

        <button
          onClick={() => setActiveDepotKey("kandy")}
          className={`flex-1 p-4 rounded-xl border text-left transition-all ${
            activeDepotKey === "kandy"
              ? "bg-[#18385F] text-white border-[#18385F] shadow-sm"
              : "bg-white border-border text-foreground hover:border-primary/40"
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="font-extrabold text-sm">Kandy Regional Depot</div>
            <Badge
              variant="outline"
              className={
                activeDepotKey === "kandy"
                  ? "bg-white/20 text-white border-white/30"
                  : "bg-purple-50 text-purple-900 border-purple-200"
              }
            >
              Central Hub
            </Badge>
          </div>
          <div
            className={`text-xs mt-1 ${
              activeDepotKey === "kandy" ? "text-white/80" : "text-muted-foreground"
            }`}
          >
            Central Province &bull; 45 Outlets &bull; {depotsData.kandy.vehicle_count} Vehicles
          </div>
        </button>
      </div>

      {/* Active Depot Details Card */}
      <Card className="border-border shadow-xs">
        <CardContent className="p-5 space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border pb-4">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-foreground">{currentDepot.name}</h3>
                <span className="font-mono text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-800 border border-slate-200">
                  {currentDepot.code}
                </span>
              </div>
              <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1.5">
                <MapPin className="size-3.5 text-primary shrink-0" />
                <span>{currentDepot.address}</span>
              </div>
            </div>

            <div className="flex items-center gap-2 text-xs">
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-50 text-emerald-800 border border-emerald-300 font-semibold">
                <CheckCircle2 className="size-3.5" /> Fully Operational
              </span>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-slate-50/70 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <UserRoundCheck className="size-4 text-primary" />
                  <span>Assigned Dispatcher</span>
                  {currentDepot.dispatcher && (
                    <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-800 border-emerald-300 font-semibold">
                      Live
                    </Badge>
                  )}
                </div>
                {currentDepot.dispatcher ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    <strong className="text-foreground">{currentDepot.dispatcher.full_name}</strong> &bull; {currentDepot.dispatcher.email}
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-amber-700 font-medium">No dispatcher assigned. Orders and fleet operations are unmonitored for this hub.</p>
                )}
              </div>

              <div className="flex flex-col sm:items-end gap-1">
                <Select
                  value={
                    currentDepot.dispatcher
                      ? (currentDepot.dispatcher.id != null ? String(currentDepot.dispatcher.id) : (currentDepot.dispatcher.keycloak_id || "unassigned"))
                      : "unassigned"
                  }
                  onValueChange={(value) => void updateDispatcher(value)}
                  disabled={isSavingDispatcher}
                >
                  <SelectTrigger className="w-full bg-card sm:w-80 text-xs" aria-label={`Assigned dispatcher for ${currentDepot.name}`}>
                    <SelectValue placeholder="Choose dispatcher" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unassigned">Unassigned (No Dispatcher)</SelectItem>
                    {dispatchers.map((user) => {
                      const otherDepotKey = activeDepotKey === "peliyagoda" ? "kandy" : "peliyagoda";
                      const otherDepot = depotsData[otherDepotKey];
                      const isAtOther =
                        (user.id != null && otherDepot?.dispatcher?.id === user.id) ||
                        (Boolean(user.keycloak_id) && otherDepot?.dispatcher?.keycloak_id === user.keycloak_id);
                      const isCurrent =
                        (user.id != null && currentDepot.dispatcher?.id === user.id) ||
                        (Boolean(user.keycloak_id) && currentDepot.dispatcher?.keycloak_id === user.keycloak_id);
                      const userVal = user.id != null ? String(user.id) : (user.keycloak_id || user.email);

                      return (
                        <SelectItem key={userVal} value={userVal}>
                          <span className="font-medium">{user.full_name}</span> &bull; {user.email}{" "}
                          {isCurrent
                            ? "✓ (Current)"
                            : isAtOther
                            ? `(Transfer from ${otherDepot.name.split(" ")[0]})`
                            : ""}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
                {isSavingDispatcher && <span className="text-[11px] text-muted-foreground animate-pulse">Syncing assignment...</span>}
              </div>
            </div>
            {dispatcherError && <p role="alert" className="mt-2 text-xs text-destructive">{dispatcherError}</p>}
            {notification && (
              <div
                role="status"
                className={`mt-2.5 p-2 rounded text-xs border ${
                  notification.type === "success"
                    ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                    : "bg-red-50 text-red-800 border-red-200"
                }`}
              >
                {notification.message}
              </div>
            )}
          </div>


          {/* Quick Metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
            <div className="p-3 bg-slate-50 rounded-lg border border-border">
              <div className="text-xl font-extrabold text-foreground">{currentDepot.vehicle_count}</div>
              <div className="text-[11px] text-muted-foreground font-medium mt-0.5">Assigned Vehicles</div>
            </div>
            <div className="p-3 bg-slate-50 rounded-lg border border-border">
              <div className="text-xl font-extrabold text-foreground">{currentDepot.outlet_count}</div>
              <div className="text-[11px] text-muted-foreground font-medium mt-0.5">Assigned Outlets</div>
            </div>
            <div className="p-3 bg-slate-50 rounded-lg border border-border">
              <div className="text-xl font-extrabold text-foreground">{currentDepot.dock_count}</div>
              <div className="text-[11px] text-muted-foreground font-medium mt-0.5">Active Loading Bays</div>
            </div>
            <div className="p-3 bg-slate-50 rounded-lg border border-border">
              <div className="text-xl font-extrabold text-foreground">{currentDepot.tablets.length}</div>
              <div className="text-[11px] text-muted-foreground font-medium mt-0.5">Dock Tablets Online</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Sub-tabs: Vehicles, Outlets, Docks */}
      <Tabs value={activeSubTab} onValueChange={(val) => setActiveSubTab(val as typeof activeSubTab)}>
        <TabsList className="bg-slate-100 p-1 border border-border">
          <TabsTrigger value="vehicles" className="text-xs font-semibold gap-1.5">
            <Truck className="size-3.5" />
            <span>Associated Vehicles ({currentDepot.vehicles.length})</span>
          </TabsTrigger>
          <TabsTrigger value="outlets" className="text-xs font-semibold gap-1.5">
            <Store className="size-3.5" />
            <span>Associated Outlets ({currentDepot.outlets.length})</span>
          </TabsTrigger>
          <TabsTrigger value="docks" className="text-xs font-semibold gap-1.5">
            <Tablet className="size-3.5" />
            <span>Bays &amp; Tablets ({currentDepot.docks.length})</span>
          </TabsTrigger>
        </TabsList>

        {/* 1. Vehicles associated with this depot */}
        <TabsContent value="vehicles" className="mt-4">
          <Card className="border-border shadow-xs overflow-hidden">
            <Table>
              <TableHeader className="bg-slate-50">
                <TableRow>
                  <TableHead className="text-xs font-semibold">Vehicle Code</TableHead>
                  <TableHead className="text-xs font-semibold">Type</TableHead>
                  <TableHead className="text-xs font-semibold">Reefer Capability</TableHead>
                  <TableHead className="text-xs font-semibold">Capacity (kg / m³)</TableHead>
                  <TableHead className="text-xs font-semibold">Fuel Status</TableHead>
                  <TableHead className="text-xs font-semibold">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {currentDepot.vehicles.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-xs text-muted-foreground">
                      No vehicles assigned to this depot.
                    </TableCell>
                  </TableRow>
                ) : (
                  currentDepot.vehicles.map((v) => {
                    const isReefer = v.temperature_mode.toLowerCase() === "reefer";
                    return (
                      <TableRow key={v.id} className="hover:bg-slate-50/60">
                        <TableCell className="font-mono font-bold text-xs text-primary">
                          {v.code}
                        </TableCell>
                        <TableCell className="capitalize text-xs font-medium">{v.vehicle_type}</TableCell>
                        <TableCell>
                          {isReefer ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-blue-50 text-blue-800 border border-blue-200">
                              <Snowflake className="size-3 text-blue-600" />
                              <span>Reefer</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-100 text-slate-700">
                              <Sun className="size-3 text-amber-600" />
                              <span>Ambient</span>
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs font-mono text-muted-foreground">
                          {v.capacity_kg} kg &bull; {v.capacity_vol_m3} m³
                        </TableCell>
                        <TableCell className="text-xs">{v.weekly_fuel_status}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[11px] font-semibold">
                            {v.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        {/* 2. Outlets associated with this depot */}
        <TabsContent value="outlets" className="mt-4">
          <Card className="border-border shadow-xs overflow-hidden">
            <Table>
              <TableHeader className="bg-slate-50">
                <TableRow>
                  <TableHead className="text-xs font-semibold">Outlet Code &amp; Name</TableHead>
                  <TableHead className="text-xs font-semibold">Brand</TableHead>
                  <TableHead className="text-xs font-semibold">District</TableHead>
                  <TableHead className="text-xs font-semibold">Delivery Window</TableHead>
                  <TableHead className="text-xs font-semibold">Dock / Access Type</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {currentDepot.outlets.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-xs text-muted-foreground">
                      No outlets assigned to this depot.
                    </TableCell>
                  </TableRow>
                ) : (
                  currentDepot.outlets.map((o) => (
                    <TableRow key={o.id} className="hover:bg-slate-50/60">
                      <TableCell>
                        <div className="font-mono font-bold text-xs text-primary">{o.code}</div>
                        <div className="font-semibold text-xs text-foreground">{o.name}</div>
                      </TableCell>
                      <TableCell className="text-xs">{o.brand}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{o.district}</TableCell>
                      <TableCell className="text-xs font-mono">
                        {o.window_start || "06:00"} &ndash; {o.window_end || "18:00"}
                      </TableCell>
                      <TableCell>
                        <div className="space-y-0.5">
                          <div className="text-xs capitalize text-foreground">{o.dock_type.replace("_", " ")}</div>
                          {o.van_only && (
                            <Badge className="bg-purple-100 text-purple-900 border-purple-300 text-[10px]">
                              Van Only
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        {/* 3. Bays & Tablets */}
        <TabsContent value="docks" className="mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="border-border shadow-xs">
              <CardHeader className="pb-3 border-b border-border">
                <CardTitle className="text-sm font-semibold">Loading Dock Bays</CardTitle>
                <CardDescription className="text-xs">Physical queue docks for run loading</CardDescription>
              </CardHeader>
              <CardContent className="p-4 space-y-2.5">
                {currentDepot.docks.map((dock) => (
                  <div key={dock.id} className="p-3 rounded-lg border border-border bg-slate-50/50 flex items-center justify-between">
                    <div>
                      <div className="font-semibold text-xs text-foreground">{dock.name}</div>
                      <div className="text-[11px] font-mono text-muted-foreground">{dock.code}</div>
                    </div>
                    <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-800 border-emerald-300">
                      {dock.status}
                    </Badge>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="border-border shadow-xs">
              <CardHeader className="pb-3 border-b border-border">
                <CardTitle className="text-sm font-semibold">Dock Tablet Terminals</CardTitle>
                <CardDescription className="text-xs">Paired barcode scanning terminals</CardDescription>
              </CardHeader>
              <CardContent className="p-4 space-y-2.5">
                {currentDepot.tablets.map((tablet) => (
                  <div key={tablet.id} className="p-3 rounded-lg border border-border bg-slate-50/50 flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <Tablet className="size-4 text-primary" />
                      <span className="font-semibold text-xs text-foreground">{tablet.label}</span>
                    </div>
                    <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-800 border-emerald-300 font-mono">
                      Online &bull; Bound
                    </Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
