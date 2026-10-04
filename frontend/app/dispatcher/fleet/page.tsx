"use client";

import { useEffect, useMemo, useState } from "react";
import { MetricCard } from "@/components/domain/metric-card";
import { fetchFleet, formatCapacity, normalize, type FleetVehicle } from "@/components/dispatcher/fleet/fleet-data";
import { VehicleDetails } from "@/components/dispatcher/fleet/VehicleDetails";
import { VehicleEditor } from "@/components/dispatcher/fleet/VehicleEditor";
import { downloadCsv } from "@/components/dispatcher/operations/data";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const PAGE_SIZE = 7;
const columns = ["Vehicle", "Type", "Temp", "Depot", "Weight Cap", "Volume Cap", "Availability", "Fuel status", "Action"];

function FleetFilter({ label, value, options, onChange }: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label} className="w-full rounded-md border-border bg-card text-xs shadow-none data-[size=default]:h-10 sm:w-[150px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{label}</SelectItem>
        {options.map((option) => <SelectItem key={option} value={option} className="capitalize">{option}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

export default function FleetPage() {
  const [vehicles, setVehicles] = useState<FleetVehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [request, setRequest] = useState(0);
  const [search, setSearch] = useState("");
  const [depot, setDepot] = useState("all");
  const [type, setType] = useState("all");
  const [temperature, setTemperature] = useState("all");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [editor, setEditor] = useState<FleetVehicle | "new" | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = AbortSignal.timeout(15000);
    fetchFleet(AbortSignal.any([controller.signal, timeout]))
      .then((data) => {
        if (!controller.signal.aborted) setVehicles(data);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setError(timeout.aborted ? "The fleet request timed out. Please try again." : "We couldn’t load the fleet. Check your connection and try again.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [request]);

  const options = useMemo(() => {
    const unique = (key: "depot_name" | "vehicle_type" | "temperature_mode") =>
      [...new Set(vehicles.map((vehicle) => normalize(vehicle[key])).filter(Boolean))].sort();
    return { depots: unique("depot_name"), types: unique("vehicle_type"), temperatures: unique("temperature_mode") };
  }, [vehicles]);

  const filtered = useMemo(() => vehicles.filter((vehicle) =>
    normalize(vehicle.code).includes(normalize(search)) &&
    (depot === "all" || normalize(vehicle.depot_name) === depot) &&
    (type === "all" || normalize(vehicle.vehicle_type) === type) &&
    (temperature === "all" || normalize(vehicle.temperature_mode) === temperature) &&
    (status === "all" || vehicle.status === status)
  ), [vehicles, search, depot, type, temperature, status]);

  const metrics = [
    ["Total Vehicles", vehicles.length],
    ["Trucks", vehicles.filter((v) => normalize(v.vehicle_type) === "truck").length],
    ["Vans", vehicles.filter((v) => normalize(v.vehicle_type) === "van").length],
    ["Reefer", vehicles.filter((v) => normalize(v.temperature_mode) === "reefer").length],
    ["Ambient", vehicles.filter((v) => normalize(v.temperature_mode) === "ambient").length],
  ] as const;
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visible = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const hasFilters = Boolean(search || depot !== "all" || type !== "all" || temperature !== "all" || status !== "all");

  function clearFilters() {
    setSearch(""); setDepot("all"); setType("all"); setTemperature("all"); setStatus("all"); setPage(1);
  }

  return (
    <div className="space-y-7" data-design-node="114:1207">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
        <h1 className="text-3xl font-bold tracking-tight">Fleet</h1>
        <p className="mt-2 text-sm text-muted-foreground">Manage vehicle specifications, availability, and current maintenance and fuel status.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setEditor("new")}>Add vehicle</Button>
          <Button variant="outline" disabled={loading} onClick={() => { setLoading(true); setError(null); setRequest((value) => value + 1); }}>Refresh</Button>
          <Button variant="outline" disabled={loading || !!error || !filtered.length} onClick={() => downloadCsv("fleet.csv", [["Vehicle", "Type", "Temperature", "Depot", "Weight capacity (kg)", "Volume capacity (m3)", "Status", "Fuel status", "Maintenance"], ...filtered.map((v) => [v.code, v.vehicle_type, v.temperature_mode, v.depot_name, v.capacity_kg, v.capacity_vol_m3, v.status, v.weekly_fuel_status, v.maintenance_state ?? "Not recorded"])])}>Export CSV</Button>
        </div>
      </header>

      <div role="search" aria-label="Filter fleet" className="flex flex-wrap items-center gap-4">
        <Input aria-label="Search vehicle" placeholder="Search vehicle..." value={search}
          onChange={(event) => { setSearch(event.target.value); setPage(1); }}
          className="h-10 w-full rounded-md border-border bg-card text-xs shadow-none sm:w-[300px] md:text-xs" />
        <FleetFilter label="All Depots" value={depot} options={options.depots} onChange={(value) => { setDepot(value); setPage(1); }} />
        <FleetFilter label="Vehicle Type" value={type} options={options.types} onChange={(value) => { setType(value); setPage(1); }} />
        <FleetFilter label="Temperature" value={temperature} options={options.temperatures} onChange={(value) => { setTemperature(value); setPage(1); }} />
        <FleetFilter label="All statuses" value={status} options={["available", "allocated", "loading", "unavailable"]} onChange={(value) => { setStatus(value); setPage(1); }} />
        {hasFilters && <Button variant="ghost" className="h-10 text-xs" onClick={clearFilters}>Clear filters</Button>}
      </div>

      <section aria-label="Fleet summary" className="grid grid-cols-2 gap-4 lg:grid-cols-5 lg:gap-5">
        {metrics.map(([label, value]) => <MetricCard key={label} label={label} value={loading || error ? "—" : value}
          className="h-24 rounded-lg py-0 shadow-none ring-0" />)}
      </section>

      {error && <Alert variant="destructive">
        <AlertTitle>Fleet unavailable</AlertTitle>
        <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
          <p>{error}</p>
          <Button variant="outline" onClick={() => { setError(null); setLoading(true); setRequest((value) => value + 1); }}>Retry</Button>
        </AlertDescription>
      </Alert>}

      <Card className="min-h-[650px] gap-0 rounded-lg border border-border py-0 shadow-none ring-0">
        <CardHeader className="gap-1 px-5 pt-5 pb-4">
          <CardTitle className="text-lg font-semibold">Fleet Roster</CardTitle>
          <CardDescription className="text-xs" aria-live="polite">
            {loading ? "Loading fleet specifications…" : error ? "Fleet specifications are currently unavailable." :
              `${vehicles.length} vehicles · ${hasFilters ? `${filtered.length} matching your filters` : "vehicle specifications and operating limits"}.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="px-5 pb-5" aria-busy={loading}>
          <Table className="min-w-[960px] table-fixed text-xs">
            <TableHeader><TableRow className="hover:bg-transparent">
              {columns.map((column) => <TableHead key={column} scope="col" className="h-11 px-2 text-xs font-semibold first:pl-0 last:text-center">{column}</TableHead>)}
            </TableRow></TableHeader>
            <TableBody>
              {loading ? Array.from({ length: PAGE_SIZE }, (_, index) => <TableRow key={index} className="h-[70px]">
                {columns.map((column) => <TableCell key={column}><Skeleton className="h-4 w-16" /></TableCell>)}
              </TableRow>) : error ? <TableRow><TableCell colSpan={9} className="h-48 text-center text-muted-foreground">Retry to load vehicle specifications.</TableCell></TableRow> :
                visible.length === 0 ? <TableRow><TableCell colSpan={9} className="h-48 text-center">
                  <p className="font-medium">{hasFilters ? "No vehicles match your filters" : "No vehicles in the fleet yet"}</p>
                  <p className="mt-2 text-muted-foreground">{hasFilters ? "Try another vehicle code or clear the filters." : "Vehicles will appear here once they are added to the fleet."}</p>
                  {hasFilters && <Button variant="outline" className="mt-4" onClick={clearFilters}>Clear filters</Button>}
                </TableCell></TableRow> : visible.map((vehicle) => <TableRow key={vehicle.id} className="h-[70px]">
                  <TableCell className="pl-0 font-semibold">{vehicle.code}</TableCell>
                  <TableCell className="text-muted-foreground">{vehicle.vehicle_type}</TableCell>
                  <TableCell className="text-muted-foreground">{vehicle.temperature_mode}</TableCell>
                  <TableCell className="whitespace-normal capitalize text-muted-foreground">{vehicle.depot_name}</TableCell>
                  <TableCell>{formatCapacity(vehicle.capacity_kg, "kg")}</TableCell>
                  <TableCell>{formatCapacity(vehicle.capacity_vol_m3, "m³")}</TableCell>
                  <TableCell className="capitalize text-muted-foreground">{vehicle.status}</TableCell>
                  <TableCell className="whitespace-normal break-words text-muted-foreground">{vehicle.weekly_fuel_status}</TableCell>
                  <TableCell className="text-center"><div className="flex flex-col gap-2"><VehicleDetails vehicle={vehicle} /><Button size="sm" variant="outline" aria-label={`Edit ${vehicle.code}`} onClick={() => setEditor(vehicle)}>Edit</Button></div></TableCell>
                </TableRow>)}
            </TableBody>
          </Table>
          {!loading && !error && vehicles.length > 0 && <p className="mt-4 text-xs text-muted-foreground">Fuel and maintenance statuses describe the current state. Service history and numeric fuel transactions are not stored yet.</p>}
          {!loading && !error && filtered.length > PAGE_SIZE && <nav aria-label="Fleet pagination" className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4 text-xs text-muted-foreground">
            <span>Showing {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filtered.length)} of {filtered.length} vehicles</span>
            <div className="flex items-center gap-3">
              <Button variant="outline" size="sm" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Previous</Button>
              <span>Page {currentPage} of {pageCount}</span>
              <Button variant="outline" size="sm" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>Next</Button>
            </div>
          </nav>}
        </CardContent>
      </Card>
      {editor && <VehicleEditor vehicle={editor === "new" ? undefined : editor} onClose={() => setEditor(null)} onSaved={(saved) => {
        setVehicles((current) => [...current.filter((v) => v.id !== saved.id), saved].sort((a, b) => a.code.localeCompare(b.code, "en", { numeric: true })));
        clearFilters();
      }} />}
    </div>
  );
}
