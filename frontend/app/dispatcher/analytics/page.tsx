"use client";

import { useState } from "react";
import { MetricCard } from "@/components/domain/metric-card";
import { Button } from "@/components/ui/button";
import { useOrders } from "@/components/dispatcher/operations/use-orders";
import { dailyCounts, downloadCsv, groupDestinations, isOpen, orderDay, shiftDay } from "@/components/dispatcher/operations/data";
import { Bars, Choice, DataGate, ModuleHeader, Notice, PagedTable, Panel, Status } from "@/components/dispatcher/operations/shared";

export default function AnalyticsPage() {
  const source = useOrders();
  const [period, setPeriod] = useState("30");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const today = source.updated ? orderDay(source.updated) : "";
  const start = today ? shiftDay(today, 1 - Number(period)) : "";
  const cohort = source.data.filter((o) => { const day = orderDay(o.created_at); return day >= start && day <= today; });
  const orders = cohort.filter((o) => status === "all" || o.status === status).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const statuses = [...new Set(cohort.map((o) => o.status))].sort();
  const daily = today ? dailyCounts(cohort, start, today) : [];
  const delivered = cohort.filter((o) => o.status === "delivered").length;
  const cancelled = cohort.filter((o) => o.status === "cancelled").length;
  return <div className="space-y-6">
    <ModuleHeader title="Analytics" description="Understand order intake and the current outcomes of orders created in a selected period." loading={source.loading} refresh={source.refresh}>
      <Button variant="outline" disabled={source.loading || !!source.error || !orders.length} onClick={() => downloadCsv("order-analytics.csv", [["Order", "Customer", "Address", "Created date (Asia/Colombo)", "Current status"], ...orders.map((o) => [o.order_number, o.client_name, o.destination_address, orderDay(o.created_at), o.status])])}>Export CSV</Button>
    </ModuleHeader>
    <Notice>Metrics describe orders by creation date and their status now—not deliveries completed during that period. On-time delivery, historical utilization, and fuel efficiency need additional operational records.</Notice>
    <div className="flex flex-wrap items-center gap-3"><Choice label="Reporting period" value={period} onChange={(v) => { setPeriod(v); setStatus("all"); setPage(1); }} options={[7, 30, 90].map((n) => ({ value: String(n), label: `Last ${n} days` }))} /><span className="text-xs text-muted-foreground">{today ? `${start} to ${today} · Asia/Colombo · includes today` : "Dates use Asia/Colombo"}</span></div>
    <DataGate loading={source.loading} error={source.error} retry={source.refresh}>
      <section aria-label="Order summary" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Orders created" value={cohort.length} />
        <MetricCard label="Currently open" value={cohort.filter(isOpen).length} />
        <MetricCard label="Currently delivered" value={delivered} subtext={cohort.length ? `${(delivered / cohort.length * 100).toFixed(1)}% of all orders in this period` : "No orders in this period"} />
        <MetricCard label="Currently cancelled" value={cancelled} />
      </section>
      {!cohort.length ? <Panel title="No orders in this period"><p className="text-sm text-muted-foreground">Try a longer reporting period. No performance rate can be calculated for an empty cohort.</p></Panel> : <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Current status breakdown"><Bars rows={statuses.map((s) => ({ label: s, value: cohort.filter((o) => o.status === s).length }))} /></Panel>
        <Panel title="Top destinations by order count"><Bars rows={groupDestinations(cohort).sort((a, b) => b.orders.length - a.orders.length).slice(0, 5).map((d) => ({ label: `${d.name} · ${d.address}`, value: d.orders.length }))} /></Panel>
      </div>}
      <Panel title="Daily order intake"><p className="mb-4 text-xs text-muted-foreground">Counts use creation timestamps. Zero means no orders are recorded for that date; it does not confirm source completeness.</p><div className="max-h-80 overflow-y-auto pr-3"><Bars rows={daily.map((d) => ({ label: d.day, value: d.count }))} /></div></Panel>
      <Panel title="Underlying orders"><div className="mb-4"><Choice label="Filter underlying orders by status" value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={[{ value: "all", label: "All statuses" }, ...statuses.map((s) => ({ value: s, label: s }))]} /></div>
        <PagedTable label="Underlying orders" page={page} onPage={setPage} columns={["Order", "Customer", "Destination", "Created", "Current status"]} rows={orders.map((o) => ({ key: o.id, cells: [o.order_number, o.client_name, o.destination_address, orderDay(o.created_at), <Status key="status" value={o.status} />] }))} />
      </Panel>
    </DataGate>
  </div>;
}
