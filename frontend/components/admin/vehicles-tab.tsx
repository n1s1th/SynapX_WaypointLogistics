"use client";

import React, { useState } from "react";
import {
  Truck,
  Plus,
  Search,
  Snowflake,
  Sun,
  Edit2,
  RefreshCw,
  Scale,
  Box,
  Download,
  Upload,
  FileSpreadsheet,
  Fuel,
  CheckCircle2,
  AlertCircle,
  FileText,
  UserCheck,
  User,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FleetVehicle, AdminUser, adminService } from "@/services/admin-service";

interface VehiclesTabProps {
  vehicles: FleetVehicle[];
  users?: AdminUser[];
  isLoading: boolean;
  onRefresh: () => void;
}

interface CSVPreviewRow {
  vehicle_id: string;
  type: string;
  temp: string;
  weight_cap_kg: string;
  volume_cap_m3: string;
  fuel_type: string;
  km_per_l: string;
  weekly_fuel_quota_l: string;
  depot: string;
}

export function VehiclesTab({ vehicles, users = [], isLoading, onRefresh }: VehiclesTabProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [depotFilter, setDepotFilter] = useState("ALL");
  const [tempFilter, setTempFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");

  // Filter available drivers
  const drivers = (users || []).filter(
    (u) => u.role === "DRIVER" || u.role_display?.toLowerCase().includes("driver")
  );

  // Driver Assignment State
  const [isAssignDriverOpen, setIsAssignDriverOpen] = useState(false);
  const [assigningVehicle, setAssigningVehicle] = useState<FleetVehicle | null>(null);
  const [selectedDriverUserId, setSelectedDriverUserId] = useState<string>("none");
  const [isSubmittingAssign, setIsSubmittingAssign] = useState(false);
  const [assignError, setAssignError] = useState("");

  // Export State
  const [isExporting, setIsExporting] = useState(false);

  // Import Dialog State
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [importCSVText, setImportCSVText] = useState("");
  const [csvPreviewRows, setCsvPreviewRows] = useState<CSVPreviewRow[]>([]);
  const [isSubmittingImport, setIsSubmittingImport] = useState(false);
  const [importError, setImportError] = useState("");
  const [importResult, setImportResult] = useState<{
    total_rows: number;
    imported: number;
    updated: number;
    errors: string[];
  } | null>(null);

  // Create Dialog
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({
    code: "",
    vehicle_type: "truck",
    depot_name: "peliyagoda",
    temperature_mode: "ambient",
    capacity_kg: 5500,
    capacity_vol_m3: 25,
    fuel_type: "diesel",
    km_per_l: 5.5,
    weekly_fuel_quota_l: 450,
    status: "AVAILABLE" as FleetVehicle["status"],
    assigned_driver_id: undefined as number | undefined,
  });
  const [isSubmittingCreate, setIsSubmittingCreate] = useState(false);
  const [createError, setCreateError] = useState("");

  // Edit Dialog
  const [selectedVehicle, setSelectedVehicle] = useState<FleetVehicle | null>(null);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({
    vehicle_type: "truck",
    depot_name: "peliyagoda",
    temperature_mode: "ambient",
    capacity_kg: 5500,
    capacity_vol_m3: 25,
    fuel_type: "diesel",
    km_per_l: 5.5,
    weekly_fuel_quota_l: 450,
    status: "AVAILABLE" as FleetVehicle["status"],
    maintenance_state: "",
    assigned_driver_id: undefined as number | undefined,
  });
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false);
  const [editError, setEditError] = useState("");

  // Parse CSV Preview helper
  const parseCSVPreview = (text: string) => {
    try {
      const lines = text.trim().split(/\r?\n/).filter((l) => l.trim().length > 0);
      if (lines.length <= 1) {
        setCsvPreviewRows([]);
        return;
      }
      const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
      const preview: CSVPreviewRow[] = [];

      for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(",").map((p) => p.trim());
        const row: Record<string, string> = {};
        headers.forEach((h, idx) => {
          row[h] = parts[idx] || "";
        });

        preview.push({
          vehicle_id: row.vehicle_id || row.code || row.id || parts[0] || "",
          type: row.type || row.vehicle_type || parts[1] || "truck",
          temp: row.temp || row.temperature_mode || parts[2] || "ambient",
          weight_cap_kg: row.weight_cap_kg || row.capacity_kg || parts[3] || "0",
          volume_cap_m3: row.volume_cap_m3 || row.capacity_vol_m3 || parts[4] || "0",
          fuel_type: row.fuel_type || parts[5] || "diesel",
          km_per_l: row.km_per_l || parts[6] || "6.0",
          weekly_fuel_quota_l: row.weekly_fuel_quota_l || parts[7] || "500",
          depot: row.depot || row.depot_name || parts[8] || "Peliyagoda",
        });
      }
      setCsvPreviewRows(preview);
    } catch {
      setCsvPreviewRows([]);
    }
  };

  // Handle File Input for CSV
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportError("");
    setImportResult(null);
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = (event.target?.result as string) || "";
      setImportCSVText(text);
      parseCSVPreview(text);
    };
    reader.onerror = () => setImportError("Failed to read file.");
    reader.readAsText(file);
  };

  // Handle CSV Import Submit
  const handleImportSubmit = async () => {
    if (!importCSVText.trim()) {
      setImportError("Please provide CSV content or select a file.");
      return;
    }

    setImportError("");
    setIsSubmittingImport(true);
    try {
      const res = await adminService.importVehiclesCSV(importCSVText);
      setImportResult(res);
      onRefresh();
    } catch (err: unknown) {
      setImportError(err instanceof Error ? err.message : "Failed to import vehicles");
    } finally {
      setIsSubmittingImport(false);
    }
  };

  // Handle CSV Export
  const handleExportCSV = async () => {
    setIsExporting(true);
    try {
      const csvText = await adminService.exportVehiclesCSV();
      const blob = new Blob([csvText], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `waypoint_fleet_${new Date().toISOString().slice(0, 10)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to export vehicles CSV");
    } finally {
      setIsExporting(false);
    }
  };

  // Filter vehicles
  const filteredVehicles = vehicles.filter((v) => {
    const matchesSearch = v.code.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesType = typeFilter === "ALL" || v.vehicle_type.toLowerCase() === typeFilter.toLowerCase();
    const matchesDepot = depotFilter === "ALL" || v.depot_name.toLowerCase() === depotFilter.toLowerCase();
    const matchesTemp = tempFilter === "ALL" || v.temperature_mode.toLowerCase() === tempFilter.toLowerCase();
    const matchesStatus = statusFilter === "ALL" || v.status === statusFilter;

    return matchesSearch && matchesType && matchesDepot && matchesTemp && matchesStatus;
  });

  // Handle Create Submit
  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError("");
    if (!createForm.code) {
      setCreateError("Vehicle ID/Code is required.");
      return;
    }

    setIsSubmittingCreate(true);
    try {
      await adminService.createVehicle({
        ...createForm,
        code: createForm.code.toUpperCase(),
        capacity_kg: Number(createForm.capacity_kg),
        capacity_vol_m3: Number(createForm.capacity_vol_m3),
        km_per_l: Number(createForm.km_per_l),
        weekly_fuel_quota_l: Number(createForm.weekly_fuel_quota_l),
        assigned_driver_id: createForm.assigned_driver_id ? Number(createForm.assigned_driver_id) : undefined,
      });
      setIsCreateOpen(false);
      setCreateForm({
        code: "",
        vehicle_type: "truck",
        depot_name: "peliyagoda",
        temperature_mode: "ambient",
        capacity_kg: 5500,
        capacity_vol_m3: 25,
        fuel_type: "diesel",
        km_per_l: 5.5,
        weekly_fuel_quota_l: 450,
        status: "AVAILABLE",
        assigned_driver_id: undefined,
      });
      onRefresh();
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : "Creation failed");
    } finally {
      setIsSubmittingCreate(false);
    }
  };

  // Open Edit Modal
  const openEditModal = (vehicle: FleetVehicle) => {
    setSelectedVehicle(vehicle);
    setEditForm({
      vehicle_type: vehicle.vehicle_type,
      depot_name: vehicle.depot_name,
      temperature_mode: vehicle.temperature_mode,
      capacity_kg: vehicle.capacity_kg,
      capacity_vol_m3: vehicle.capacity_vol_m3,
      fuel_type: vehicle.fuel_type || "diesel",
      km_per_l: vehicle.km_per_l ?? 6.0,
      weekly_fuel_quota_l: vehicle.weekly_fuel_quota_l ?? 500,
      status: vehicle.status,
      maintenance_state: vehicle.maintenance_state || "",
      assigned_driver_id: vehicle.assigned_driver_id || undefined,
    });
    setEditError("");
    setIsEditOpen(true);
  };

  // Handle Edit Submit
  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedVehicle) return;
    setEditError("");

    setIsSubmittingEdit(true);
    try {
      await adminService.updateVehicle(selectedVehicle.id, {
        vehicle_type: editForm.vehicle_type,
        depot_name: editForm.depot_name,
        temperature_mode: editForm.temperature_mode,
        capacity_kg: Number(editForm.capacity_kg),
        capacity_vol_m3: Number(editForm.capacity_vol_m3),
        fuel_type: editForm.fuel_type,
        km_per_l: Number(editForm.km_per_l),
        weekly_fuel_quota_l: Number(editForm.weekly_fuel_quota_l),
        status: editForm.status,
        maintenance_state: editForm.maintenance_state ? editForm.maintenance_state : null,
        assigned_driver_id: editForm.assigned_driver_id ? Number(editForm.assigned_driver_id) : null,
      });
      setIsEditOpen(false);
      onRefresh();
    } catch (err: unknown) {
      setEditError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setIsSubmittingEdit(false);
    }
  };

  // Handle Assign Driver Submit
  const handleAssignDriverSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assigningVehicle) return;
    setIsSubmittingAssign(true);
    setAssignError("");
    try {
      const driverUserId = selectedDriverUserId === "none" ? null : Number(selectedDriverUserId);
      await adminService.assignVehicleDriver(assigningVehicle.id, driverUserId);
      setIsAssignDriverOpen(false);
      setAssigningVehicle(null);
      onRefresh();
    } catch (err: unknown) {
      setAssignError(err instanceof Error ? err.message : "Failed to assign driver");
    } finally {
      setIsSubmittingAssign(false);
    }
  };

  const getStatusBadge = (status: FleetVehicle["status"]) => {
    switch (status) {
      case "AVAILABLE":
        return <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300">Available</Badge>;
      case "ALLOCATED":
        return <Badge className="bg-blue-100 text-blue-800 border-blue-300">Allocated</Badge>;
      case "LOADING":
        return <Badge className="bg-amber-100 text-amber-900 border-amber-300">Loading Bay</Badge>;
      case "UNAVAILABLE":
        return <Badge className="bg-red-100 text-red-900 border-red-300">Unavailable</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Truck className="size-5 text-primary" />
            <span>Fleet Vehicles &amp; Asset Management</span>
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Configure vehicle capacities, home depots, temperature capabilities, fuel quotas, and import/export fleet CSV records.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            className="text-xs gap-1.5 border-border"
          >
            <RefreshCw className={`size-3.5 ${isLoading ? "animate-spin" : ""}`} />
            <span>Refresh</span>
          </Button>

          {/* Export CSV Button */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCSV}
            disabled={isExporting}
            className="text-xs gap-1.5 border-border bg-background hover:bg-slate-100"
          >
            <Download className="size-3.5 text-emerald-600" />
            <span>{isExporting ? "Exporting..." : "Export CSV"}</span>
          </Button>

          {/* Import CSV Button */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setImportCSVText("");
              setCsvPreviewRows([]);
              setImportError("");
              setImportResult(null);
              setIsImportOpen(true);
            }}
            className="text-xs gap-1.5 border-primary/30 text-primary bg-primary/5 hover:bg-primary/10"
          >
            <Upload className="size-3.5" />
            <span>Import CSV</span>
          </Button>

          {/* Add Vehicle Button */}
          <Button
            size="sm"
            onClick={() => setIsCreateOpen(true)}
            className="bg-primary text-primary-foreground text-xs gap-1.5 font-semibold"
          >
            <Plus className="size-3.5" />
            <span>Add Vehicle</span>
          </Button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <Card className="border-border shadow-xs">
        <CardContent className="p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
              <Input
                placeholder="Search vehicle code..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 text-xs"
              />
            </div>

            {/* Type Filter */}
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="text-xs">
                <SelectValue placeholder="Vehicle Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Types</SelectItem>
                <SelectItem value="truck">Trucks</SelectItem>
                <SelectItem value="van">Vans</SelectItem>
              </SelectContent>
            </Select>

            {/* Depot Filter */}
            <Select value={depotFilter} onValueChange={setDepotFilter}>
              <SelectTrigger className="text-xs">
                <SelectValue placeholder="Home Depot" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Depots</SelectItem>
                <SelectItem value="peliyagoda">Peliyagoda</SelectItem>
                <SelectItem value="kandy">Kandy</SelectItem>
              </SelectContent>
            </Select>

            {/* Temp Mode */}
            <Select value={tempFilter} onValueChange={setTempFilter}>
              <SelectTrigger className="text-xs">
                <SelectValue placeholder="Refrigeration" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Refrigeration</SelectItem>
                <SelectItem value="reefer">Reefer (Cold-Chain)</SelectItem>
                <SelectItem value="ambient">Ambient Cargo</SelectItem>
              </SelectContent>
            </Select>

            {/* Status Filter */}
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="text-xs">
                <SelectValue placeholder="Availability" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Statuses</SelectItem>
                <SelectItem value="AVAILABLE">Available</SelectItem>
                <SelectItem value="ALLOCATED">Allocated</SelectItem>
                <SelectItem value="LOADING">Loading</SelectItem>
                <SelectItem value="UNAVAILABLE">Unavailable / Maint</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Vehicles Table */}
      <Card className="border-border shadow-xs overflow-hidden">
        <Table>
          <TableHeader className="bg-slate-50">
            <TableRow>
              <TableHead className="text-xs font-semibold">Vehicle Code</TableHead>
              <TableHead className="text-xs font-semibold">Type &amp; Depot</TableHead>
              <TableHead className="text-xs font-semibold">Refrigerated Capability</TableHead>
              <TableHead className="text-xs font-semibold">Weight &amp; Volume</TableHead>
              <TableHead className="text-xs font-semibold">Assigned Driver</TableHead>
              <TableHead className="text-xs font-semibold">Fuel &amp; Efficiency</TableHead>
              <TableHead className="text-xs font-semibold">Availability / Status</TableHead>
              <TableHead className="text-xs font-semibold text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-xs text-muted-foreground">
                  Loading fleet vehicles...
                </TableCell>
              </TableRow>
            ) : filteredVehicles.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-xs text-muted-foreground">
                  No vehicles found matching criteria.
                </TableCell>
              </TableRow>
            ) : (
              filteredVehicles.map((vehicle) => {
                const isReefer = vehicle.temperature_mode.toLowerCase() === "reefer";
                return (
                  <TableRow key={vehicle.id} className="hover:bg-slate-50/60">
                    <TableCell className="py-3 font-mono font-bold text-xs text-foreground">
                      {vehicle.code}
                    </TableCell>
                    <TableCell className="py-3">
                      <div className="text-xs font-semibold capitalize text-foreground">
                        {vehicle.vehicle_type}
                      </div>
                      <div className="text-[11px] text-muted-foreground capitalize">
                        {vehicle.depot_name} Depot
                      </div>
                    </TableCell>
                    <TableCell className="py-3">
                      {isReefer ? (
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-semibold bg-blue-50 text-blue-800 border border-blue-200">
                          <Snowflake className="size-3 text-blue-600" />
                          <span>Reefer (Chilled)</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                          <Sun className="size-3 text-amber-600" />
                          <span>Ambient Cargo</span>
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="py-3">
                      <div className="text-xs font-medium text-foreground flex items-center gap-2">
                        <span className="flex items-center gap-1">
                          <Scale className="size-3 text-muted-foreground" />
                          {vehicle.capacity_kg?.toLocaleString()} kg
                        </span>
                        <span className="text-muted-foreground">&bull;</span>
                        <span className="flex items-center gap-1">
                          <Box className="size-3 text-muted-foreground" />
                          {vehicle.capacity_vol_m3} m³
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="py-3">
                      {vehicle.assigned_driver_name ? (
                        <div className="flex items-center gap-2">
                          <div className="h-7 w-7 rounded-full bg-emerald-100 text-emerald-800 flex items-center justify-center font-bold text-xs shrink-0">
                            {vehicle.assigned_driver_name.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div className="text-xs font-semibold text-foreground flex items-center gap-1">
                              <span>{vehicle.assigned_driver_name}</span>
                            </div>
                            <div className="text-[11px] text-muted-foreground">
                              {vehicle.assigned_driver_phone || "Driver"}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setAssigningVehicle(vehicle);
                            setSelectedDriverUserId("none");
                            setAssignError("");
                            setIsAssignDriverOpen(true);
                          }}
                          className="h-6 px-2 text-[11px] text-muted-foreground border-dashed hover:text-primary hover:border-primary"
                        >
                          <Plus className="size-3 mr-1" />
                          <span>Assign Driver</span>
                        </Button>
                      )}
                    </TableCell>
                    <TableCell className="py-3">
                      <div className="text-xs text-foreground flex flex-col gap-0.5">
                        <span className="font-medium flex items-center gap-1">
                          <Fuel className="size-3 text-emerald-600" />
                          <span className="capitalize">{vehicle.fuel_type || "diesel"}</span>
                          <span className="text-muted-foreground">&bull;</span>
                          <span>{vehicle.km_per_l ?? 6.0} km/L</span>
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          Quota: {vehicle.weekly_fuel_quota_l ?? 500} L / wk
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="py-3">
                      <div className="space-y-1">
                        {getStatusBadge(vehicle.status)}
                        {vehicle.maintenance_state && (
                          <div className="text-[10px] text-amber-700 font-medium">
                            &bull; {vehicle.maintenance_state}
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="py-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setAssigningVehicle(vehicle);
                            setSelectedDriverUserId(vehicle.assigned_driver_id ? String(vehicle.assigned_driver_id) : "none");
                            setAssignError("");
                            setIsAssignDriverOpen(true);
                          }}
                          className="text-xs gap-1 h-7 text-emerald-700 hover:bg-emerald-50"
                          title="Assign Driver"
                        >
                          <UserCheck className="size-3" />
                          <span className="hidden xl:inline">Driver</span>
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEditModal(vehicle)}
                          className="text-xs gap-1 h-7 text-primary hover:bg-slate-100"
                        >
                          <Edit2 className="size-3" />
                          <span>Edit</span>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </Card>

      {/* CSV Import Dialog */}
      <Dialog open={isImportOpen} onOpenChange={setIsImportOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center gap-2">
              <FileSpreadsheet className="size-4 text-primary" />
              <span>Import Fleet Vehicles CSV</span>
            </DialogTitle>
            <DialogDescription className="text-xs">
              Upload or paste vehicle fleet specifications. Existing vehicles matching the vehicle ID will be updated; new ones will be added.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {importError && (
              <div className="p-3 rounded text-xs bg-red-50 text-red-800 border border-red-200 flex items-center gap-2">
                <AlertCircle className="size-4 text-red-600 shrink-0" />
                <span>{importError}</span>
              </div>
            )}

            {importResult && (
              <div className="p-3 rounded text-xs bg-emerald-50 text-emerald-800 border border-emerald-200 space-y-1">
                <div className="flex items-center gap-2 font-semibold">
                  <CheckCircle2 className="size-4 text-emerald-600 shrink-0" />
                  <span>
                    Successfully processed {importResult.total_rows} vehicles ({importResult.imported} newly created, {importResult.updated} updated)
                  </span>
                </div>
                {importResult.errors.length > 0 && (
                  <div className="text-[11px] text-amber-700 mt-2">
                    <span className="font-semibold">Notices / Warnings:</span>
                    <ul className="list-disc pl-4 mt-0.5 space-y-0.5">
                      {importResult.errors.slice(0, 5).map((e, idx) => (
                        <li key={idx}>{e}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            <div className="p-2.5 rounded bg-slate-50 border border-slate-200 text-[11px] text-muted-foreground">
              <span className="font-semibold text-foreground">Expected CSV Column Header:</span>
              <p className="font-mono text-[10px] mt-0.5 text-slate-700 break-all">
                vehicle_id,type,temp,weight_cap_kg,volume_cap_m3,fuel_type,km_per_l,weekly_fuel_quota_l,depot
              </p>
            </div>

            <Tabs defaultValue="file" className="w-full">
              <TabsList className="grid grid-cols-2 text-xs">
                <TabsTrigger value="file" className="text-xs gap-1.5">
                  <Upload className="size-3.5" />
                  <span>Upload File</span>
                </TabsTrigger>
                <TabsTrigger value="paste" className="text-xs gap-1.5">
                  <FileText className="size-3.5" />
                  <span>Paste Raw CSV</span>
                </TabsTrigger>
              </TabsList>

              {/* File Upload Tab */}
              <TabsContent value="file" className="space-y-3 pt-2">
                <div className="border-2 border-dashed border-border rounded-lg p-6 text-center hover:bg-slate-50/50 transition">
                  <FileSpreadsheet className="size-8 text-muted-foreground mx-auto mb-2" />
                  <p className="text-xs font-medium text-foreground">Select a .csv file from your computer</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Comma-separated values (.csv) format</p>
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    onChange={handleFileUpload}
                    className="mt-3 text-xs file:mr-3 file:py-1 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-primary file:text-primary-foreground hover:file:opacity-90 cursor-pointer"
                  />
                </div>
              </TabsContent>

              {/* Paste Raw CSV Tab */}
              <TabsContent value="paste" className="space-y-3 pt-2">
                <Textarea
                  placeholder={`vehicle_id,type,temp,weight_cap_kg,volume_cap_m3,fuel_type,km_per_l,weekly_fuel_quota_l,depot\nVEH001,truck,reefer,5510,26.4,diesel,4.7,340,Peliyagoda`}
                  rows={6}
                  value={importCSVText}
                  onChange={(e) => {
                    setImportCSVText(e.target.value);
                    parseCSVPreview(e.target.value);
                  }}
                  className="font-mono text-xs"
                />
              </TabsContent>
            </Tabs>

            {/* Parsed Preview Table */}
            {csvPreviewRows.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-foreground">
                    Preview ({csvPreviewRows.length} vehicles detected)
                  </span>
                  <span className="text-muted-foreground text-[11px]">
                    Showing top {Math.min(csvPreviewRows.length, 5)} rows
                  </span>
                </div>
                <div className="border border-border rounded-md overflow-x-auto max-h-48">
                  <Table className="text-[11px]">
                    <TableHeader className="bg-slate-50 sticky top-0">
                      <TableRow>
                        <TableHead className="py-1 px-2 font-mono">ID</TableHead>
                        <TableHead className="py-1 px-2">Type</TableHead>
                        <TableHead className="py-1 px-2">Temp</TableHead>
                        <TableHead className="py-1 px-2">Weight</TableHead>
                        <TableHead className="py-1 px-2">Vol</TableHead>
                        <TableHead className="py-1 px-2">Fuel</TableHead>
                        <TableHead className="py-1 px-2">km/L</TableHead>
                        <TableHead className="py-1 px-2">Quota</TableHead>
                        <TableHead className="py-1 px-2">Depot</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {csvPreviewRows.slice(0, 5).map((row, idx) => (
                        <TableRow key={idx}>
                          <TableCell className="py-1.5 px-2 font-mono font-bold">{row.vehicle_id}</TableCell>
                          <TableCell className="py-1.5 px-2 capitalize">{row.type}</TableCell>
                          <TableCell className="py-1.5 px-2 capitalize">{row.temp}</TableCell>
                          <TableCell className="py-1.5 px-2 font-mono">{row.weight_cap_kg} kg</TableCell>
                          <TableCell className="py-1.5 px-2 font-mono">{row.volume_cap_m3} m³</TableCell>
                          <TableCell className="py-1.5 px-2 capitalize">{row.fuel_type}</TableCell>
                          <TableCell className="py-1.5 px-2 font-mono">{row.km_per_l}</TableCell>
                          <TableCell className="py-1.5 px-2 font-mono">{row.weekly_fuel_quota_l} L</TableCell>
                          <TableCell className="py-1.5 px-2 capitalize">{row.depot}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsImportOpen(false)}
              className="text-xs"
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={isSubmittingImport || !importCSVText.trim()}
              onClick={handleImportSubmit}
              className="bg-primary text-primary-foreground text-xs font-semibold gap-1.5"
            >
              <Upload className="size-3.5" />
              <span>{isSubmittingImport ? "Importing Fleet..." : `Import ${csvPreviewRows.length || ""} Vehicles`}</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Vehicle Dialog */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center gap-2">
              <Truck className="size-4 text-primary" />
              <span>Register New Vehicle</span>
            </DialogTitle>
            <DialogDescription className="text-xs">
              Add a new logistics asset to the fleet inventory.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateSubmit} className="space-y-4 py-2">
            {createError && (
              <div className="p-2.5 rounded text-xs bg-red-50 text-red-800 border border-red-200">
                {createError}
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-xs">Vehicle Code / Plate ID</Label>
              <Input
                className="text-xs font-mono uppercase"
                placeholder="e.g. VEH060"
                value={createForm.code}
                onChange={(e) => setCreateForm({ ...createForm, code: e.target.value })}
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Vehicle Type</Label>
                <Select
                  value={createForm.vehicle_type}
                  onValueChange={(val) => setCreateForm({ ...createForm, vehicle_type: val })}
                >
                  <SelectTrigger className="text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="truck">Truck</SelectItem>
                    <SelectItem value="van">Van</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Home Depot</Label>
                <Select
                  value={createForm.depot_name}
                  onValueChange={(val) => setCreateForm({ ...createForm, depot_name: val })}
                >
                  <SelectTrigger className="text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="peliyagoda">Peliyagoda</SelectItem>
                    <SelectItem value="kandy">Kandy</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Temperature Capability</Label>
              <Select
                value={createForm.temperature_mode}
                onValueChange={(val) => setCreateForm({ ...createForm, temperature_mode: val })}
              >
                <SelectTrigger className="text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ambient">Ambient (Dry Cargo)</SelectItem>
                  <SelectItem value="reefer">Reefer (Cold Chain Refrigerated)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Weight Capacity (kg)</Label>
                <Input
                  type="number"
                  className="text-xs font-mono"
                  value={createForm.capacity_kg}
                  onChange={(e) => setCreateForm({ ...createForm, capacity_kg: Number(e.target.value) })}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Volume Capacity (m³)</Label>
                <Input
                  type="number"
                  step="0.1"
                  className="text-xs font-mono"
                  value={createForm.capacity_vol_m3}
                  onChange={(e) => setCreateForm({ ...createForm, capacity_vol_m3: Number(e.target.value) })}
                  required
                />
              </div>
            </div>

            {/* Fuel and Efficiency Fields */}
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Fuel Type</Label>
                <Select
                  value={createForm.fuel_type}
                  onValueChange={(val) => setCreateForm({ ...createForm, fuel_type: val })}
                >
                  <SelectTrigger className="text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="diesel">Diesel</SelectItem>
                    <SelectItem value="petrol">Petrol</SelectItem>
                    <SelectItem value="electric">Electric</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">km / L</Label>
                <Input
                  type="number"
                  step="0.1"
                  className="text-xs font-mono"
                  value={createForm.km_per_l}
                  onChange={(e) => setCreateForm({ ...createForm, km_per_l: Number(e.target.value) })}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Weekly Quota (L)</Label>
                <Input
                  type="number"
                  step="1"
                  className="text-xs font-mono"
                  value={createForm.weekly_fuel_quota_l}
                  onChange={(e) => setCreateForm({ ...createForm, weekly_fuel_quota_l: Number(e.target.value) })}
                  required
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Assigned Driver (Optional)</Label>
              <Select
                value={createForm.assigned_driver_id ? String(createForm.assigned_driver_id) : "none"}
                onValueChange={(val) =>
                  setCreateForm({
                    ...createForm,
                    assigned_driver_id: val === "none" ? undefined : Number(val),
                  })
                }
              >
                <SelectTrigger className="text-xs">
                  <SelectValue placeholder="Select Driver..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">
                    <span className="text-muted-foreground italic">No Driver Assigned</span>
                  </SelectItem>
                  {drivers.map((d) => (
                    <SelectItem key={d.id} value={String(d.id)}>
                      {d.full_name} ({d.email})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsCreateOpen(false)}
                className="text-xs"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={isSubmittingCreate}
                className="bg-primary text-primary-foreground text-xs font-semibold"
              >
                {isSubmittingCreate ? "Saving..." : "Add Vehicle"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Vehicle Dialog */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center gap-2">
              <Edit2 className="size-4 text-primary" />
              <span>Edit Vehicle {selectedVehicle?.code}</span>
            </DialogTitle>
            <DialogDescription className="text-xs">
              Update capacity parameters, fuel quotas, assigned depot, and maintenance state.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleEditSubmit} className="space-y-4 py-2">
            {editError && (
              <div className="p-2.5 rounded text-xs bg-red-50 text-red-800 border border-red-200">
                {editError}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Vehicle Type</Label>
                <Select
                  value={editForm.vehicle_type}
                  onValueChange={(val) => setEditForm({ ...editForm, vehicle_type: val })}
                >
                  <SelectTrigger className="text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="truck">Truck</SelectItem>
                    <SelectItem value="van">Van</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Home Depot</Label>
                <Select
                  value={editForm.depot_name}
                  onValueChange={(val) => setEditForm({ ...editForm, depot_name: val })}
                >
                  <SelectTrigger className="text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="peliyagoda">Peliyagoda</SelectItem>
                    <SelectItem value="kandy">Kandy</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Temperature Mode</Label>
                <Select
                  value={editForm.temperature_mode}
                  onValueChange={(val) => setEditForm({ ...editForm, temperature_mode: val })}
                >
                  <SelectTrigger className="text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ambient">Ambient</SelectItem>
                    <SelectItem value="reefer">Reefer</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Status</Label>
                <Select
                  value={editForm.status}
                  onValueChange={(val) => setEditForm({ ...editForm, status: val as FleetVehicle["status"] })}
                >
                  <SelectTrigger className="text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="AVAILABLE">Available</SelectItem>
                    <SelectItem value="ALLOCATED">Allocated</SelectItem>
                    <SelectItem value="LOADING">Loading</SelectItem>
                    <SelectItem value="UNAVAILABLE">Unavailable</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Weight Capacity (kg)</Label>
                <Input
                  type="number"
                  className="text-xs font-mono"
                  value={editForm.capacity_kg}
                  onChange={(e) => setEditForm({ ...editForm, capacity_kg: Number(e.target.value) })}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Volume Capacity (m³)</Label>
                <Input
                  type="number"
                  step="0.1"
                  className="text-xs font-mono"
                  value={editForm.capacity_vol_m3}
                  onChange={(e) => setEditForm({ ...editForm, capacity_vol_m3: Number(e.target.value) })}
                  required
                />
              </div>
            </div>

            {/* Fuel and Efficiency Fields */}
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Fuel Type</Label>
                <Select
                  value={editForm.fuel_type}
                  onValueChange={(val) => setEditForm({ ...editForm, fuel_type: val })}
                >
                  <SelectTrigger className="text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="diesel">Diesel</SelectItem>
                    <SelectItem value="petrol">Petrol</SelectItem>
                    <SelectItem value="electric">Electric</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">km / L</Label>
                <Input
                  type="number"
                  step="0.1"
                  className="text-xs font-mono"
                  value={editForm.km_per_l}
                  onChange={(e) => setEditForm({ ...editForm, km_per_l: Number(e.target.value) })}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Weekly Quota (L)</Label>
                <Input
                  type="number"
                  step="1"
                  className="text-xs font-mono"
                  value={editForm.weekly_fuel_quota_l}
                  onChange={(e) => setEditForm({ ...editForm, weekly_fuel_quota_l: Number(e.target.value) })}
                  required
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Assigned Driver</Label>
              <Select
                value={editForm.assigned_driver_id ? String(editForm.assigned_driver_id) : "none"}
                onValueChange={(val) =>
                  setEditForm({
                    ...editForm,
                    assigned_driver_id: val === "none" ? undefined : Number(val),
                  })
                }
              >
                <SelectTrigger className="text-xs">
                  <SelectValue placeholder="Select Driver..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">
                    <span className="text-muted-foreground italic">No Driver Assigned</span>
                  </SelectItem>
                  {drivers.map((d) => (
                    <SelectItem key={d.id} value={String(d.id)}>
                      {d.full_name} ({d.email})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Maintenance State / Notes</Label>
              <Input
                className="text-xs"
                placeholder="e.g. Under maintenance, Scheduled tire replacement"
                value={editForm.maintenance_state}
                onChange={(e) => setEditForm({ ...editForm, maintenance_state: e.target.value })}
              />
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsEditOpen(false)}
                className="text-xs"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={isSubmittingEdit}
                className="bg-primary text-primary-foreground text-xs font-semibold"
              >
                {isSubmittingEdit ? "Saving..." : "Save Changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Assign Driver Dialog */}
      <Dialog open={isAssignDriverOpen} onOpenChange={setIsAssignDriverOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center gap-2">
              <UserCheck className="size-4 text-emerald-600" />
              <span>Assign Driver to Vehicle {assigningVehicle?.code}</span>
            </DialogTitle>
            <DialogDescription className="text-xs">
              Select an active driver to operate this vehicle. Any previous vehicle assignment for this driver will be automatically updated.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleAssignDriverSubmit} className="space-y-4 py-2">
            {assignError && (
              <div className="p-2.5 rounded text-xs bg-red-50 text-red-800 border border-red-200">
                {assignError}
              </div>
            )}

            <div className="p-3 bg-slate-50 border border-slate-200 rounded-md text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Vehicle:</span>
                <span className="font-mono font-bold text-foreground">{assigningVehicle?.code} ({assigningVehicle?.vehicle_type})</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Depot:</span>
                <span className="capitalize text-foreground">{assigningVehicle?.depot_name} Depot</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Currently Assigned:</span>
                <span className="font-semibold text-foreground">
                  {assigningVehicle?.assigned_driver_name || "None (Unassigned)"}
                </span>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Select Driver</Label>
              <Select
                value={selectedDriverUserId}
                onValueChange={setSelectedDriverUserId}
              >
                <SelectTrigger className="text-xs">
                  <SelectValue placeholder="Choose a driver..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">
                    <span className="text-muted-foreground italic">None (Unassign Driver)</span>
                  </SelectItem>
                  {drivers.map((d) => (
                    <SelectItem key={d.id} value={String(d.id)}>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{d.full_name}</span>
                        <span className="text-muted-foreground text-[11px]">({d.email})</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsAssignDriverOpen(false)}
                className="text-xs"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={isSubmittingAssign}
                className="bg-primary text-primary-foreground text-xs font-semibold gap-1.5"
              >
                <UserCheck className="size-3.5" />
                <span>{isSubmittingAssign ? "Saving..." : "Confirm Assignment"}</span>
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
