"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  Store,
  Search,
  Filter,
  RefreshCw,
  Download,
  MapPin,
  Clock,
  Truck,
  Building2,
  Phone,
  User,
  ShieldAlert,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Warehouse,
  CheckCircle2,
  X,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { TableLoading } from "@/components/ui/table-loading";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { adminService, OutletRecord } from "@/services/admin-service";

export default function DispatcherOutletsPage() {
  const [outlets, setOutlets] = useState<OutletRecord[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState<boolean>(false);

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState("");
  const [brandFilter, setBrandFilter] = useState("ALL");
  const [depotFilter, setDepotFilter] = useState("ALL");
  const [accessFilter, setAccessFilter] = useState("ALL");

  // Selected Outlet for Inspection Drawer
  const [selectedOutlet, setSelectedOutlet] = useState<OutletRecord | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);

  // Fetch Outlets from adminService (same source as /admin?tab=outlets)
  const loadOutlets = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await adminService.getOutlets();
      setOutlets(data);
    } catch (err: unknown) {
      console.error("Failed to load outlets:", err);
      setError(err instanceof Error ? err.message : "Failed to load outlet directory.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const initial = setTimeout(() => { void loadOutlets(); }, 0);
    return () => clearTimeout(initial);
  }, [loadOutlets]);

  // Handle Export CSV
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
      console.error("Failed to export outlets:", err);
      alert(err instanceof Error ? err.message : "Failed to export outlets CSV");
    } finally {
      setIsExporting(false);
    }
  };

  // Filter outlets
  const filteredOutlets = useMemo(() => {
    return outlets.filter((o) => {
      const query = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !query ||
        o.code.toLowerCase().includes(query) ||
        o.name.toLowerCase().includes(query) ||
        o.district.toLowerCase().includes(query);

      const matchesBrand =
        brandFilter === "ALL" || o.brand.toLowerCase() === brandFilter.toLowerCase();

      const matchesDepot =
        depotFilter === "ALL" || o.depot.toLowerCase() === depotFilter.toLowerCase();

      const matchesAccess =
        accessFilter === "ALL" ||
        (accessFilter === "VAN_ONLY" && (o.van_only || o.parking_constraint === "van_only")) ||
        (accessFilter === "MALL_DOCK" && o.parking_constraint === "mall_dock") ||
        (accessFilter === "NORMAL" && !o.van_only && o.parking_constraint !== "van_only");

      return matchesSearch && matchesBrand && matchesDepot && matchesAccess;
    });
  }, [outlets, searchQuery, brandFilter, depotFilter, accessFilter]);

  // Reset pagination on filter change
  useEffect(() => {
    const reset = setTimeout(() => setCurrentPage(1), 0);
    return () => clearTimeout(reset);
  }, [searchQuery, brandFilter, depotFilter, accessFilter, pageSize]);

  // Paginated records
  const totalPages = Math.max(1, Math.ceil(filteredOutlets.length / pageSize));
  const paginatedOutlets = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredOutlets.slice(start, start + pageSize);
  }, [filteredOutlets, currentPage, pageSize]);

  // KPIs
  const totalCount = outlets.length;
  const peliyagodaCount = outlets.filter((o) => o.depot.toLowerCase() === "peliyagoda").length;
  const kandyCount = outlets.filter((o) => o.depot.toLowerCase() === "kandy").length;
  const vanOnlyCount = outlets.filter((o) => o.van_only || o.parking_constraint === "van_only").length;
  const freshCount = outlets.filter((o) => o.brand.toLowerCase() === "fresh").length;

  // Badges & Formatters
  const getBrandBadge = (brand: string) => {
    switch (brand.toLowerCase()) {
      case "fresh":
        return (
          <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 font-medium">
            Fresh
          </Badge>
        );
      case "style":
        return (
          <Badge className="bg-purple-500/15 text-purple-700 dark:text-purple-400 border-purple-500/30 font-medium">
            Style
          </Badge>
        );
      case "tech":
        return (
          <Badge className="bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30 font-medium">
            Tech
          </Badge>
        );
      default:
        return <Badge variant="outline">{brand}</Badge>;
    }
  };

  const getDepotBadge = (depot: string) => {
    const isPel = depot.toLowerCase() === "peliyagoda";
    return (
      <Badge
        variant="outline"
        className={`font-medium ${
          isPel
            ? "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300"
            : "border-indigo-500/30 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300"
        }`}
      >
        <Warehouse className="size-3 mr-1" />
        {depot}
      </Badge>
    );
  };

  const getDockBadge = (dockType: string) => {
    const formatted = dockType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    return (
      <span className="text-xs font-medium text-foreground">
        {formatted}
      </span>
    );
  };

  const getConstraintBadge = (constraint?: string, vanOnly?: boolean) => {
    if (vanOnly || constraint === "van_only") {
      return (
        <Badge className="bg-purple-100 text-purple-900 border-purple-300 text-[10px] font-semibold dark:bg-purple-900/40 dark:text-purple-300">
          Van Only
        </Badge>
      );
    }
    if (constraint === "mall_dock") {
      return (
        <Badge className="bg-amber-100 text-amber-900 border-amber-300 text-[10px] font-semibold dark:bg-amber-900/40 dark:text-amber-300">
          Mall Dock
        </Badge>
      );
    }
    return (
      <span className="text-[11px] text-muted-foreground">Normal Access</span>
    );
  };

  const clearFilters = () => {
    setSearchQuery("");
    setBrandFilter("ALL");
    setDepotFilter("ALL");
    setAccessFilter("ALL");
  };

  const hasActiveFilters =
    searchQuery.trim() !== "" ||
    brandFilter !== "ALL" ||
    depotFilter !== "ALL" ||
    accessFilter !== "ALL";

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Store className="size-6 text-primary" />
            <span>Retail Outlets Directory</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Complete registry of verified retail delivery destinations, docking configurations, receiving windows, and fleet access constraints.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <Button
            variant="outline"
            size="sm"
            onClick={loadOutlets}
            disabled={isLoading}
            className="text-xs gap-1.5 border-border"
          >
            <RefreshCw className={`size-3.5 ${isLoading ? "animate-spin" : ""}`} />
            <span>Refresh</span>
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCSV}
            disabled={isExporting || isLoading}
            className="text-xs gap-1.5 border-border hover:bg-muted"
          >
            <Download className="size-3.5 text-emerald-600 dark:text-emerald-400" />
            <span>{isExporting ? "Exporting..." : "Export CSV"}</span>
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3.5">
        <Card className="shadow-xs border-border">
          <CardContent className="p-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center justify-between">
              <span>Total Outlets</span>
              <Store className="size-4 text-primary" />
            </div>
            <div className="mt-2 text-2xl font-bold text-foreground">
              {isLoading ? "..." : totalCount}
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">Verified destinations</p>
          </CardContent>
        </Card>

        <Card className="shadow-xs border-border">
          <CardContent className="p-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center justify-between">
              <span>Peliyagoda Hub</span>
              <Warehouse className="size-4 text-sky-600" />
            </div>
            <div className="mt-2 text-2xl font-bold text-foreground">
              {isLoading ? "..." : peliyagodaCount}
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">Western &amp; Coastal sector</p>
          </CardContent>
        </Card>

        <Card className="shadow-xs border-border">
          <CardContent className="p-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center justify-between">
              <span>Kandy Hub</span>
              <Warehouse className="size-4 text-indigo-600" />
            </div>
            <div className="mt-2 text-2xl font-bold text-foreground">
              {isLoading ? "..." : kandyCount}
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">Central &amp; Hill country</p>
          </CardContent>
        </Card>

        <Card className="shadow-xs border-border">
          <CardContent className="p-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center justify-between">
              <span>Van Only Access</span>
              <Truck className="size-4 text-purple-600" />
            </div>
            <div className="mt-2 text-2xl font-bold text-purple-700 dark:text-purple-400">
              {isLoading ? "..." : vanOnlyCount}
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">Truck clearance restricted</p>
          </CardContent>
        </Card>

        <Card className="shadow-xs border-border">
          <CardContent className="p-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center justify-between">
              <span>Fresh Stores</span>
              <CheckCircle2 className="size-4 text-emerald-600" />
            </div>
            <div className="mt-2 text-2xl font-bold text-emerald-700 dark:text-emerald-400">
              {isLoading ? "..." : freshCount}
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">Temperature sensitive</p>
          </CardContent>
        </Card>
      </div>

      {/* Filter and Search Bar */}
      <Card className="border-border shadow-xs">
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
            {/* Search Input */}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                placeholder="Search by code (e.g. OUT001), name, or district..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 bg-background h-9 text-sm"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>

            {/* Filter Dropdowns */}
            <div className="flex flex-wrap items-center gap-2.5">
              {/* Brand Filter */}
              <div className="w-36">
                <Select value={brandFilter} onValueChange={setBrandFilter}>
                  <SelectTrigger className="h-9 text-xs bg-background">
                    <SelectValue placeholder="Brand: All" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All Brands</SelectItem>
                    <SelectItem value="fresh">Fresh</SelectItem>
                    <SelectItem value="style">Style</SelectItem>
                    <SelectItem value="tech">Tech</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Depot Filter */}
              <div className="w-36">
                <Select value={depotFilter} onValueChange={setDepotFilter}>
                  <SelectTrigger className="h-9 text-xs bg-background">
                    <SelectValue placeholder="Depot: All" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All Depots</SelectItem>
                    <SelectItem value="peliyagoda">Peliyagoda</SelectItem>
                    <SelectItem value="kandy">Kandy</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Access Constraint Filter */}
              <div className="w-40">
                <Select value={accessFilter} onValueChange={setAccessFilter}>
                  <SelectTrigger className="h-9 text-xs bg-background">
                    <SelectValue placeholder="Access: All" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All Access Rules</SelectItem>
                    <SelectItem value="VAN_ONLY">Van Only Access</SelectItem>
                    <SelectItem value="MALL_DOCK">Mall Dock</SelectItem>
                    <SelectItem value="NORMAL">Normal Access</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Clear Filters */}
              {hasActiveFilters && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearFilters}
                  className="h-9 text-xs text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3.5 mr-1" />
                  Reset
                </Button>
              )}
            </div>
          </div>

          {/* Filter status strip */}
          <div className="flex items-center justify-between text-xs text-muted-foreground pt-1 border-t border-border/50">
            <span>
              Showing <strong className="text-foreground">{filteredOutlets.length}</strong> of{" "}
              <strong className="text-foreground">{outlets.length}</strong> outlets
            </span>

            <div className="flex items-center gap-2">
              <span>Rows per page:</span>
              <Select
                value={String(pageSize)}
                onValueChange={(val) => setPageSize(Number(val))}
              >
                <SelectTrigger className="h-7 w-20 text-xs bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="15">15</SelectItem>
                  <SelectItem value="25">25</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                  <SelectItem value="100">100</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Outlets Data Table */}
      <Card className="border-border shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <Table className="dispatcher-table min-w-[1080px]">
            <TableHeader className="bg-muted/40">
              <TableRow className="border-border">
                <TableHead className="w-[100px] font-semibold text-xs text-muted-foreground uppercase">
                  Code
                </TableHead>
                <TableHead className="font-semibold text-xs text-muted-foreground uppercase">
                  Outlet Name
                </TableHead>
                <TableHead className="w-[100px] font-semibold text-xs text-muted-foreground uppercase">
                  Brand
                </TableHead>
                <TableHead className="w-[130px] font-semibold text-xs text-muted-foreground uppercase">
                  Depot Hub
                </TableHead>
                <TableHead className="w-[130px] font-semibold text-xs text-muted-foreground uppercase">
                  District
                </TableHead>
                <TableHead className="w-[160px] font-semibold text-xs text-muted-foreground uppercase">
                  Dock &amp; Access
                </TableHead>
                <TableHead className="w-[140px] font-semibold text-xs text-muted-foreground uppercase">
                  Receiving Window
                </TableHead>
                <TableHead className="w-[180px] font-semibold text-xs text-muted-foreground uppercase">
                  Store Manager
                </TableHead>
                <TableHead className="w-[90px] text-right font-semibold text-xs text-muted-foreground uppercase">
                  Action
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={9} className="h-48 text-center text-muted-foreground">
                    <TableLoading label="Loading outlet directory from administrative registry..." />
                  </TableCell>
                </TableRow>
              ) : error ? (
                <TableRow>
                  <TableCell colSpan={9} className="h-48 text-center text-destructive">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <ShieldAlert className="size-6" />
                      <span className="text-sm font-medium">{error}</span>
                      <Button variant="outline" size="sm" onClick={loadOutlets} className="mt-2 text-xs">
                        Try Again
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ) : paginatedOutlets.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="h-40 text-center text-muted-foreground">
                    <div className="flex flex-col items-center justify-center gap-1.5">
                      <Store className="size-6 opacity-40" />
                      <span className="text-sm font-medium">No outlets match the selected filters.</span>
                      {hasActiveFilters && (
                        <Button variant="link" size="sm" onClick={clearFilters} className="text-xs">
                          Clear all filters
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                paginatedOutlets.map((outlet) => (
                  <TableRow
                    key={outlet.id}
                    className="border-border hover:bg-muted/50 transition-colors"
                  >
                    {/* Code */}
                    <TableCell className="font-mono text-xs font-semibold text-foreground">
                      <span className="px-2 py-0.5 rounded bg-muted border border-border">
                        {outlet.code}
                      </span>
                    </TableCell>

                    {/* Outlet Name */}
                    <TableCell>
                      <div className="font-medium text-sm text-foreground">
                        {outlet.name}
                      </div>
                    </TableCell>

                    {/* Brand */}
                    <TableCell>{getBrandBadge(outlet.brand)}</TableCell>

                    {/* Depot */}
                    <TableCell>{getDepotBadge(outlet.depot)}</TableCell>

                    {/* District */}
                    <TableCell>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground font-medium">
                        <MapPin className="size-3 text-muted-foreground/70" />
                        <span>{outlet.district}</span>
                      </div>
                    </TableCell>

                    {/* Dock & Access */}
                    <TableCell>
                      <div className="flex flex-col gap-1 items-start">
                        {getDockBadge(outlet.dock_type)}
                        {getConstraintBadge(outlet.parking_constraint, outlet.van_only)}
                      </div>
                    </TableCell>

                    {/* Receiving Window */}
                    <TableCell>
                      <div className="flex items-center gap-1.5 text-xs text-foreground font-medium">
                        <Clock className="size-3.5 text-muted-foreground" />
                        <span>
                          {outlet.window_start || "06:00"} – {outlet.window_end || "18:00"}
                        </span>
                      </div>
                      {outlet.mall_window && (
                        <span className="text-[10px] text-amber-600 dark:text-amber-400 font-medium">
                          Mall: {outlet.mall_window}
                        </span>
                      )}
                    </TableCell>

                    {/* Store Manager */}
                    <TableCell>
                      {outlet.store_manager ? (
                        <div className="space-y-0.5 text-xs">
                          <div className="font-medium text-foreground flex items-center gap-1">
                            <User className="size-3 text-muted-foreground" />
                            <span>{outlet.store_manager}</span>
                          </div>
                          {outlet.store_manager_phone && (
                            <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                              <Phone className="size-3 text-muted-foreground/70" />
                              <a
                                href={`tel:${outlet.store_manager_phone}`}
                                className="hover:underline hover:text-foreground"
                              >
                                {outlet.store_manager_phone}
                              </a>
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-[11px] text-muted-foreground/70 italic">
                          Unassigned
                        </span>
                      )}
                    </TableCell>

                    {/* Actions */}
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setSelectedOutlet(outlet);
                          setIsDrawerOpen(true);
                        }}
                        className="h-8 px-2.5 text-xs font-medium text-primary hover:text-primary hover:bg-primary/10"
                      >
                        Inspect
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination controls */}
        {filteredOutlets.length > 0 && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-4 border-t border-border bg-card">
            <div className="text-xs text-muted-foreground">
              Showing{" "}
              <strong className="text-foreground">
                {(currentPage - 1) * pageSize + 1}
              </strong>{" "}
              to{" "}
              <strong className="text-foreground">
                {Math.min(currentPage * pageSize, filteredOutlets.length)}
              </strong>{" "}
              of <strong className="text-foreground">{filteredOutlets.length}</strong> outlets
            </div>

            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="h-8 px-2.5 text-xs border-border"
              >
                <ChevronLeft className="size-3.5 mr-1" />
                Previous
              </Button>

              <span className="px-3 text-xs font-medium text-muted-foreground">
                Page <strong className="text-foreground">{currentPage}</strong> of{" "}
                <strong className="text-foreground">{totalPages}</strong>
              </span>

              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="h-8 px-2.5 text-xs border-border"
              >
                Next
                <ChevronRight className="size-3.5 ml-1" />
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Outlet Logistical Inspection Drawer */}
      <Sheet open={isDrawerOpen} onOpenChange={setIsDrawerOpen}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          {selectedOutlet && (
            <div className="space-y-6 pt-2">
              <SheetHeader>
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-mono text-xs px-2 py-0.5 rounded bg-muted border border-border font-semibold">
                    {selectedOutlet.code}
                  </span>
                  {getBrandBadge(selectedOutlet.brand)}
                  {getDepotBadge(selectedOutlet.depot)}
                </div>
                <SheetTitle className="text-xl font-bold text-foreground">
                  {selectedOutlet.name}
                </SheetTitle>
                <SheetDescription className="text-xs text-muted-foreground">
                  Logistical specifications and site delivery constraints for dispatch planning.
                </SheetDescription>
              </SheetHeader>

              {/* Geographic & Hub Summary */}
              <div className="rounded-lg border border-border p-4 bg-muted/20 space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Geographic &amp; Hub Assignment
                </h3>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <span className="text-xs text-muted-foreground block">District</span>
                    <span className="font-medium text-foreground flex items-center gap-1 mt-0.5">
                      <MapPin className="size-3.5 text-primary" />
                      {selectedOutlet.district}
                    </span>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground block">Primary Depot Hub</span>
                    <span className="font-medium text-foreground flex items-center gap-1 mt-0.5">
                      <Warehouse className="size-3.5 text-primary" />
                      {selectedOutlet.depot} Depot
                    </span>
                  </div>
                </div>
              </div>

              {/* Docking & Vehicle Access Rules */}
              <div className="rounded-lg border border-border p-4 space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Truck className="size-4 text-primary" />
                  <span>Docking &amp; Vehicle Access Rules</span>
                </h3>

                <div className="space-y-3 text-sm">
                  <div className="flex items-center justify-between pb-2 border-b border-border/60">
                    <span className="text-xs text-muted-foreground">Unloading Bay Architecture:</span>
                    <span className="font-semibold text-foreground">
                      {selectedOutlet.dock_type.replace(/_/g, " ").toUpperCase()}
                    </span>
                  </div>

                  <div className="flex items-center justify-between pb-2 border-b border-border/60">
                    <span className="text-xs text-muted-foreground">Vehicle Restriction:</span>
                    <div>
                      {selectedOutlet.van_only ? (
                        <Badge className="bg-purple-100 text-purple-900 border-purple-300 font-semibold dark:bg-purple-900/50 dark:text-purple-300">
                          Strict Van Only
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">
                          Rigid Trucks Allowed
                        </Badge>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between pb-2 border-b border-border/60">
                    <span className="text-xs text-muted-foreground">Parking Constraint:</span>
                    <span className="font-medium text-foreground capitalize">
                      {selectedOutlet.parking_constraint?.replace(/_/g, " ") || "Normal Street Access"}
                    </span>
                  </div>

                  {selectedOutlet.van_only && (
                    <div className="p-2.5 rounded bg-purple-500/10 border border-purple-500/20 text-xs text-purple-800 dark:text-purple-300">
                      <strong>Dispatcher Note:</strong> Heavy rigid trucks cannot access this outlet due to narrow street turns or low overhead clearance. Dispatch trips must assign delivery vans only.
                    </div>
                  )}
                </div>
              </div>

              {/* Delivery Window Hours */}
              <div className="rounded-lg border border-border p-4 space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Clock className="size-4 text-primary" />
                  <span>Receiving Schedule</span>
                </h3>

                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between pb-2 border-b border-border/60">
                    <span className="text-xs text-muted-foreground">Operational Window:</span>
                    <span className="font-mono font-semibold text-foreground">
                      {selectedOutlet.window_start || "06:00"} – {selectedOutlet.window_end || "18:00"}
                    </span>
                  </div>

                  {selectedOutlet.mall_window && (
                    <div className="flex items-center justify-between pb-2 border-b border-border/60">
                      <span className="text-xs text-muted-foreground">Mall Security Window:</span>
                      <span className="font-mono font-semibold text-amber-700 dark:text-amber-400">
                        {selectedOutlet.mall_window}
                      </span>
                    </div>
                  )}

                  <p className="text-[11px] text-muted-foreground pt-1">
                    Deliveries arriving outside these hours may incur dock idle penalties or gate rejection.
                  </p>
                </div>
              </div>

              {/* Store Manager & Operations Contact */}
              <div className="rounded-lg border border-border p-4 space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <User className="size-4 text-primary" />
                  <span>Store Contact &amp; On-Site Coordination</span>
                </h3>

                {selectedOutlet.store_manager ? (
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Assigned Manager:</span>
                      <span className="font-semibold text-foreground">
                        {selectedOutlet.store_manager}
                      </span>
                    </div>

                    {selectedOutlet.store_manager_phone && (
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">Contact Phone:</span>
                        <a
                          href={`tel:${selectedOutlet.store_manager_phone}`}
                          className="font-medium text-primary hover:underline flex items-center gap-1"
                        >
                          <Phone className="size-3" />
                          {selectedOutlet.store_manager_phone}
                        </a>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground italic">
                    No store manager recorded for this location. Contact depot operations for access codes.
                  </div>
                )}
              </div>

              <div className="pt-2 flex justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsDrawerOpen(false)}
                  className="w-full text-xs"
                >
                  Close Inspection
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
