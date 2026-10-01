"use client";

import React, { useEffect, useState } from "react";
import { Check, CheckCircle2, RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card } from "@/components/ui/card";
import {
  getOutletSettings,
  updateOutletSettings,
  resetOutletSettings,
} from "@/components/store/api/store-data";
import { mockOutletSettings, type OutletSettings } from "@/components/store/mock-data";

export default function OutletSettingsPage() {
  const [settings, setSettings] = useState<OutletSettings>(mockOutletSettings);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  // Form state
  const [contactPhone, setContactPhone] = useState(mockOutletSettings.contactPhone);
  const [emergencyContact, setEmergencyContact] = useState(mockOutletSettings.emergencyContact);
  const [driverCheckInCall, setDriverCheckInCall] = useState(mockOutletSettings.driverCheckInCall);
  const [shareDockGateCode, setShareDockGateCode] = useState(mockOutletSettings.shareDockGateCode);
  const [emailAlertsIssues, setEmailAlertsIssues] = useState(mockOutletSettings.emailAlertsIssues);
  const [smsAlertsPriority, setSmsAlertsPriority] = useState(mockOutletSettings.smsAlertsPriority);

  useEffect(() => {
    async function load() {
      try {
        const data = await getOutletSettings();
        setSettings(data);
        setContactPhone(data.contactPhone);
        setEmergencyContact(data.emergencyContact);
        setDriverCheckInCall(data.driverCheckInCall);
        setShareDockGateCode(data.shareDockGateCode);
        setEmailAlertsIssues(data.emailAlertsIssues);
        setSmsAlertsPriority(data.smsAlertsPriority);
      } catch (err) {
        console.error("Failed to load outlet settings:", err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function handleSave() {
    setIsSaving(true);
    try {
      const updated = await updateOutletSettings({
        contactPhone,
        emergencyContact,
        driverCheckInCall,
        shareDockGateCode,
        emailAlertsIssues,
        smsAlertsPriority,
      });
      setSettings(updated);
      toast.success("Outlet settings saved successfully", {
        description: "Your updates are now synchronized with Central Dispatch.",
      });
    } catch (err: any) {
      toast.error("Failed to save settings", {
        description: err?.message || "Please check your network and try again.",
      });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleReset() {
    setIsResetting(true);
    try {
      const reset = await resetOutletSettings();
      setSettings(reset);
      setContactPhone(reset.contactPhone);
      setEmergencyContact(reset.emergencyContact);
      setDriverCheckInCall(reset.driverCheckInCall);
      setShareDockGateCode(reset.shareDockGateCode);
      setEmailAlertsIssues(reset.emailAlertsIssues);
      setSmsAlertsPriority(reset.smsAlertsPriority);
      toast.info("Settings restored to defaults");
    } catch (err: any) {
      toast.error("Failed to reset settings", {
        description: err?.message || "Please try again.",
      });
    } finally {
      setIsResetting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6 max-w-5xl mx-auto pb-12">
      {/* Page Header (Desktop / 09 Outlet Settings) */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl md:text-3xl font-bold text-primary">Outlet Settings</h1>
          <p className="text-sm text-muted-foreground">
            <span className="hidden md:inline">
              Outlet details and delivery setup for {settings.outletCode}, shared with central dispatch.
            </span>
            <span className="md:hidden">
              Details and delivery setup shared with central dispatch.
            </span>
          </p>
        </div>
        <div className="hidden md:flex items-center gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={handleReset}
            disabled={isResetting || isSaving}
            className="h-10 px-4 text-sm font-semibold border-border hover:bg-secondary text-foreground"
          >
            <RotateCcw className="size-4 mr-2" />
            Reset
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={isSaving || isResetting}
            className="h-10 px-5 text-sm font-bold bg-primary text-primary-foreground hover:bg-primary/90 shadow-xs"
          >
            <Save className="size-4 mr-2" />
            {isSaving ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </div>

      {/* Sync Status Banner */}
      <div className="bg-emerald-50/80 border border-emerald-200/80 rounded-lg p-3.5 flex items-center gap-3 text-emerald-900 text-sm">
        <div className="size-5 rounded-full bg-emerald-100 flex items-center justify-center shrink-0 text-emerald-700">
          <Check className="size-3.5 stroke-[2.5]" />
        </div>
        <div className="flex flex-wrap items-center gap-x-1.5 font-medium">
          <span className="font-bold text-emerald-950">Settings synced with Central Dispatch</span>
          <span className="text-emerald-800/80">· Last synced {settings.lastSyncedAt || "today at 14:31"}</span>
        </div>
      </div>

      {/* ── Card 1: Outlet Profile ────────────────────────────────────────────── */}
      <Card className="rounded-xl border border-border p-5 md:p-6 bg-card space-y-6 shadow-xs">
        <div className="flex items-center justify-between border-b border-border pb-4">
          <div className="space-y-1">
            <h2 className="text-base md:text-lg font-bold text-primary">Outlet Profile</h2>
            <p className="text-xs md:text-sm text-muted-foreground">Basic outlet identity and contacts</p>
          </div>
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200/60">
            Verified
          </span>
        </div>

        {/* 3-Column Profile Form Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-5">
          <div className="space-y-1.5">
            <Label className="text-xs md:text-sm font-medium text-muted-foreground">Outlet ID</Label>
            <Input
              value={settings.outletCode}
              disabled
              className="bg-muted/40 text-foreground font-medium h-10 cursor-not-allowed"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs md:text-sm font-medium text-muted-foreground">Brand</Label>
            <Input
              value={settings.brand}
              disabled
              className="bg-muted/40 text-foreground font-medium h-10 cursor-not-allowed"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs md:text-sm font-medium text-muted-foreground">District</Label>
            <Input
              value={settings.district}
              disabled
              className="bg-muted/40 text-foreground font-medium h-10 cursor-not-allowed"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs md:text-sm font-medium text-muted-foreground">Serving depot</Label>
            <Input
              value={settings.servingDepot}
              disabled
              className="bg-muted/40 text-foreground font-medium h-10 cursor-not-allowed"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs md:text-sm font-medium text-muted-foreground">Store manager</Label>
            <Input
              value={settings.storeManager}
              placeholder="Not set"
              disabled
              className="bg-muted/40 text-foreground font-medium h-10 cursor-not-allowed"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="contactPhone" className="text-xs md:text-sm font-medium text-foreground">
              Contact phone
            </Label>
            <Input
              id="contactPhone"
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
              placeholder="+94 11 234 5678"
              className="h-10 text-foreground font-medium"
            />
          </div>

          <div className="space-y-1.5 md:col-span-3">
            <Label htmlFor="emergencyContact" className="text-xs md:text-sm font-medium text-foreground">
              Emergency receiving contact
            </Label>
            <Input
              id="emergencyContact"
              value={emergencyContact}
              onChange={(e) => setEmergencyContact(e.target.value)}
              placeholder="Kamal S. (Backroom Lead) · ext 8802"
              className="h-10 text-foreground font-medium"
            />
          </div>
        </div>

        {/* Daily delivery window sub-box */}
        <div className="bg-muted/40 border border-border/80 rounded-lg p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-2">
          <div className="space-y-0.5">
            <span className="text-xs font-medium text-muted-foreground">Daily delivery window</span>
            <div className="text-base md:text-lg font-bold text-primary tracking-tight">
              {settings.windowStart} – {settings.windowEnd}
            </div>
          </div>
          <p className="text-xs text-muted-foreground md:text-right">
            Set by central dispatch · No deliveries on Sundays
          </p>
        </div>
      </Card>

      {/* ── Card 2: Delivery & Unloading ─────────────────────────────────────── */}
      <Card className="rounded-xl border border-border p-5 md:p-6 bg-card space-y-4 shadow-xs">
        <div className="space-y-1 border-b border-border pb-4">
          <h2 className="text-base md:text-lg font-bold text-primary">Delivery &amp; Unloading</h2>
          <p className="text-xs md:text-sm text-muted-foreground">Shared automatically with the depot and drivers</p>
        </div>

        <div className="bg-muted/30 border border-border/60 rounded-xl p-4 md:p-5 grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
          <div className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Dock type</span>
            <p className="text-sm md:text-base font-bold text-foreground">{settings.dockType}</p>
          </div>
          <div className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Vehicle access</span>
            <p className="text-sm md:text-base font-bold text-foreground">{settings.vehicleAccess}</p>
          </div>
          <div className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Parking</span>
            <p className="text-sm md:text-base font-bold text-foreground">{settings.parking}</p>
          </div>
        </div>
      </Card>

      {/* ── Card 3: Access & Notifications ───────────────────────────────────── */}
      <Card className="rounded-xl border border-border p-5 md:p-6 bg-card space-y-4 shadow-xs">
        <div className="space-y-1 border-b border-border pb-4">
          <h2 className="text-base md:text-lg font-bold text-primary">Access &amp; Notifications</h2>
          <p className="text-xs md:text-sm text-muted-foreground">How drivers reach you and how you are alerted</p>
        </div>

        <div className="divide-y divide-border/60">
          <div className="py-3.5 flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <Label htmlFor="driverCheckIn" className="text-sm md:text-base font-bold text-foreground cursor-pointer">
                Driver check-in call
              </Label>
              <p className="text-xs md:text-sm text-muted-foreground">
                Driver calls 15 minutes before arrival
              </p>
            </div>
            <Switch
              id="driverCheckIn"
              checked={driverCheckInCall}
              onCheckedChange={setDriverCheckInCall}
            />
          </div>

          <div className="py-3.5 flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <Label htmlFor="shareDockGate" className="text-sm md:text-base font-bold text-foreground cursor-pointer">
                Share dock gate code
              </Label>
              <p className="text-xs md:text-sm text-muted-foreground">
                Send the gate code to the assigned driver only
              </p>
            </div>
            <Switch
              id="shareDockGate"
              checked={shareDockGateCode}
              onCheckedChange={setShareDockGateCode}
            />
          </div>

          <div className="py-3.5 flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <Label htmlFor="emailAlerts" className="text-sm md:text-base font-bold text-foreground cursor-pointer">
                Email alerts for delivery issues
              </Label>
              <p className="text-xs md:text-sm text-muted-foreground">
                Get an email whenever an issue is logged
              </p>
            </div>
            <Switch
              id="emailAlerts"
              checked={emailAlertsIssues}
              onCheckedChange={setEmailAlertsIssues}
            />
          </div>

          <div className="py-3.5 flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <Label htmlFor="smsAlerts" className="text-sm md:text-base font-bold text-foreground cursor-pointer">
                SMS alerts for high-priority dispatches
              </Label>
              <p className="text-xs md:text-sm text-muted-foreground">
                Text message when a high-priority delivery leaves the depot
              </p>
            </div>
            <Switch
              id="smsAlerts"
              checked={smsAlertsPriority}
              onCheckedChange={setSmsAlertsPriority}
            />
          </div>
        </div>
      </Card>

      {/* Mobile Actions (Sticky / Bottom) */}
      <div className="flex flex-col gap-3 md:hidden pt-2">
        <Button
          type="button"
          onClick={handleSave}
          disabled={isSaving || isResetting}
          className="h-12 w-full text-base font-bold bg-primary text-primary-foreground hover:bg-primary/90"
        >
          {isSaving ? "Saving..." : "Save Changes"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={handleReset}
          disabled={isResetting || isSaving}
          className="h-11 w-full text-sm font-semibold border-border text-foreground"
        >
          <RotateCcw className="size-4 mr-2" />
          Reset Defaults
        </Button>
      </div>
    </div>
  );
}
