"use client";

import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from "@/components/ui/sheet";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Route, ArrowRight, RefreshCw, AlertCircle, Package, Snowflake } from "lucide-react";
import { OrderFilterSelect } from "./OrdersFilterBar";
import { getSuggestedGroups } from "@/lib/allocation-api";
import { DEPOT_CHANGE_EVENT } from "@/lib/dispatcher-depot";
import type { OrderGroupSuggestion } from "@/types/allocation";

const numberFormat = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 });
const formatDate = (value: string | null) => value
  ? new Date(value + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
  : "Date unknown";

export function RouteGroupSuggestions({ open, onClose, onReview, initialBrand = "all", initialDistrict = "all", initialDate = "" }: {
  open: boolean;
  onClose: () => void;
  onReview: (ids: number[]) => void;
  initialBrand?: string;
  initialDistrict?: string;
  initialDate?: string;
}) {
  const [groups, setGroups] = useState<OrderGroupSuggestion[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [brand, setBrand] = useState(initialBrand);
  const [district, setDistrict] = useState(initialDistrict);
  const [date, setDate] = useState(initialDate || "all");
  const [dismissed, setDismissed] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    getSuggestedGroups().then((data) => {
      if (active) { setGroups(data); setError(""); }
    }).catch((err) => {
      if (active) setError(err instanceof Error ? err.message : "Could not load route groups.");
    }).finally(() => { if (active) setLoading(false); });
    const onDepotChange = () => onClose();
    window.addEventListener(DEPOT_CHANGE_EVENT, onDepotChange);
    return () => { active = false; window.removeEventListener(DEPOT_CHANGE_EVENT, onDepotChange); };
  }, [open, refreshKey, onClose]);

  const refresh = () => { setLoading(true); setError(""); setRefreshKey((value) => value + 1); };
  const districts = [...new Set([...groups.flatMap((group) => group.district ? [group.district] : []), ...(district !== "all" ? [district] : [])])].sort();
  const dates = [...new Set([...groups.flatMap((group) => group.operating_date ? [group.operating_date] : []), ...(date !== "all" ? [date] : [])])].sort().reverse();
  const visibleGroups = groups.filter((group) =>
    !dismissed.includes(group.order_ids.join("-")) &&
    (brand === "all" || group.brand === brand) &&
    (district === "all" || group.district === district) &&
    (date === "all" || group.operating_date === date)
  ).sort((a, b) => (b.operating_date ?? "").localeCompare(a.operating_date ?? "") || (a.brand ?? "").localeCompare(b.brand ?? "") || (a.district ?? "").localeCompare(b.district ?? ""));
  const hasFilters = brand !== "all" || district !== "all" || date !== "all";
  const clearFilters = () => { setBrand("all"); setDistrict("all"); setDate("all"); };

  return <Sheet open={open} onOpenChange={(value) => !value && onClose()}>
    <SheetContent side="right" className="data-[side=right]:w-full data-[side=right]:sm:max-w-4xl gap-0 p-0 bg-background">
      <SheetHeader className="border-b border-border bg-card p-6 pr-14">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-accent p-2 text-primary"><Route className="size-5" /></div>
          <div>
            <SheetTitle className="text-xl font-bold">Suggested route groups</SheetTitle>
            <SheetDescription className="mt-1 text-xs">Review compatible orders together, then choose a vehicle and departure time.</SheetDescription>
          </div>
        </div>
      </SheetHeader>
      <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">Grouped by operating date, brand and district.</p>
          <Button size="sm" variant="outline" onClick={refresh} disabled={loading} className="bg-card text-xs"><RefreshCw className={loading ? "size-3.5 animate-spin" : "size-3.5"} />Refresh</Button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <OrderFilterSelect label="Group brand" value={brand} onChange={setBrand} options={[["all", "All brands"], ["Fresh", "Fresh"], ["Style", "Style"], ["Tech", "Tech"]]} />
          <OrderFilterSelect label="Group district" value={district} onChange={setDistrict} options={[["all", "All districts"], ...districts.map((value): [string, string] => [value, value])]} />
          <OrderFilterSelect label="Group operating date" value={date} onChange={setDate} options={[["all", "All operating dates"], ...dates.map((value): [string, string] => [value, formatDate(value)])]} />
        </div>
        {error ? <Alert variant="destructive"><AlertCircle /><AlertDescription>{error}<Button variant="outline" size="sm" onClick={refresh} className="mt-2 w-fit">Try again</Button></AlertDescription></Alert> : null}
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
            <div><h3 className="text-sm font-semibold">Available groups</h3><p className="text-xs text-muted-foreground mt-0.5">{loading ? "Loading suggestions…" : visibleGroups.length + " groups · latest operating date first"}</p></div>
            {hasFilters && <Button size="sm" variant="ghost" onClick={clearFilters} className="text-xs">Clear filters</Button>}
          </div>
          {loading ? <div role="status" className="p-12 text-center text-sm text-muted-foreground">Loading route groups…</div> : !error && visibleGroups.length === 0 ? <div className="p-10 text-center space-y-2">
            <Route className="mx-auto size-6 text-muted-foreground" />
            <p className="text-sm font-medium">No route groups to show</p>
            <p className="text-xs text-muted-foreground">{hasFilters ? "Try another brand, district or operating date." : "Eligible unallocated orders will appear here."}</p>
          </div> : !error ? <Table className="min-w-[640px] text-xs">
            <TableHeader className="bg-muted/40"><TableRow>
              <TableHead className="pl-4">Route group</TableHead><TableHead>Orders / outlets</TableHead><TableHead className="text-right">Load</TableHead><TableHead className="pr-4 text-right">Actions</TableHead>
            </TableRow></TableHeader>
            <TableBody>{visibleGroups.map((group) => {
              const key = group.order_ids.join("-");
              const chilled = ["chilled", "reefer"].includes(group.required_temperature.toLowerCase());
              return <TableRow key={key}>
                <TableCell className="p-4"><div className="font-semibold text-foreground">{group.district ?? "Unknown district"} <span className="font-normal text-muted-foreground">· {group.brand ?? "Unknown brand"}</span></div>
                  <div className="mt-1 text-muted-foreground">{formatDate(group.operating_date)} · {group.depot}</div>
                  <Badge variant="outline" className={chilled ? "mt-2 border-info/20 bg-info-muted text-info" : "mt-2 border-border bg-muted text-muted-foreground"}>{chilled ? <Snowflake className="size-3" /> : <Package className="size-3" />}{group.required_temperature}</Badge>
                  {group.required_vehicle_type === "van" && <div className="mt-2 text-xs text-warning">
                    <span className="font-semibold">Van required</span> · {group.van_only_outlets?.join(", ")}
                    <p>{chilled ? "Requires a reefer van. Trucks / lorries cannot serve this group." : "Trucks / lorries cannot serve this group."}</p>
                  </div>}
                </TableCell>
                <TableCell><div className="font-semibold">{group.order_ids.length} orders</div><div className="mt-1 text-muted-foreground">{group.outlet_count} outlets</div></TableCell>
                <TableCell className="text-right tabular-nums"><div className="font-semibold">{group.total_weight_kg == null ? "Unknown weight" : numberFormat.format(group.total_weight_kg) + " kg"}</div><div className="mt-1 text-muted-foreground">{group.total_volume_m3 == null ? "Unknown volume" : numberFormat.format(group.total_volume_m3) + " m³"}</div></TableCell>
                <TableCell className="pr-4"><div className="flex flex-col items-end gap-1"><Button size="sm" className="h-8 text-xs" aria-label={"Review " + (group.brand ?? "") + " " + (group.district ?? "") + " group for " + formatDate(group.operating_date)} onClick={() => onReview(group.order_ids)}>Review group<ArrowRight className="size-3.5" /></Button><Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" onClick={() => setDismissed((current) => [...current, key])}>Dismiss</Button></div></TableCell>
              </TableRow>;
            })}</TableBody>
          </Table> : null}
        </div>
        {dismissed.length > 0 && <Button variant="ghost" size="sm" className="text-xs" onClick={() => setDismissed([])}>Restore dismissed groups ({dismissed.length})</Button>}
      </div>
      <SheetFooter className="border-t border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">Vehicle capacity and delivery windows are checked during review.</p>
        <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
      </SheetFooter>
    </SheetContent>
  </Sheet>;
}
