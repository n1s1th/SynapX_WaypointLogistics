"use client";

import { useEffect, useState } from "react";
import { MetricCard } from "@/components/domain/metric-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetTrigger } from "@/components/ui/sheet";
import { Choice, DataGate, ModuleHeader, Notice, PagedTable, Panel } from "@/components/dispatcher/operations/shared";
import { downloadCsv } from "@/components/dispatcher/operations/data";
import { exceptionDate, fetchOperationExceptions, type OperationException } from "@/components/dispatcher/operations/exceptions";

function ExceptionDetails({ item }: { item: OperationException }) {
  return <Sheet><SheetTrigger asChild><Button variant="outline" aria-label={`View ${item.title} ${item.id}`}>View</Button></SheetTrigger><SheetContent className="data-[side=right]:w-full overflow-y-auto sm:max-w-xl">
    <SheetHeader><SheetTitle>{item.title}</SheetTitle><SheetDescription className="capitalize">{item.source} · {item.status.replaceAll("_", " ")}</SheetDescription></SheetHeader>
    <div className="space-y-5 px-4 pb-6 text-sm"><p>{item.detail}</p><dl className="grid grid-cols-2 gap-4">{[
      ["Source", item.source], ["Reference", item.reference || "Not recorded"], ["Trip", item.trip_code || "Not linked"], ["Driver", item.driver_name || "Not recorded"], ["Recorded at", exceptionDate(item.reported_at)], ["Status", item.status.replaceAll("_", " ")],
    ].map(([label, value]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="break-words font-medium capitalize">{value}</dd></div>)}</dl>
      <Notice>Reported incidents come from their source workflow. Passed ETAs, stale run updates, and missing POD are checks that need confirmation. Decisions, acknowledgements, and resolution remain in their respective workflows.</Notice>
    </div>
  </SheetContent></Sheet>;
}

export default function ExceptionsPage() {
  const [data, setData] = useState<OperationException[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState<string | null>(null);
  const [request, setRequest] = useState(0);
  const [search, setSearch] = useState("");
  const [source, setSource] = useState("all");
  const [page, setPage] = useState(1);
  useEffect(() => {
    const controller = new AbortController();
    fetchOperationExceptions(AbortSignal.any([controller.signal, AbortSignal.timeout(30000)])).then((rows) => {
      if (!controller.signal.aborted) { setData(rows); setChecked(new Date().toISOString()); }
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Exceptions could not be loaded.");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [request]);
  function refresh() { setLoading(true); setError(null); setRequest((n) => n + 1); }
  const filtered = data.filter((item) => (source === "all" || item.source === source) && [item.title, item.detail, item.reference, item.trip_code, item.driver_name].filter(Boolean).join(" ").toLowerCase().includes(search.trim().toLowerCase()));
  return <div className="space-y-6">
    <ModuleHeader title="Exceptions" description="Review current loader, driver and shipment issues in one dispatcher view." loading={loading} refresh={refresh}>
      <Button variant="outline" disabled={loading || !!error || !filtered.length} onClick={() => downloadCsv("dispatcher-exceptions.csv", [["Source", "Exception", "Severity", "Status", "Reference", "Trip", "Driver", "Detail", "Recorded (Asia/Colombo)", "Checked (UTC)"], ...filtered.map((item) => [item.source, item.title, item.severity, item.status, item.reference ?? "", item.trip_code ?? "", item.driver_name ?? "", item.detail, exceptionDate(item.reported_at), checked ?? ""])])}>Export CSV</Button>
    </ModuleHeader>
    <Notice>Loader shortfalls, driver issue reports and SOS alerts are recorded incidents. Failed shipments also appear here. Passed trip ETAs, stale run updates and delivered stops without POD are checks for the dispatcher, not confirmed offline or delivery failures.</Notice>
    <DataGate loading={loading} error={error} retry={refresh}>
      <section aria-label="Exception summary" className="grid gap-4 sm:grid-cols-4"><MetricCard label="Total exceptions" value={data.length} /><MetricCard label="Loader" value={data.filter((item) => item.source === "loader").length} /><MetricCard label="Driver" value={data.filter((item) => item.source === "driver").length} /><MetricCard label="Tracking" value={data.filter((item) => item.source === "tracking").length} /></section>
      <p className="text-xs text-muted-foreground">Checked at {exceptionDate(checked)} (Asia/Colombo). Refresh to see new reports or decisions.</p>
      <div role="search" aria-label="Filter exceptions" className="flex flex-wrap gap-3"><Input aria-label="Search exceptions" placeholder="Search issue, trip, driver, reference…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="h-10 bg-card sm:max-w-sm" /><Choice label="Exception source" value={source} onChange={(value) => { setSource(value); setPage(1); }} options={[{ value: "all", label: "All sources" }, { value: "loader", label: "Loader" }, { value: "driver", label: "Driver" }, { value: "tracking", label: "Tracking" }]} />{(search || source !== "all") && <Button variant="ghost" onClick={() => { setSearch(""); setSource("all"); setPage(1); }}>Clear filters</Button>}</div>
      <Panel title="Current exceptions"><PagedTable label="Exceptions" page={page} onPage={setPage} columns={["Source", "Exception", "Reference / trip", "Status", "Recorded", "Action"]} empty={!data.length ? "No current exceptions were found." : "No exceptions match your filters."} rows={filtered.map((item) => ({ key: item.id, cells: [<span key="source" className="capitalize">{item.source}</span>, <Badge key="title" className={`border-0 ${item.severity === "critical" ? "bg-destructive-muted text-destructive" : "bg-warning-muted text-warning"}`}>{item.title}</Badge>, <div key="reference">{item.reference || "—"}<p className="text-xs text-muted-foreground">{item.trip_code || "No trip linked"}</p></div>, <span key="status" className="capitalize">{item.status.replaceAll("_", " ")}</span>, exceptionDate(item.reported_at), <ExceptionDetails key="details" item={item} />] }))} /></Panel>
    </DataGate>
  </div>;
}
