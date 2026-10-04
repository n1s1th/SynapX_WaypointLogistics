"use client";

import React, { useState } from "react";
import {
  Store,
  Plus,
  Search,
  Clock,
  MapPin,
  Edit2,
  RefreshCw,
  Download,
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  AlertCircle,
  FileText,
  Warehouse,
  UserCheck,
  User,
  Phone,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TableLoading } from "@/components/ui/table-loading";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { OutletRecord, AdminUser, adminService } from "@/services/admin-service";

interface OutletsTabProps {
  outlets: OutletRecord[];
  users?: AdminUser[];
  isLoading: boolean;
  onRefresh: () => void;
}

interface CSVPreviewRow {
  outlet_id: string;
  brand: string;
  district: string;
  depot: string;
  dock_type: string;
  parking_constraint: string;
  mall_window: string;
  window_open_time: string;
  window_close_time: string;
}

export function OutletsTab({ outlets, users = [], isLoading, onRefresh }: OutletsTabProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [brandFilter, setBrandFilter] = useState("ALL");
  const [depotFilter, setDepotFilter] = useState("ALL");
  const [accessFilter, setAccessFilter] = useState("ALL");

  // Store Managers list from users
  const storeManagers = (users || []).filter(
    (u) =>
      u.role === "WAREHOUSE_MANAGER" ||
      u.role === "STORE_MANAGER" ||
      u.role_display?.toLowerCase().includes("manager")
  );

  // Store Manager Assignment State
  const [isAssignManagerOpen, setIsAssignManagerOpen] = useState(false);
  const [assigningOutlet, setAssigningOutlet] = useState<OutletRecord | null>(null);
  const [selectedManagerUserId, setSelectedManagerUserId] = useState<string>("none");
  const [customManagerName, setCustomManagerName] = useState("");
  const [customManagerPhone, setCustomManagerPhone] = useState("");
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
    name: "",
    brand: "fresh",
    district: "Colombo",
    depot: "peliyagoda",
    dock_type: "rear_dock",
    parking_constraint: "normal",
    mall_window: "",
    van_only: false,
    window_start: "06:00",
    window_end: "18:00",
    store_manager: "",
    store_manager_phone: "",
  });
  const [isSubmittingCreate, setIsSubmittingCreate] = useState(false);
  const [createError, setCreateError] = useState("");

  // Edit Dialog
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [selectedOutlet, setSelectedOutlet] = useState<OutletRecord | null>(null);
  const [editForm, setEditForm] = useState({
    name: "",
    district: "",
    depot: "peliyagoda",
    dock_type: "rear_dock",
    parking_constraint: "normal",
    mall_window: "",
    van_only: false,
    window_start: "06:00",
    window_end: "18:00",
    store_manager: "",
    store_manager_phone: "",
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
          outlet_id: row.outlet_id || row.code || row.id || parts[0] || "",
          brand: row.brand || parts[1] || "Fresh",
          district: row.district || parts[2] || "Colombo",
          depot: row.depot || parts[3] || "Peliyagoda",
          dock_type: row.dock_type || parts[4] || "street",
          parking_constraint: row.parking_constraint || parts[5] || "normal",
          mall_window: row.mall_window || parts[6] || "",
          window_open_time: row.window_open_time || row.window_start || parts[7] || "06:00",
          window_close_time: row.window_close_time || row.window_end || parts[8] || "18:00",
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
      const res = await adminService.importOutletsCSV(importCSVText);
      setImportResult(res);
      onRefresh();
    } catch (err: unknown) {
      setImportError(err instanceof Error ? err.message : "Failed to import outlets");
    } finally {
      setIsSubmittingImport(false);
    }
  };

  // Handle CSV Export
  const handleExportCSV = async () => {
    setIsExporting(true);
    try {
      const csvText = await adminService.exportOutletsCSV();
      const blob = new Blob([csvText], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `waypoint_outlets_${new Date().toISOString().slice(0, 10)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to export outlets CSV");
    } finally {
      setIsExporting(false);
    }
  };

  // Filter outlets
  const filteredOutlets = outlets.filter((o) => {
    const matchesSearch =
      o.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
      o.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      o.district.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesBrand = brandFilter === "ALL" || o.brand.toLowerCase() === brandFilter.toLowerCase();
    const matchesDepot = depotFilter === "ALL" || o.depot.toLowerCase() === depotFilter.toLowerCase();
    const matchesAccess =
      accessFilter === "ALL" ||
      (accessFilter === "VAN_ONLY" && (o.van_only || o.parking_constraint === "van_only")) ||
      (accessFilter === "MALL_DOCK" && o.parking_constraint === "mall_dock") ||
      (accessFilter === "NORMAL" && !o.van_only && o.parking_constraint !== "van_only");

    return matchesSearch && matchesBrand && matchesDepot && matchesAccess;
  });

  // Handle Create Submit
  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError("");
    if (!createForm.code || !createForm.name) {
      setCreateError("Outlet code and name are required.");
      return;
    }

    setIsSubmittingCreate(true);
    try {
      await adminService.createOutlet({
        ...createForm,
        code: createForm.code.toUpperCase(),
        van_only: createForm.parking_constraint === "van_only",
        mall_window: createForm.mall_window || undefined,
        store_manager: createForm.store_manager || undefined,
        store_manager_phone: createForm.store_manager_phone || undefined,
      });
      setIsCreateOpen(false);
      setCreateForm({
        code: "",
        name: "",
        brand: "fresh",
        district: "Colombo",
        depot: "peliyagoda",
        dock_type: "rear_dock",
        parking_constraint: "normal",
        mall_window: "",
        van_only: false,
        window_start: "06:00",
        window_end: "18:00",
        store_manager: "",
        store_manager_phone: "",
      });
      onRefresh();
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : "Creation failed");
    } finally {
      setIsSubmittingCreate(false);
    }
  };

  // Open Edit Modal
  const openEditModal = (outlet: OutletRecord) => {
    setSelectedOutlet(outlet);
    setEditForm({
      name: outlet.name,
      district: outlet.district,
      depot: outlet.depot.toLowerCase(),
      dock_type: outlet.dock_type.toLowerCase(),
      parking_constraint: outlet.parking_constraint || (outlet.van_only ? "van_only" : "normal"),
      mall_window: outlet.mall_window || "",
      van_only: outlet.van_only,
      window_start: outlet.window_start || "06:00",
      window_end: outlet.window_end || "18:00",
      store_manager: outlet.store_manager || "",
      store_manager_phone: outlet.store_manager_phone || "",
    });
    setEditError("");
    setIsEditOpen(true);
  };

  // Handle Edit Submit
  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOutlet) return;
    setEditError("");

    setIsSubmittingEdit(true);
    try {
      await adminService.updateOutlet(selectedOutlet.id, {
        name: editForm.name,
        district: editForm.district,
        depot: editForm.depot,
        dock_type: editForm.dock_type,
        parking_constraint: editForm.parking_constraint,
        mall_window: editForm.mall_window || null,
        van_only: editForm.parking_constraint === "van_only",
        window_start: editForm.window_start,
        window_end: editForm.window_end,
        store_manager: editForm.store_manager || null,
        store_manager_phone: editForm.store_manager_phone || null,
      });
      setIsEditOpen(false);
      onRefresh();
    } catch (err: unknown) {
      setEditError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setIsSubmittingEdit(false);
    }
  };

  // Handle Assign Manager Submit
  const handleAssignManagerSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assigningOutlet) return;
    setIsSubmittingAssign(true);
    setAssignError("");
    try {
      if (selectedManagerUserId === "none") {
        await adminService.assignOutletManager(assigningOutlet.id, {
          user_id: null,
          store_manager: null,
          contact_phone: null,
        });
      } else if (selectedManagerUserId === "custom") {
        await adminService.assignOutletManager(assigningOutlet.id, {
          store_manager: customManagerName,
          contact_phone: customManagerPhone,
        });
      } else {
        const uId = Number(selectedManagerUserId);
        const matched = storeManagers.find((m) => m.id === uId);
        await adminService.assignOutletManager(assigningOutlet.id, {
          user_id: uId,
          store_manager: matched?.full_name,
          contact_phone: customManagerPhone || "077-0000000",
        });
      }
      setIsAssignManagerOpen(false);
      setAssigningOutlet(null);
      onRefresh();
    } catch (err: unknown) {
      setAssignError(err instanceof Error ? err.message : "Failed to assign store manager");
    } finally {
      setIsSubmittingAssign(false);
    }
  };

  const getBrandBadge = (brand: string) => {
    switch (brand.toLowerCase()) {
      case "fresh":
        return <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300">Fresh</Badge>;
      case "style":
        return <Badge className="bg-purple-100 text-purple-800 border-purple-300">Style</Badge>;
      case "tech":
        return <Badge className="bg-blue-100 text-blue-800 border-blue-300">Tech</Badge>;
      default:
        return <Badge variant="outline">{brand}</Badge>;
    }
  };

  const getParkingBadge = (constraint?: string, vanOnly?: boolean) => {
    const val = (constraint || (vanOnly ? "van_only" : "normal")).toLowerCase();
    switch (val) {
      case "van_only":
        return (
          <Badge className="bg-purple-100 text-purple-900 border-purple-300 text-[10px]">
            Van Only
          </Badge>
        );
      case "mall_dock":
        return (
          <Badge className="bg-amber-100 text-amber-900 border-amber-300 text-[10px]">
            Mall Dock
          </Badge>
        );
      default:
        return (
          <span className="text-[10px] text-muted-foreground">Normal Access</span>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Store className="size-5 text-primary" />
            <span>Retail Outlets &amp; Delivery Destinations</span>
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Configure outlet profiles, assigned depots, delivery windows, dock unloading types, and import/export operations CSV records.
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

          {/* Add Outlet Button */}
          <Button
            size="sm"
            onClick={() => setIsCreateOpen(true)}
            className="bg-primary text-primary-foreground text-xs gap-1.5 font-semibold"
          >
            <Plus className="size-3.5" />
            <span>Add Outlet</span>
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card className="border-border shadow-xs">
        <CardContent className="p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
              <Input
                placeholder="Search code, name, district..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 text-xs"
              />
            </div>

            {/* Brand Filter */}
            <Select value={brandFilter} onValueChange={setBrandFilter}>
              <SelectTrigger className="text-xs">
                <SelectValue placeholder="Brand" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Brands</SelectItem>
                <SelectItem value="fresh">Fresh</SelectItem>
                <SelectItem value="style">Style</SelectItem>
                <SelectItem value="tech">Tech</SelectItem>
              </SelectContent>
            </Select>

            {/* Depot Filter */}
            <Select value={depotFilter} onValueChange={setDepotFilter}>
              <SelectTrigger className="text-xs">
                <SelectValue placeholder="Assigned Depot" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Depots</SelectItem>
                <SelectItem value="peliyagoda">Peliyagoda</SelectItem>
                <SelectItem value="kandy">Kandy</SelectItem>
              </SelectContent>
            </Select>

            {/* Access Type Filter */}
            <Select value={accessFilter} onValueChange={setAccessFilter}>
              <SelectTrigger className="text-xs">
                <SelectValue placeholder="Vehicle Access" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Constraints</SelectItem>
                <SelectItem value="VAN_ONLY">Van Only Requirement</SelectItem>
                <SelectItem value="MALL_DOCK">Mall Dock Constraint</SelectItem>
                <SelectItem value="NORMAL">Normal Truck Access</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Outlets Table */}
      <Card className="border-border shadow-xs overflow-hidden">
        <Table>
          <TableHeader className="bg-slate-50">
            <TableRow>
              <TableHead className="text-xs font-semibold">Outlet Code &amp; Name</TableHead>
              <TableHead className="text-xs font-semibold">Brand &amp; District</TableHead>
              <TableHead className="text-xs font-semibold">Assigned Depot</TableHead>
              <TableHead className="text-xs font-semibold">Store Manager</TableHead>
              <TableHead className="text-xs font-semibold">Delivery &amp; Mall Window</TableHead>
              <TableHead className="text-xs font-semibold">Dock &amp; Constraint</TableHead>
              <TableHead className="text-xs font-semibold text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-xs text-muted-foreground">
                  <TableLoading label="Loading outlets..." />
                </TableCell>
              </TableRow>
            ) : filteredOutlets.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-xs text-muted-foreground">
                  No outlets found matching filters.
                </TableCell>
              </TableRow>
            ) : (
              filteredOutlets.map((outlet) => (
                <TableRow key={outlet.id} className="hover:bg-slate-50/60">
                  <TableCell className="py-3">
                    <div className="font-mono font-bold text-xs text-primary">{outlet.code}</div>
                    <div className="font-semibold text-xs text-foreground mt-0.5">{outlet.name}</div>
                  </TableCell>
                  <TableCell className="py-3">
                    <div className="space-y-1">
                      <div>{getBrandBadge(outlet.brand)}</div>
                      <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                        <MapPin className="size-3 text-muted-foreground" />
                        <span>{outlet.district}</span>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="py-3">
                    <Badge variant="outline" className="text-xs font-semibold text-foreground flex items-center gap-1 w-fit">
                      <Warehouse className="size-3 text-muted-foreground" />
                      <span>{outlet.depot} Depot</span>
                    </Badge>
                  </TableCell>
                  <TableCell className="py-3">
                    {outlet.store_manager ? (
                      <div className="flex items-center gap-2">
                        <div className="h-7 w-7 rounded-full bg-blue-100 text-blue-800 flex items-center justify-center font-bold text-xs shrink-0">
                          {outlet.store_manager.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div className="text-xs font-semibold text-foreground flex items-center gap-1">
                            <span>{outlet.store_manager}</span>
                          </div>
                          <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                            <Phone className="size-2.5 text-muted-foreground" />
                            <span>{outlet.store_manager_phone || "Contact"}</span>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setAssigningOutlet(outlet);
                          setSelectedManagerUserId("none");
                          setCustomManagerName("");
                          setCustomManagerPhone("");
                          setAssignError("");
                          setIsAssignManagerOpen(true);
                        }}
                        className="h-6 px-2 text-[11px] text-muted-foreground border-dashed hover:text-primary hover:border-primary"
                      >
                        <Plus className="size-3 mr-1" />
                        <span>Assign Manager</span>
                      </Button>
                    )}
                  </TableCell>
                  <TableCell className="py-3">
                    <div className="space-y-1">
                      <div className="text-xs font-medium font-mono text-foreground flex items-center gap-1.5">
                        <Clock className="size-3 text-muted-foreground" />
                        <span>{outlet.window_start || "06:00"} &ndash; {outlet.window_end || "18:00"}</span>
                      </div>
                      {outlet.mall_window && (
                        <div className="text-[11px] text-amber-700 font-medium">
                          Mall Bay: {outlet.mall_window}
                        </div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="py-3">
                    <div className="space-y-1">
                      <div className="text-xs font-medium capitalize text-foreground">
                        {outlet.dock_type.replace("_", " ")}
                      </div>
                      <div>{getParkingBadge(outlet.parking_constraint, outlet.van_only)}</div>
                    </div>
                  </TableCell>
                  <TableCell className="py-3 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setAssigningOutlet(outlet);
                          const matched = storeManagers.find(
                            (m) => m.id === outlet.store_manager_user_id
                          );
                          if (matched) {
                            setSelectedManagerUserId(String(matched.id));
                          } else if (outlet.store_manager) {
                            setSelectedManagerUserId("custom");
                            setCustomManagerName(outlet.store_manager);
                          } else {
                            setSelectedManagerUserId("none");
                          }
                          setCustomManagerPhone(outlet.store_manager_phone || "");
                          setAssignError("");
                          setIsAssignManagerOpen(true);
                        }}
                        className="text-xs gap-1 h-7 text-blue-700 hover:bg-blue-50"
                        title="Assign Store Manager"
                      >
                        <UserCheck className="size-3" />
                        <span className="hidden xl:inline">Manager</span>
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEditModal(outlet)}
                        className="text-xs gap-1 h-7 text-primary hover:bg-slate-100"
                      >
                        <Edit2 className="size-3" />
                        <span>Edit</span>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
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
              <span>Import Outlets CSV</span>
            </DialogTitle>
            <DialogDescription className="text-xs">
              Upload or paste retail outlets configuration. Existing outlets matching the outlet ID will be updated; new ones will be registered.
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
                    Successfully processed {importResult.total_rows} outlets ({importResult.imported} newly created, {importResult.updated} updated)
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
                outlet_id,brand,district,depot,dock_type,parking_constraint,mall_window,window_open_time,window_close_time
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
                  placeholder={`outlet_id,brand,district,depot,dock_type,parking_constraint,mall_window,window_open_time,window_close_time\nOUT001,Fresh,Colombo,Peliyagoda,street,van_only,,05:00,07:30\nOUT015,Style,Colombo,Peliyagoda,mall_bay,mall_dock,09:00-11:00,09:00,11:00`}
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
                    Preview ({csvPreviewRows.length} outlets detected)
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
                        <TableHead className="py-1 px-2">Brand</TableHead>
                        <TableHead className="py-1 px-2">District</TableHead>
                        <TableHead className="py-1 px-2">Depot</TableHead>
                        <TableHead className="py-1 px-2">Dock</TableHead>
                        <TableHead className="py-1 px-2">Parking</TableHead>
                        <TableHead className="py-1 px-2">Mall Window</TableHead>
                        <TableHead className="py-1 px-2">Open</TableHead>
                        <TableHead className="py-1 px-2">Close</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {csvPreviewRows.slice(0, 5).map((row, idx) => (
                        <TableRow key={idx}>
                          <TableCell className="py-1.5 px-2 font-mono font-bold">{row.outlet_id}</TableCell>
                          <TableCell className="py-1.5 px-2 capitalize">{row.brand}</TableCell>
                          <TableCell className="py-1.5 px-2">{row.district}</TableCell>
                          <TableCell className="py-1.5 px-2 capitalize">{row.depot}</TableCell>
                          <TableCell className="py-1.5 px-2 capitalize">{row.dock_type}</TableCell>
                          <TableCell className="py-1.5 px-2">{row.parking_constraint}</TableCell>
                          <TableCell className="py-1.5 px-2 font-mono">{row.mall_window || "—"}</TableCell>
                          <TableCell className="py-1.5 px-2 font-mono">{row.window_open_time}</TableCell>
                          <TableCell className="py-1.5 px-2 font-mono">{row.window_close_time}</TableCell>
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
              <span>{isSubmittingImport ? "Importing Outlets..." : `Import ${csvPreviewRows.length || ""} Outlets`}</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Outlet Dialog */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center gap-2">
              <Store className="size-4 text-primary" />
              <span>Register New Outlet</span>
            </DialogTitle>
            <DialogDescription className="text-xs">
              Add a retail delivery destination to the logistics network.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateSubmit} className="space-y-4 py-2">
            {createError && (
              <div className="p-2.5 rounded text-xs bg-red-50 text-red-800 border border-red-200">
                {createError}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Outlet Code</Label>
                <Input
                  className="text-xs font-mono uppercase"
                  placeholder="e.g. OUT121"
                  value={createForm.code}
                  onChange={(e) => setCreateForm({ ...createForm, code: e.target.value })}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Store Brand</Label>
                <Select
                  value={createForm.brand}
                  onValueChange={(val) => setCreateForm({ ...createForm, brand: val })}
                >
                  <SelectTrigger className="text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fresh">Fresh (Groceries &amp; Chilled)</SelectItem>
                    <SelectItem value="style">Style (Apparel)</SelectItem>
                    <SelectItem value="tech">Tech (Electronics)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Store Name</Label>
              <Input
                className="text-xs"
                placeholder="e.g. Fresh Colombo Super"
                value={createForm.name}
                onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">District</Label>
                <Input
                  className="text-xs"
                  placeholder="e.g. Colombo, Kandy"
                  value={createForm.district}
                  onChange={(e) => setCreateForm({ ...createForm, district: e.target.value })}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Serving Depot</Label>
                <Select
                  value={createForm.depot}
                  onValueChange={(val) => setCreateForm({ ...createForm, depot: val })}
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
                <Label className="text-xs">Window Start</Label>
                <Input
                  type="time"
                  className="text-xs font-mono"
                  value={createForm.window_start}
                  onChange={(e) => setCreateForm({ ...createForm, window_start: e.target.value })}
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Window End</Label>
                <Input
                  type="time"
                  className="text-xs font-mono"
                  value={createForm.window_end}
                  onChange={(e) => setCreateForm({ ...createForm, window_end: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Dock Unloading Type</Label>
                <Select
                  value={createForm.dock_type}
                  onValueChange={(val) => setCreateForm({ ...createForm, dock_type: val })}
                >
                  <SelectTrigger className="text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="rear_dock">Rear Dock</SelectItem>
                    <SelectItem value="street">Street Unload</SelectItem>
                    <SelectItem value="mall_bay">Mall Loading Bay</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Parking Constraint</Label>
                <Select
                  value={createForm.parking_constraint}
                  onValueChange={(val) => setCreateForm({ ...createForm, parking_constraint: val })}
                >
                  <SelectTrigger className="text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="normal">Normal (Truck OK)</SelectItem>
                    <SelectItem value="van_only">Van Only</SelectItem>
                    <SelectItem value="mall_dock">Mall Dock</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Mall Delivery Window (Optional)</Label>
              <Input
                className="text-xs font-mono"
                placeholder="e.g. 09:00-11:00 or 10:30-12:30"
                value={createForm.mall_window}
                onChange={(e) => setCreateForm({ ...createForm, mall_window: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Store Manager (Optional)</Label>
                <Select
                  value={
                    storeManagers.some((m) => m.full_name === createForm.store_manager)
                      ? createForm.store_manager
                      : createForm.store_manager
                      ? "custom"
                      : "none"
                  }
                  onValueChange={(val) => {
                    if (val === "none") {
                      setCreateForm({ ...createForm, store_manager: "", store_manager_phone: "" });
                    } else if (val === "custom") {
                      setCreateForm({ ...createForm, store_manager: "Store Manager" });
                    } else {
                      setCreateForm({
                        ...createForm,
                        store_manager: val,
                        store_manager_phone: createForm.store_manager_phone || "077-0000000",
                      });
                    }
                  }}
                >
                  <SelectTrigger className="text-xs">
                    <SelectValue placeholder="Select Store Manager..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">
                      <span className="text-muted-foreground italic">No Manager Assigned</span>
                    </SelectItem>
                    {storeManagers.map((m) => (
                      <SelectItem key={m.id} value={m.full_name}>
                        {m.full_name} ({m.email})
                      </SelectItem>
                    ))}
                    <SelectItem value="custom">Other / Custom Name...</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Manager Phone</Label>
                <Input
                  className="text-xs font-mono"
                  placeholder="e.g. 077-1234567"
                  value={createForm.store_manager_phone}
                  onChange={(e) => setCreateForm({ ...createForm, store_manager_phone: e.target.value })}
                />
              </div>
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
                {isSubmittingCreate ? "Saving..." : "Add Outlet"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Outlet Dialog */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center gap-2">
              <Edit2 className="size-4 text-primary" />
              <span>Edit Outlet {selectedOutlet?.code}</span>
            </DialogTitle>
            <DialogDescription className="text-xs">
              Update delivery timeframe, access restrictions, and assigned depot.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleEditSubmit} className="space-y-4 py-2">
            {editError && (
              <div className="p-2.5 rounded text-xs bg-red-50 text-red-800 border border-red-200">
                {editError}
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-xs">Outlet Name</Label>
              <Input
                className="text-xs"
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">District</Label>
                <Input
                  className="text-xs"
                  value={editForm.district}
                  onChange={(e) => setEditForm({ ...editForm, district: e.target.value })}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Serving Depot</Label>
                <Select
                  value={editForm.depot}
                  onValueChange={(val) => setEditForm({ ...editForm, depot: val })}
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
                <Label className="text-xs">Window Start</Label>
                <Input
                  type="time"
                  className="text-xs font-mono"
                  value={editForm.window_start}
                  onChange={(e) => setEditForm({ ...editForm, window_start: e.target.value })}
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Window End</Label>
                <Input
                  type="time"
                  className="text-xs font-mono"
                  value={editForm.window_end}
                  onChange={(e) => setEditForm({ ...editForm, window_end: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Dock Unloading Type</Label>
                <Select
                  value={editForm.dock_type}
                  onValueChange={(val) => setEditForm({ ...editForm, dock_type: val })}
                >
                  <SelectTrigger className="text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="rear_dock">Rear Dock</SelectItem>
                    <SelectItem value="street">Street Unload</SelectItem>
                    <SelectItem value="mall_bay">Mall Loading Bay</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Parking Constraint</Label>
                <Select
                  value={editForm.parking_constraint}
                  onValueChange={(val) => setEditForm({ ...editForm, parking_constraint: val })}
                >
                  <SelectTrigger className="text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="normal">Normal (Truck OK)</SelectItem>
                    <SelectItem value="van_only">Van Only</SelectItem>
                    <SelectItem value="mall_dock">Mall Dock</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Mall Delivery Window (Optional)</Label>
              <Input
                className="text-xs font-mono"
                placeholder="e.g. 09:00-11:00 or 10:30-12:30"
                value={editForm.mall_window}
                onChange={(e) => setEditForm({ ...editForm, mall_window: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Store Manager</Label>
                <Select
                  value={
                    storeManagers.some((m) => m.full_name === editForm.store_manager)
                      ? editForm.store_manager
                      : editForm.store_manager
                      ? "custom"
                      : "none"
                  }
                  onValueChange={(val) => {
                    if (val === "none") {
                      setEditForm({ ...editForm, store_manager: "", store_manager_phone: "" });
                    } else if (val === "custom") {
                      setEditForm({ ...editForm, store_manager: "Store Manager" });
                    } else {
                      setEditForm({
                        ...editForm,
                        store_manager: val,
                        store_manager_phone: editForm.store_manager_phone || "077-0000000",
                      });
                    }
                  }}
                >
                  <SelectTrigger className="text-xs">
                    <SelectValue placeholder="Select Store Manager..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">
                      <span className="text-muted-foreground italic">No Manager Assigned</span>
                    </SelectItem>
                    {storeManagers.map((m) => (
                      <SelectItem key={m.id} value={m.full_name}>
                        {m.full_name} ({m.email})
                      </SelectItem>
                    ))}
                    <SelectItem value="custom">Other / Custom Name...</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Manager Phone</Label>
                <Input
                  className="text-xs font-mono"
                  placeholder="e.g. 077-1234567"
                  value={editForm.store_manager_phone}
                  onChange={(e) => setEditForm({ ...editForm, store_manager_phone: e.target.value })}
                />
              </div>
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

      {/* Assign Store Manager Dialog */}
      <Dialog open={isAssignManagerOpen} onOpenChange={setIsAssignManagerOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center gap-2">
              <UserCheck className="size-4 text-blue-600" />
              <span>Assign Store Manager to {assigningOutlet?.name}</span>
            </DialogTitle>
            <DialogDescription className="text-xs">
              Assign an operational manager to oversee deliveries, dock access, and check-ins at this outlet destination.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleAssignManagerSubmit} className="space-y-4 py-2">
            {assignError && (
              <div className="p-2.5 rounded text-xs bg-red-50 text-red-800 border border-red-200">
                {assignError}
              </div>
            )}

            <div className="p-3 bg-slate-50 border border-slate-200 rounded-md text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Outlet Code:</span>
                <span className="font-mono font-bold text-foreground">{assigningOutlet?.code}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Location:</span>
                <span className="text-foreground">{assigningOutlet?.name} &bull; {assigningOutlet?.district}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Serving Depot:</span>
                <span className="capitalize text-foreground">{assigningOutlet?.depot} Depot</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Current Manager:</span>
                <span className="font-semibold text-foreground">
                  {assigningOutlet?.store_manager || "None (Unassigned)"}
                </span>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Store Manager Account</Label>
              <Select
                value={selectedManagerUserId}
                onValueChange={(val) => {
                  setSelectedManagerUserId(val);
                  if (val !== "custom" && val !== "none") {
                    const matched = storeManagers.find((m) => String(m.id) === val);
                    if (matched) {
                      setCustomManagerName(matched.full_name);
                    }
                  }
                }}
              >
                <SelectTrigger className="text-xs">
                  <SelectValue placeholder="Choose a manager..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">
                    <span className="text-muted-foreground italic">None (Unassign Manager)</span>
                  </SelectItem>
                  {storeManagers.map((m) => (
                    <SelectItem key={m.id} value={String(m.id)}>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{m.full_name}</span>
                        <span className="text-muted-foreground text-[11px]">({m.email})</span>
                      </div>
                    </SelectItem>
                  ))}
                  <SelectItem value="custom">Other / Custom Manager...</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {selectedManagerUserId === "custom" && (
              <div className="space-y-1.5">
                <Label className="text-xs">Manager Name</Label>
                <Input
                  className="text-xs"
                  placeholder="e.g. Kasun Perera"
                  value={customManagerName}
                  onChange={(e) => setCustomManagerName(e.target.value)}
                  required
                />
              </div>
            )}

            {selectedManagerUserId !== "none" && (
              <div className="space-y-1.5">
                <Label className="text-xs">Contact Phone</Label>
                <Input
                  className="text-xs font-mono"
                  placeholder="e.g. 077-1234567"
                  value={customManagerPhone}
                  onChange={(e) => setCustomManagerPhone(e.target.value)}
                />
              </div>
            )}

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsAssignManagerOpen(false)}
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
                <span>{isSubmittingAssign ? "Saving..." : "Confirm Manager"}</span>
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
