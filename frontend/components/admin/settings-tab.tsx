"use client";

import React, { useState } from "react";
import {
  Settings,
  Lock,
  ExternalLink,
  MapPin,
  Bell,
  Radio,
  Save,
  CheckCircle2,
  RefreshCw,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SystemSettingsPayload, adminService } from "@/services/admin-service";

interface SettingsTabProps {
  settings: SystemSettingsPayload | null;
  isLoading: boolean;
  onRefresh: () => void;
}

export function SettingsTab({ settings, isLoading, onRefresh }: SettingsTabProps) {
  const [formSettings, setFormSettings] = useState<SystemSettingsPayload | null>(settings);
  const [prevSettings, setPrevSettings] = useState(settings);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState("");

  if (settings !== prevSettings) {
    setPrevSettings(settings);
    setFormSettings(settings);
  }

  if (!formSettings) {
    return (
      <div className="py-12 text-center text-xs text-muted-foreground">
        Loading system configuration...
      </div>
    );
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setSaveSuccessMsg("");

    try {
      await adminService.updateSystemSettings(formSettings);
      setSaveSuccessMsg("System application configuration updated successfully!");
      setTimeout(() => setSaveSuccessMsg(""), 3500);
      onRefresh();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to update system settings");
    } finally {
      setIsSaving(false);
    }
  };

  const keycloakAdminConsoleUrl = `${formSettings.keycloak.url}/admin/master/console/#/${formSettings.keycloak.realm}`;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Settings className="size-5 text-primary" />
            <span>System Settings &amp; Infrastructure</span>
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Application-level configuration for Keycloak federation, routing engines, alert channels, and maintenance states.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            className="text-xs gap-1.5 border-border"
          >
            <RefreshCw className={`size-3.5 ${isLoading ? "animate-spin" : ""}`} />
            <span>Refresh</span>
          </Button>
          <Button
            asChild
            size="sm"
            className="bg-[#18385F] text-white text-xs gap-1.5 font-semibold"
          >
            <a href={keycloakAdminConsoleUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="size-3.5" />
              <span>Keycloak IAM Console</span>
            </a>
          </Button>
        </div>
      </div>

      {saveSuccessMsg && (
        <div className="p-3 rounded-lg bg-emerald-50 text-emerald-900 border border-emerald-300 flex items-center gap-2 text-xs font-semibold">
          <CheckCircle2 className="size-4 text-emerald-700" />
          <span>{saveSuccessMsg}</span>
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* 1. Keycloak IAM Settings */}
          <Card className="border-border shadow-xs">
            <CardHeader className="pb-3 border-b border-border">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Lock className="size-4 text-primary" />
                <span>Identity &amp; Keycloak SSO (RBAC)</span>
              </CardTitle>
              <CardDescription className="text-xs">
                OIDC identity broker endpoints and session policies
              </CardDescription>
            </CardHeader>
            <CardContent className="p-4 space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Keycloak Server URL</Label>
                <Input
                  className="text-xs font-mono"
                  value={formSettings.keycloak.url}
                  onChange={(e) =>
                    setFormSettings({
                      ...formSettings,
                      keycloak: { ...formSettings.keycloak, url: e.target.value },
                    })
                  }
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Realm Name</Label>
                  <Input
                    className="text-xs font-mono"
                    value={formSettings.keycloak.realm}
                    onChange={(e) =>
                      setFormSettings({
                        ...formSettings,
                        keycloak: { ...formSettings.keycloak, realm: e.target.value },
                      })
                    }
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Client ID</Label>
                  <Input
                    className="text-xs font-mono"
                    value={formSettings.keycloak.client_id}
                    onChange={(e) =>
                      setFormSettings({
                        ...formSettings,
                        keycloak: { ...formSettings.keycloak, client_id: e.target.value },
                      })
                    }
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Token TTL (Minutes)</Label>
                  <Input
                    type="number"
                    className="text-xs font-mono"
                    value={formSettings.keycloak.token_expiry_minutes}
                    onChange={(e) =>
                      setFormSettings({
                        ...formSettings,
                        keycloak: {
                          ...formSettings.keycloak,
                          token_expiry_minutes: Number(e.target.value),
                        },
                      })
                    }
                    required
                  />
                </div>

                <div className="flex items-center justify-between border border-border p-2 rounded-lg bg-slate-50/50 mt-4">
                  <div className="pr-2">
                    <Label className="text-xs font-semibold">Dev Mode</Label>
                    <p className="text-[10px] text-muted-foreground">Bypass strict OIDC</p>
                  </div>
                  <Switch
                    checked={formSettings.keycloak.enable_dev_mode}
                    onCheckedChange={(checked) =>
                      setFormSettings({
                        ...formSettings,
                        keycloak: { ...formSettings.keycloak, enable_dev_mode: checked },
                      })
                    }
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 2. Routing & Mapping Services */}
          <Card className="border-border shadow-xs">
            <CardHeader className="pb-3 border-b border-border">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <MapPin className="size-4 text-primary" />
                <span>Routing &amp; Telemetry Matrix</span>
              </CardTitle>
              <CardDescription className="text-xs">
                Distance matrix engine and geocoding providers
              </CardDescription>
            </CardHeader>
            <CardContent className="p-4 space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Routing Calculation Engine</Label>
                <Select
                  value={formSettings.routing.routing_engine}
                  onValueChange={(val) =>
                    setFormSettings({
                      ...formSettings,
                      routing: { ...formSettings.routing, routing_engine: val },
                    })
                  }
                >
                  <SelectTrigger className="text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="OSRM Matrix (Sri Lanka Network)">
                      OSRM Matrix (Sri Lanka Road Network)
                    </SelectItem>
                    <SelectItem value="GraphHopper Road Routing">
                      GraphHopper Road Routing
                    </SelectItem>
                    <SelectItem value="Direct Haversine Approximation">
                      Direct Haversine Approximation
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Geocoding &amp; Reverse Lookup Provider</Label>
                <Select
                  value={formSettings.routing.geocoding_provider}
                  onValueChange={(val) =>
                    setFormSettings({
                      ...formSettings,
                      routing: { ...formSettings.routing, geocoding_provider: val },
                    })
                  }
                >
                  <SelectTrigger className="text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Nominatim (OpenStreetMap)">
                      Nominatim (OpenStreetMap Free Tier)
                    </SelectItem>
                    <SelectItem value="Google Maps Geocoding API">
                      Google Maps Geocoding API
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-3 border-t border-border pt-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Offline Sync Buffer (Mins)</Label>
                  <Input
                    type="number"
                    className="text-xs font-mono"
                    value={formSettings.routing.offline_sync_interval_mins}
                    onChange={(e) =>
                      setFormSettings({
                        ...formSettings,
                        routing: {
                          ...formSettings.routing,
                          offline_sync_interval_mins: Number(e.target.value),
                        },
                      })
                    }
                  />
                </div>

                <div className="flex items-center justify-between border border-border p-2 rounded-lg bg-slate-50/50 mt-4">
                  <div className="pr-2">
                    <Label className="text-xs font-semibold">Auto-Reroute</Label>
                    <p className="text-[10px] text-muted-foreground">Adjust on traffic</p>
                  </div>
                  <Switch
                    checked={formSettings.routing.auto_reroute_on_traffic}
                    onCheckedChange={(checked) =>
                      setFormSettings({
                        ...formSettings,
                        routing: {
                          ...formSettings.routing,
                          auto_reroute_on_traffic: checked,
                        },
                      })
                    }
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 3. Notification & Alert Channels */}
          <Card className="border-border shadow-xs">
            <CardHeader className="pb-3 border-b border-border">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Bell className="size-4 text-primary" />
                <span>Alerts &amp; Operational Notifications</span>
              </CardTitle>
              <CardDescription className="text-xs">
                Broadcast triggers for dispatch exceptions and driver emergency alerts
              </CardDescription>
            </CardHeader>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between border-b border-border pb-2.5">
                <div>
                  <Label className="text-xs font-semibold">Email Alerts for Critical Exceptions</Label>
                  <p className="text-[11px] text-muted-foreground">Dispatches, route shortfalls, and cargo rejections</p>
                </div>
                <Switch
                  checked={formSettings.alerts.email_alerts_issues}
                  onCheckedChange={(checked) =>
                    setFormSettings({
                      ...formSettings,
                      alerts: { ...formSettings.alerts, email_alerts_issues: checked },
                    })
                  }
                />
              </div>

              <div className="flex items-center justify-between border-b border-border pb-2.5">
                <div>
                  <Label className="text-xs font-semibold">SMS Priority Alerts</Label>
                  <p className="text-[11px] text-muted-foreground">High-priority delivery window delays dispatched to Store Managers</p>
                </div>
                <Switch
                  checked={formSettings.alerts.sms_alerts_priority}
                  onCheckedChange={(checked) =>
                    setFormSettings({
                      ...formSettings,
                      alerts: { ...formSettings.alerts, sms_alerts_priority: checked },
                    })
                  }
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-xs font-semibold">Driver SOS Alert Dispatch</Label>
                  <p className="text-[11px] text-muted-foreground">Immediate escalation to central dispatch when driver triggers SOS</p>
                </div>
                <Switch
                  checked={formSettings.alerts.driver_sos_instant_alert}
                  onCheckedChange={(checked) =>
                    setFormSettings({
                      ...formSettings,
                      alerts: { ...formSettings.alerts, driver_sos_instant_alert: checked },
                    })
                  }
                />
              </div>
            </CardContent>
          </Card>

          {/* 4. Maintenance & System Broadcast */}
          <Card className="border-border shadow-xs">
            <CardHeader className="pb-3 border-b border-border">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Radio className="size-4 text-primary" />
                <span>System Broadcast &amp; Maintenance</span>
              </CardTitle>
              <CardDescription className="text-xs">
                Announcements and planned downtime maintenance mode
              </CardDescription>
            </CardHeader>
            <CardContent className="p-4 space-y-4">
              <div className="flex items-center justify-between border-b border-border pb-3">
                <div>
                  <Label className="text-xs font-semibold">System Maintenance Mode</Label>
                  <p className="text-[11px] text-muted-foreground">Blocks all write operations across portals</p>
                </div>
                <Switch
                  checked={formSettings.maintenance.maintenance_mode}
                  onCheckedChange={(checked) =>
                    setFormSettings({
                      ...formSettings,
                      maintenance: {
                        ...formSettings.maintenance,
                        maintenance_mode: checked,
                      },
                    })
                  }
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-xs font-semibold">Display System Banner</Label>
                  <p className="text-[11px] text-muted-foreground">Broadcast an alert banner across all role workspaces</p>
                </div>
                <Switch
                  checked={formSettings.maintenance.system_banner_active}
                  onCheckedChange={(checked) =>
                    setFormSettings({
                      ...formSettings,
                      maintenance: {
                        ...formSettings.maintenance,
                        system_banner_active: checked,
                      },
                    })
                  }
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Banner Announcement Message</Label>
                <Input
                  className="text-xs"
                  value={formSettings.maintenance.banner_message}
                  onChange={(e) =>
                    setFormSettings({
                      ...formSettings,
                      maintenance: {
                        ...formSettings.maintenance,
                        banner_message: e.target.value,
                      },
                    })
                  }
                />
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex justify-end">
          <Button
            type="submit"
            disabled={isSaving}
            className="bg-primary text-primary-foreground text-xs gap-1.5 font-semibold px-4"
          >
            <Save className="size-3.5" />
            <span>{isSaving ? "Saving Settings..." : "Save System Settings"}</span>
          </Button>
        </div>
      </form>
    </div>
  );
}
