"use client";

import React from "react";
import {
  Users,
  Truck,
  Store,
  Building2,
  CheckCircle2,
  RefreshCw,
  ArrowRight,
  ShieldAlert,
  Server,
  Database,
  Lock,
  Calendar,
  Snowflake,
  ShieldCheck,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AdminOverview } from "@/services/admin-service";
import { AdminTab } from "./admin-sidebar";

interface OverviewTabProps {
  data: AdminOverview | null;
  isLoading: boolean;
  onRefresh: () => void;
  onNavigateTab: (tab: AdminTab) => void;
}

export function OverviewTab({ data, isLoading, onRefresh, onNavigateTab }: OverviewTabProps) {
  if (isLoading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-8 bg-slate-200 rounded w-1/3" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 bg-slate-200 rounded-lg" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="h-64 bg-slate-200 rounded-lg lg:col-span-2" />
          <div className="h-64 bg-slate-200 rounded-lg" />
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-8 text-center space-y-3 bg-red-50/60 border border-red-200 rounded-lg">
        <ShieldAlert className="size-8 text-red-500 mx-auto" />
        <h3 className="font-bold text-red-900 text-sm">Unable to load admin metrics</h3>
        <p className="text-xs text-red-700">Could not connect to the backend server. Please verify the API is running.</p>
        <Button variant="outline" size="sm" onClick={onRefresh} className="text-xs">
          <RefreshCw className="size-3.5 mr-1.5" />
          Retry Connection
        </Button>
      </div>
    );
  }

  const {
    total_users,
    active_users,
    users_by_role,
    total_vehicles,
    available_vehicles,
    allocated_vehicles,
    unavailable_vehicles,
    reefer_vehicles,
    ambient_vehicles,
    total_outlets,
    outlets_by_brand,
    outlets_by_depot,
    van_only_outlets,
    depots_summary,
    system_status,
    recent_audits,
  } = data;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <ShieldCheck className="size-5 text-primary" />
            <span>Operational Administration Overview</span>
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Real-time status across personnel, fleet assets, delivery destinations, and system services.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={onRefresh}
          className="gap-2 text-xs font-medium border-border"
        >
          <RefreshCw className={`size-3.5 ${isLoading ? "animate-spin" : ""}`} />
          <span>Refresh Metrics</span>
        </Button>
      </div>

      {/* 4 Primary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Users */}
        <Card className="border-border hover:border-primary/50 transition-colors shadow-xs">
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Total Users
              </span>
              <div className="p-1.5 rounded-md bg-blue-50 text-blue-700">
                <Users className="size-4" />
              </div>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-2xl font-extrabold text-foreground">{total_users}</span>
              <Badge variant="outline" className="text-[11px] bg-emerald-50 text-emerald-800 border-emerald-300">
                {active_users} Active
              </Badge>
            </div>
            <div className="text-[11px] text-muted-foreground border-t border-border/60 pt-2 flex justify-between">
              <span>Drivers: <b>{users_by_role["DRIVER"] || 0}</b></span>
              <span>Loaders: <b>{users_by_role["LOADER"] || 0}</b></span>
              <span>Managers: <b>{users_by_role["STORE_MANAGER"] || 0}</b></span>
            </div>
          </CardContent>
        </Card>

        {/* Fleet Vehicles */}
        <Card className="border-border hover:border-primary/50 transition-colors shadow-xs">
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Fleet Vehicles
              </span>
              <div className="p-1.5 rounded-md bg-slate-100 text-primary">
                <Truck className="size-4" />
              </div>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-2xl font-extrabold text-foreground">{total_vehicles}</span>
              <div className="flex items-center gap-1.5">
                <Badge variant="outline" className="text-[10px] bg-blue-50 text-blue-800 border-blue-200">
                  {allocated_vehicles} Assigned
                </Badge>
                {unavailable_vehicles > 0 && (
                  <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-800 border-amber-300">
                    {unavailable_vehicles} Maint.
                  </Badge>
                )}
              </div>
            </div>
            <div className="text-[11px] text-muted-foreground border-t border-border/60 pt-2 flex items-center justify-between">
              <span className="flex items-center gap-1">
                <Snowflake className="size-3 text-blue-500" /> {reefer_vehicles} Reefer
              </span>
              <span>{ambient_vehicles} Ambient</span>
              <span className="text-emerald-700 font-medium">{available_vehicles} Available</span>
            </div>
          </CardContent>
        </Card>

        {/* Registered Outlets */}
        <Card className="border-border hover:border-primary/50 transition-colors shadow-xs">
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Outlets Served
              </span>
              <div className="p-1.5 rounded-md bg-teal-50 text-teal-800">
                <Store className="size-4" />
              </div>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-2xl font-extrabold text-foreground">{total_outlets}</span>
              <Badge variant="outline" className="text-[10px] bg-purple-50 text-purple-800 border-purple-200">
                {van_only_outlets} Van Only
              </Badge>
            </div>
            <div className="text-[11px] text-muted-foreground border-t border-border/60 pt-2 flex justify-between">
              <span>Fresh: <b>{outlets_by_brand["Fresh"] || 0}</b></span>
              <span>Style: <b>{outlets_by_brand["Style"] || 0}</b></span>
              <span>Tech: <b>{outlets_by_brand["Tech"] || 0}</b></span>
            </div>
          </CardContent>
        </Card>

        {/* Operating Depots */}
        <Card className="border-border hover:border-primary/50 transition-colors shadow-xs">
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Primary Depots
              </span>
              <div className="p-1.5 rounded-md bg-emerald-50 text-emerald-800">
                <Building2 className="size-4" />
              </div>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-2xl font-extrabold text-foreground">2 Depots</span>
              <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-800 border-emerald-300">
                100% Online
              </Badge>
            </div>
            <div className="text-[11px] text-muted-foreground border-t border-border/60 pt-2 flex justify-between">
              <span>Peliyagoda: <b>{outlets_by_depot["peliyagoda"] || 0} stores</b></span>
              <span>Kandy: <b>{outlets_by_depot["kandy"] || 0} stores</b></span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Middle Row: Depots Detailed Summary & System Health Status */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Depots Snapshot (2 cols) */}
        <Card className="border-border lg:col-span-2 shadow-xs">
          <CardHeader className="pb-3 border-b border-border flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Building2 className="size-4 text-primary" />
                <span>Depot Operational Capabilities</span>
              </CardTitle>
              <CardDescription className="text-xs">
                Asset distribution between Peliyagoda and Kandy logistics hubs
              </CardDescription>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onNavigateTab("depots")}
              className="text-xs text-primary gap-1 font-medium"
            >
              <span>View Depots Detail</span>
              <ArrowRight className="size-3.5" />
            </Button>
          </CardHeader>
          <CardContent className="p-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {depots_summary.map((depot) => (
                <div
                  key={depot.key}
                  className="p-3.5 rounded-lg border border-border bg-slate-50/50 space-y-2.5"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-bold text-sm text-foreground">{depot.name}</span>
                      <div className="text-[11px] text-muted-foreground font-mono">{depot.code}</div>
                    </div>
                    <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-800 border-emerald-300 font-semibold">
                      {depot.status}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground leading-snug">
                    {depot.address}
                  </div>
                  <div className="grid grid-cols-3 gap-2 border-t border-border pt-2 text-center text-xs">
                    <div className="bg-white p-1.5 rounded border border-border">
                      <div className="font-bold text-foreground">{depot.vehicle_count}</div>
                      <div className="text-[10px] text-muted-foreground">Vehicles</div>
                    </div>
                    <div className="bg-white p-1.5 rounded border border-border">
                      <div className="font-bold text-foreground">{depot.outlet_count}</div>
                      <div className="text-[10px] text-muted-foreground">Outlets</div>
                    </div>
                    <div className="bg-white p-1.5 rounded border border-border">
                      <div className="font-bold text-foreground">{depot.dock_count}</div>
                      <div className="text-[10px] text-muted-foreground">Bays</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Quick Action Buttons */}
            <div className="border-t border-border pt-3 flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-muted-foreground mr-1">Quick Actions:</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onNavigateTab("users")}
                className="text-xs gap-1.5 border-border bg-white"
              >
                <Users className="size-3.5 text-blue-600" />
                <span>Manage Users</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onNavigateTab("vehicles")}
                className="text-xs gap-1.5 border-border bg-white"
              >
                <Truck className="size-3.5 text-primary" />
                <span>Configure Fleet</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onNavigateTab("outlets")}
                className="text-xs gap-1.5 border-border bg-white"
              >
                <Store className="size-3.5 text-teal-700" />
                <span>Review Outlets</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onNavigateTab("operational-config")}
                className="text-xs gap-1.5 border-border bg-white"
              >
                <Calendar className="size-3.5 text-purple-700" />
                <span>Operating Calendar</span>
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* System & Configuration Health (1 col) */}
        <Card className="border-border shadow-xs flex flex-col justify-between">
          <div>
            <CardHeader className="pb-3 border-b border-border">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Server className="size-4 text-primary" />
                <span>System Connectivity</span>
              </CardTitle>
              <CardDescription className="text-xs">
                Backend services &amp; operational state
              </CardDescription>
            </CardHeader>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Database className="size-3.5 text-teal-700" />
                  <span>PostgreSQL Database</span>
                </span>
                <span className="font-semibold text-emerald-700 flex items-center gap-1">
                  <CheckCircle2 className="size-3" /> Connected
                </span>
              </div>

              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Lock className="size-3.5 text-primary" />
                  <span>Keycloak IAM Realm</span>
                </span>
                <span className="font-semibold text-foreground font-mono text-[11px]">
                  {system_status.keycloak}
                </span>
              </div>

              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Server className="size-3.5 text-blue-600" />
                  <span>FastAPI Engine</span>
                </span>
                <span className="font-semibold text-emerald-700 flex items-center gap-1">
                  <CheckCircle2 className="size-3" /> v1.0.0 Online
                </span>
              </div>

              <div className="border-t border-border pt-3 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Operating Day:</span>
                  <Badge variant="outline" className={system_status.is_operating_day ? "bg-emerald-50 text-emerald-800 border-emerald-300" : "bg-red-50 text-red-800"}>
                    {system_status.is_operating_day ? "Active Dispatches" : "Non-Operating Day"}
                  </Badge>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Festival Demand Multiplier:</span>
                  <span className="font-mono font-bold text-foreground">
                    {system_status.festival_ramp}x
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Monsoon Weather Risk:</span>
                  <span className={`font-semibold ${system_status.monsoon_risk ? "text-amber-800" : "text-muted-foreground"}`}>
                    {system_status.monsoon_risk ? "High Risk Active" : "Normal Conditions"}
                  </span>
                </div>
              </div>
            </CardContent>
          </div>

          <div className="p-3 bg-slate-50 border-t border-border rounded-b-lg">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onNavigateTab("settings")}
              className="w-full text-xs font-semibold text-primary gap-1.5 bg-white border-border"
            >
              <span>Manage Application Settings</span>
              <ArrowRight className="size-3.5" />
            </Button>
          </div>
        </Card>
      </div>

      {/* Bottom Section: Recent Administrative Audit Stream */}
      <Card className="border-border shadow-xs">
        <CardHeader className="pb-3 border-b border-border flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <ShieldAlert className="size-4 text-primary" />
              <span>Recent Administrative Activity</span>
            </CardTitle>
            <CardDescription className="text-xs">
              Logged audit events of user modifications, fleet updates, and configuration adjustments
            </CardDescription>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onNavigateTab("audit")}
            className="text-xs text-primary gap-1 font-medium"
          >
            <span>View Full Audit Log</span>
            <ArrowRight className="size-3.5" />
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-border">
            {recent_audits.length === 0 ? (
              <div className="p-6 text-center text-xs text-muted-foreground">
                No recent administrative events recorded.
              </div>
            ) : (
              recent_audits.slice(0, 4).map((audit) => (
                <div key={audit.id} className="p-4 flex items-start justify-between gap-4 hover:bg-slate-50/50 transition-colors">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge
                        variant="outline"
                        className={`text-[10px] font-mono uppercase ${
                          audit.severity === "CRITICAL"
                            ? "bg-red-50 text-red-800 border-red-300"
                            : audit.severity === "WARNING"
                            ? "bg-amber-50 text-amber-800 border-amber-300"
                            : "bg-blue-50 text-blue-800 border-blue-200"
                        }`}
                      >
                        {audit.action_type}
                      </Badge>
                      <span className="text-xs font-semibold text-foreground">{audit.entity_name}</span>
                      {audit.entity_id && (
                        <span className="text-[11px] font-mono text-muted-foreground">({audit.entity_id})</span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{audit.summary}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[11px] font-medium text-foreground">{audit.actor_name}</div>
                    <div className="text-[10px] text-muted-foreground font-mono">
                      {new Date(audit.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
