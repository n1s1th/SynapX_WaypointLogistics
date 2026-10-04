"use client";

import React, { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  RefreshCw,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

import { AdminSidebar, AdminTab } from "@/components/admin/admin-sidebar";
import { OverviewTab } from "@/components/admin/overview-tab";
import { UsersTab } from "@/components/admin/users-tab";
import { RolesTab } from "@/components/admin/roles-tab";
import { VehiclesTab } from "@/components/admin/vehicles-tab";
import { OutletsTab } from "@/components/admin/outlets-tab";
import { DepotsTab } from "@/components/admin/depots-tab";
import { OperationalConfigTab } from "@/components/admin/operational-config-tab";
import { AuditTab } from "@/components/admin/audit-tab";
import { SettingsTab } from "@/components/admin/settings-tab";

import {
  adminService,
  AdminOverview,
  AdminUser,
  RoleDetail,
  FleetVehicle,
  OutletRecord,
  DepotDetail,
  OperationalConfigData,
  CalendarDayItem,
  AuditLog,
  SystemSettingsPayload,
} from "@/services/admin-service";

function AdminDashboardContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  // Read initial tab from URL or default to overview
  const initialTab = (searchParams.get("tab") as AdminTab) || "overview";
  const [currentTab, setCurrentTab] = useState<AdminTab>(initialTab);

  // States for all entities
  const [overviewData, setOverviewData] = useState<AdminOverview | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [roles, setRoles] = useState<RoleDetail[]>([]);
  const [vehicles, setVehicles] = useState<FleetVehicle[]>([]);
  const [outlets, setOutlets] = useState<OutletRecord[]>([]);
  const [depotsData, setDepotsData] = useState<{ peliyagoda: DepotDetail; kandy: DepotDetail } | null>(null);
  const [operationalConfig, setOperationalConfig] = useState<OperationalConfigData | null>(null);
  const [calendarDays, setCalendarDays] = useState<CalendarDayItem[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [systemSettings, setSystemSettings] = useState<SystemSettingsPayload | null>(null);

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  // Sync tab with URL
  const handleTabChange = (newTab: AdminTab) => {
    setCurrentTab(newTab);
    const params = new URLSearchParams(window.location.search);
    params.set("tab", newTab);
    router.replace(`/admin?${params.toString()}`);
  };

  // Fetch all administrative data
  const loadAllData = useCallback(async () => {
    try {
      const [
        overviewRes,
        usersRes,
        rolesRes,
        vehiclesRes,
        outletsRes,
        depotsRes,
        opConfigRes,
        calDaysRes,
        auditLogsRes,
        settingsRes,
      ] = await Promise.allSettled([
        adminService.getOverview(),
        adminService.getUsers(),
        adminService.getRoles(),
        adminService.getVehicles(),
        adminService.getOutlets(),
        adminService.getDepots(),
        adminService.getOperationalConfig(),
        adminService.getCalendarDays(60),
        adminService.getAuditLogs({ limit: 100 }),
        adminService.getSystemSettings(),
      ]);

      if (overviewRes.status === "fulfilled") setOverviewData(overviewRes.value);
      if (usersRes.status === "fulfilled") setUsers(usersRes.value);
      if (rolesRes.status === "fulfilled") setRoles(rolesRes.value);
      if (vehiclesRes.status === "fulfilled") setVehicles(vehiclesRes.value);
      if (outletsRes.status === "fulfilled") setOutlets(outletsRes.value);
      if (depotsRes.status === "fulfilled") setDepotsData(depotsRes.value);
      if (opConfigRes.status === "fulfilled") setOperationalConfig(opConfigRes.value);
      if (calDaysRes.status === "fulfilled") setCalendarDays(calDaysRes.value);
      if (auditLogsRes.status === "fulfilled") setAuditLogs(auditLogsRes.value);
      if (settingsRes.status === "fulfilled") setSystemSettings(settingsRes.value);

      const rejected = [
        overviewRes, usersRes, rolesRes, vehiclesRes, outletsRes,
        depotsRes, opConfigRes, calDaysRes, auditLogsRes, settingsRes
      ].filter((r) => r.status === "rejected");
      if (rejected.length > 0) {
        console.warn(`[AdminDashboard] ${rejected.length} admin requests failed:`, rejected);
      }
    } catch (err) {
      console.error("Failed to load admin data:", err);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  const handleManualRefresh = useCallback(() => {
    setIsRefreshing(true);
    void loadAllData();
  }, [loadAllData]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(async () => {
      if (!active) return;
      await loadAllData();
    });
    return () => {
      active = false;
    };
  }, [loadAllData]);

  // Tab Title helper
  const getTabTitle = (tab: AdminTab) => {
    switch (tab) {
      case "overview":
        return "Overview & KPIs";
      case "users":
        return "Users Directory";
      case "roles":
        return "Roles & Access Control";
      case "vehicles":
        return "Fleet Vehicles";
      case "outlets":
        return "Retail Outlets";
      case "depots":
        return "Depot Hubs";
      case "operational-config":
        return "Operational Configuration";
      case "audit":
        return "Audit & Activity Logs";
      case "settings":
        return "System Settings";
      default:
        return "Administration";
    }
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground font-sans">
      {/* Sleek Left Sidebar */}
      <AdminSidebar
        currentTab={currentTab}
        onTabChange={handleTabChange}
        systemStatus={
          overviewData?.system_status
            ? {
                database: overviewData.system_status.database,
                backend: overviewData.system_status.backend,
              }
            : undefined
        }
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        {/* Top Header */}
        <header className="h-16 shrink-0 border-b border-border bg-card px-6 flex items-center justify-between shadow-xs">
          <div className="flex items-center gap-2 text-xs">
            <span className="font-semibold text-muted-foreground">Admin Console</span>
            <ChevronRight className="size-3 text-muted-foreground/60" />
            <span className="font-bold text-foreground">{getTabTitle(currentTab)}</span>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2 px-2.5 py-1 rounded bg-slate-100 text-xs border border-border">
              <span className="h-2 w-2 rounded-full bg-emerald-600 animate-pulse" />
              <span className="text-muted-foreground">Keycloak Realm:</span>
              <span className="font-mono font-bold text-foreground">waypointlogistics</span>
            </div>

            <Badge variant="outline" className="text-accent border-accent/40 bg-accent/10 font-semibold text-xs">
              Role: System Administrator
            </Badge>

            <Button
              variant="outline"
              size="sm"
              onClick={handleManualRefresh}
              disabled={isRefreshing}
              className="gap-1.5 text-xs font-medium border-border"
            >
              <RefreshCw className={`size-3.5 text-muted-foreground ${isRefreshing ? "animate-spin" : ""}`} />
              <span className="hidden sm:inline">Refresh Data</span>
            </Button>
          </div>
        </header>

        {/* Tab View Content */}
        <main className="flex-1 overflow-y-auto p-6 sm:p-8">
          <div className="max-w-7xl mx-auto">
            {currentTab === "overview" && (
              <OverviewTab
                data={overviewData}
                isLoading={isLoading}
                onRefresh={loadAllData}
                onNavigateTab={handleTabChange}
              />
            )}

            {currentTab === "users" && (
              <UsersTab
                users={users}
                isLoading={isLoading}
                onRefresh={loadAllData}
              />
            )}

            {currentTab === "roles" && (
              <RolesTab
                roles={roles}
                users={users}
                isLoading={isLoading}
                onRefresh={loadAllData}
              />
            )}

            {currentTab === "vehicles" && (
              <VehiclesTab
                vehicles={vehicles}
                users={users}
                isLoading={isLoading}
                onRefresh={loadAllData}
              />
            )}

            {currentTab === "outlets" && (
              <OutletsTab
                outlets={outlets}
                users={users}
                isLoading={isLoading}
                onRefresh={loadAllData}
              />
            )}

            {currentTab === "depots" && (
              <DepotsTab
                depotsData={depotsData}
                users={users}
                isLoading={isLoading}
                onRefresh={loadAllData}
                onAssignDispatcher={async (depot, userId) => {
                  await adminService.assignDepotDispatcher(depot, userId);
                  await loadAllData();
                }}
              />
            )}

            {currentTab === "operational-config" && (
              <OperationalConfigTab
                config={operationalConfig}
                calendarDays={calendarDays}
                isLoading={isLoading}
                onRefresh={loadAllData}
              />
            )}

            {currentTab === "audit" && (
              <AuditTab
                logs={auditLogs}
                isLoading={isLoading}
                onRefresh={loadAllData}
              />
            )}

            {currentTab === "settings" && (
              <SettingsTab
                settings={systemSettings}
                isLoading={isLoading}
                onRefresh={loadAllData}
              />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

export default function AdminDashboardPage() {
  return (
    <Suspense
      fallback={
        <div className="h-screen w-full flex items-center justify-center bg-background text-xs text-muted-foreground">
          Loading Waypoint Logistics Administration Console...
        </div>
      }
    >
      <AdminDashboardContent />
    </Suspense>
  );
}
