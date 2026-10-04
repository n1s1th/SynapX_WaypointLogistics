"use client";

import React, { useState } from "react";
import {
  Sliders,
  Clock,
  Calendar,
  ShieldAlert,
  CheckCircle2,
  Save,
  RefreshCw,
  Edit2,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  OperationalConfigData,
  CalendarDayItem,
  adminService,
} from "@/services/admin-service";

interface OperationalConfigTabProps {
  config: OperationalConfigData | null;
  calendarDays: CalendarDayItem[];
  isLoading: boolean;
  onRefresh: () => void;
}

export function OperationalConfigTab({
  config,
  calendarDays,
  isLoading,
  onRefresh,
}: OperationalConfigTabProps) {
  // Operational Config Form State
  const [formConfig, setFormConfig] = useState<OperationalConfigData | null>(config);
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [configSuccessMsg, setConfigSuccessMsg] = useState("");

  // Calendar Day Edit Dialog
  const [editingDay, setEditingDay] = useState<CalendarDayItem | null>(null);
  const [dayForm, setDayForm] = useState({
    is_operating: true,
    festival_ramp: 1.0,
    monsoon: false,
    holiday_name: "",
  });
  const [isSavingDay, setIsSavingDay] = useState(false);

  const [prevConfig, setPrevConfig] = useState(config);
  if (config !== prevConfig) {
    setPrevConfig(config);
    setFormConfig(config);
  }

  const handleSaveOperationalConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formConfig) return;

    setIsSavingConfig(true);
    setConfigSuccessMsg("");
    try {
      await adminService.updateOperationalConfig(formConfig);
      setConfigSuccessMsg("Operational configuration saved successfully!");
      setTimeout(() => setConfigSuccessMsg(""), 3500);
      onRefresh();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to update configuration");
    } finally {
      setIsSavingConfig(false);
    }
  };

  const openEditDayModal = (day: CalendarDayItem) => {
    setEditingDay(day);
    setDayForm({
      is_operating: day.is_operating,
      festival_ramp: day.festival_ramp,
      monsoon: day.monsoon,
      holiday_name: day.holiday_name || "",
    });
  };

  const handleSaveDay = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingDay) return;

    setIsSavingDay(true);
    try {
      await adminService.updateCalendarDay(editingDay.date, {
        is_operating: dayForm.is_operating,
        festival_ramp: Number(dayForm.festival_ramp),
        monsoon: dayForm.monsoon,
        holiday_name: dayForm.holiday_name ? dayForm.holiday_name : null,
      });
      setEditingDay(null);
      onRefresh();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to update operating day");
    } finally {
      setIsSavingDay(false);
    }
  };

  if (!formConfig) {
    return (
      <div className="py-12 text-center text-xs text-muted-foreground">
        Loading operational configuration...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Sliders className="size-5 text-primary" />
            <span>Operational &amp; Dispatch Configuration</span>
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Configure system delivery windows, trip safety constraints, and the operating calendar schedule.
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

      {configSuccessMsg && (
        <div className="p-3 rounded-lg bg-emerald-50 text-emerald-900 border border-emerald-300 flex items-center gap-2 text-xs font-semibold">
          <CheckCircle2 className="size-4 text-emerald-700" />
          <span>{configSuccessMsg}</span>
        </div>
      )}

      {/* Form for Delivery Windows & Constraints */}
      <form onSubmit={handleSaveOperationalConfig} className="space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* 1. Delivery Windows */}
          <Card className="border-border shadow-xs">
            <CardHeader className="pb-3 border-b border-border">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Clock className="size-4 text-primary" />
                <span>Delivery Windows Configuration</span>
              </CardTitle>
              <CardDescription className="text-xs">
                Standard delivery timeframes and dispatch cutoff schedules
              </CardDescription>
            </CardHeader>
            <CardContent className="p-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Standard Start Time</Label>
                  <Input
                    type="time"
                    className="text-xs font-mono"
                    value={formConfig.delivery_windows.standard_start}
                    onChange={(e) =>
                      setFormConfig({
                        ...formConfig,
                        delivery_windows: {
                          ...formConfig.delivery_windows,
                          standard_start: e.target.value,
                        },
                      })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Standard End Time</Label>
                  <Input
                    type="time"
                    className="text-xs font-mono"
                    value={formConfig.delivery_windows.standard_end}
                    onChange={(e) =>
                      setFormConfig({
                        ...formConfig,
                        delivery_windows: {
                          ...formConfig.delivery_windows,
                          standard_end: e.target.value,
                        },
                      })
                    }
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Morning Window (06:00 - 12:00)</Label>
                  <Input
                    type="time"
                    className="text-xs font-mono"
                    value={formConfig.delivery_windows.morning_end}
                    onChange={(e) =>
                      setFormConfig({
                        ...formConfig,
                        delivery_windows: {
                          ...formConfig.delivery_windows,
                          morning_end: e.target.value,
                        },
                      })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Afternoon Window (12:00 - 18:00)</Label>
                  <Input
                    type="time"
                    className="text-xs font-mono"
                    value={formConfig.delivery_windows.afternoon_end}
                    onChange={(e) =>
                      setFormConfig({
                        ...formConfig,
                        delivery_windows: {
                          ...formConfig.delivery_windows,
                          afternoon_end: e.target.value,
                        },
                      })
                    }
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 border-t border-border pt-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Order Cutoff Time (Prev Day)</Label>
                  <Input
                    type="time"
                    className="text-xs font-mono"
                    value={formConfig.delivery_windows.order_cutoff_time}
                    onChange={(e) =>
                      setFormConfig({
                        ...formConfig,
                        delivery_windows: {
                          ...formConfig.delivery_windows,
                          order_cutoff_time: e.target.value,
                        },
                      })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Arrival Delay Buffer (mins)</Label>
                  <Input
                    type="number"
                    className="text-xs font-mono"
                    value={formConfig.delivery_windows.arrival_buffer_mins}
                    onChange={(e) =>
                      setFormConfig({
                        ...formConfig,
                        delivery_windows: {
                          ...formConfig.delivery_windows,
                          arrival_buffer_mins: Number(e.target.value),
                        },
                      })
                    }
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 2. Vehicle & Trip Constraints */}
          <Card className="border-border shadow-xs">
            <CardHeader className="pb-3 border-b border-border">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <ShieldAlert className="size-4 text-primary" />
                <span>Vehicle &amp; Trip Constraints</span>
              </CardTitle>
              <CardDescription className="text-xs">
                Safety thresholds, stop maximums, and cold-chain compliance
              </CardDescription>
            </CardHeader>
            <CardContent className="p-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Max Stops Per Trip</Label>
                  <Input
                    type="number"
                    className="text-xs font-mono"
                    value={formConfig.trip_constraints.max_stops_per_trip}
                    onChange={(e) =>
                      setFormConfig({
                        ...formConfig,
                        trip_constraints: {
                          ...formConfig.trip_constraints,
                          max_stops_per_trip: Number(e.target.value),
                        },
                      })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Max Driver Hours / Day</Label>
                  <Input
                    type="number"
                    step="0.5"
                    className="text-xs font-mono"
                    value={formConfig.trip_constraints.max_driving_hours_per_day}
                    onChange={(e) =>
                      setFormConfig({
                        ...formConfig,
                        trip_constraints: {
                          ...formConfig.trip_constraints,
                          max_driving_hours_per_day: Number(e.target.value),
                        },
                      })
                    }
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Weight Warning Alert (%)</Label>
                  <Input
                    type="number"
                    className="text-xs font-mono"
                    value={formConfig.trip_constraints.weight_capacity_alert_pct}
                    onChange={(e) =>
                      setFormConfig({
                        ...formConfig,
                        trip_constraints: {
                          ...formConfig.trip_constraints,
                          weight_capacity_alert_pct: Number(e.target.value),
                        },
                      })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Volume Warning Alert (%)</Label>
                  <Input
                    type="number"
                    className="text-xs font-mono"
                    value={formConfig.trip_constraints.volume_capacity_alert_pct}
                    onChange={(e) =>
                      setFormConfig({
                        ...formConfig,
                        trip_constraints: {
                          ...formConfig.trip_constraints,
                          volume_capacity_alert_pct: Number(e.target.value),
                        },
                      })
                    }
                  />
                </div>
              </div>

              <div className="border-t border-border pt-3 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-xs font-semibold">Strict Reefer Cold-Chain Rule</Label>
                    <p className="text-[11px] text-muted-foreground">Chilled fresh items may only be allocated to Reefer trucks</p>
                  </div>
                  <Switch
                    checked={formConfig.trip_constraints.strict_reefer_enforcement}
                    onCheckedChange={(checked) =>
                      setFormConfig({
                        ...formConfig,
                        trip_constraints: {
                          ...formConfig.trip_constraints,
                          strict_reefer_enforcement: checked,
                        },
                      })
                    }
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-xs font-semibold">Strict Van-Only Dock Enforcement</Label>
                    <p className="text-[11px] text-muted-foreground">Rejects truck routing for outlets tagged as van_only</p>
                  </div>
                  <Switch
                    checked={formConfig.trip_constraints.strict_van_only_enforcement}
                    onCheckedChange={(checked) =>
                      setFormConfig({
                        ...formConfig,
                        trip_constraints: {
                          ...formConfig.trip_constraints,
                          strict_van_only_enforcement: checked,
                        },
                      })
                    }
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex justify-end">
          <Button
            type="submit"
            disabled={isSavingConfig}
            className="bg-primary text-primary-foreground text-xs gap-1.5 font-semibold px-4"
          >
            <Save className="size-3.5" />
            <span>{isSavingConfig ? "Saving Configuration..." : "Save Operational Configurations"}</span>
          </Button>
        </div>
      </form>

      {/* 3. Operating Calendar Days Schedule */}
      <Card className="border-border shadow-xs">
        <CardHeader className="pb-3 border-b border-border flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Calendar className="size-4 text-primary" />
              <span>Operating Calendar Days</span>
            </CardTitle>
            <CardDescription className="text-xs">
              Manage operating dispatches, festival demand multipliers, and monsoon weather risk flags
            </CardDescription>
          </div>
          <Badge variant="outline" className="text-xs font-mono">
            {calendarDays.length} Days Displayed
          </Badge>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-slate-50">
              <TableRow>
                <TableHead className="text-xs font-semibold">Calendar Date</TableHead>
                <TableHead className="text-xs font-semibold">Dispatch Operations</TableHead>
                <TableHead className="text-xs font-semibold">Demand Ramp Multiplier</TableHead>
                <TableHead className="text-xs font-semibold">Weather / Monsoon</TableHead>
                <TableHead className="text-xs font-semibold">Public / Mercantile Holiday</TableHead>
                <TableHead className="text-xs font-semibold text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {calendarDays.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-xs text-muted-foreground">
                    No operating days found.
                  </TableCell>
                </TableRow>
              ) : (
                calendarDays.slice(0, 15).map((day) => (
                  <TableRow key={day.date} className="hover:bg-slate-50/60">
                    <TableCell className="font-mono text-xs font-bold text-foreground">
                      {day.date}
                    </TableCell>
                    <TableCell>
                      {day.is_operating ? (
                        <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 text-[10px]">
                          Operating Day
                        </Badge>
                      ) : (
                        <Badge className="bg-red-100 text-red-900 border-red-300 text-[10px]">
                          Closed / No Runs
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs font-mono">
                      <span className={day.festival_ramp > 1.0 ? "font-bold text-purple-700" : "text-muted-foreground"}>
                        {day.festival_ramp.toFixed(2)}x
                      </span>
                    </TableCell>
                    <TableCell>
                      {day.monsoon ? (
                        <Badge className="bg-amber-100 text-amber-900 border-amber-300 text-[10px]">
                          Monsoon Active
                        </Badge>
                      ) : (
                        <span className="text-[11px] text-muted-foreground">Normal</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {day.holiday_name || "&mdash;"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEditDayModal(day)}
                        className="text-xs gap-1 h-7 text-primary hover:bg-slate-100"
                      >
                        <Edit2 className="size-3" />
                        <span>Edit</span>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Edit Calendar Day Dialog */}
      <Dialog open={!!editingDay} onOpenChange={(open) => !open && setEditingDay(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center gap-2">
              <Calendar className="size-4 text-primary" />
              <span>Configure Calendar Day ({editingDay?.date})</span>
            </DialogTitle>
            <DialogDescription className="text-xs">
              Update operations status, festival multiplier, and weather alerts for this date.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSaveDay} className="space-y-4 py-2">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div>
                <Label className="text-xs font-semibold">Operational Day</Label>
                <p className="text-[11px] text-muted-foreground">Allow dispatch delivery runs on this day</p>
              </div>
              <Switch
                checked={dayForm.is_operating}
                onCheckedChange={(checked) => setDayForm({ ...dayForm, is_operating: checked })}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Festival Demand Ramp Multiplier</Label>
              <Input
                type="number"
                step="0.05"
                min="0.5"
                max="3.0"
                className="text-xs font-mono"
                value={dayForm.festival_ramp}
                onChange={(e) => setDayForm({ ...dayForm, festival_ramp: Number(e.target.value) })}
                required
              />
              <p className="text-[10px] text-muted-foreground">Baseline is 1.0. High festival demand can reach 1.5x - 2.0x.</p>
            </div>

            <div className="flex items-center justify-between border-b border-border pb-3">
              <div>
                <Label className="text-xs font-semibold">Monsoon Weather Risk</Label>
                <p className="text-[11px] text-muted-foreground">Flag adverse weather risk for transit delays</p>
              </div>
              <Switch
                checked={dayForm.monsoon}
                onCheckedChange={(checked) => setDayForm({ ...dayForm, monsoon: checked })}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Holiday Name (Optional)</Label>
              <Input
                className="text-xs"
                placeholder="e.g. Sinhala &amp; Tamil New Year"
                value={dayForm.holiday_name}
                onChange={(e) => setDayForm({ ...dayForm, holiday_name: e.target.value })}
              />
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setEditingDay(null)}
                className="text-xs"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={isSavingDay}
                className="bg-primary text-primary-foreground text-xs font-semibold"
              >
                {isSavingDay ? "Saving..." : "Update Day"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
