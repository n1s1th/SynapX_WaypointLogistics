"use client";

import { useState } from "react";
import { MetricCard } from "@/components/domain/metric-card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useOrders } from "@/components/dispatcher/operations/use-orders";
import { downloadCsv, forecastOrders, orderDay } from "@/components/dispatcher/operations/data";
import { Bars, Choice, DataGate, ModuleHeader, Notice, PagedTable, Panel } from "@/components/dispatcher/operations/shared";

export default function ForecastsPage() {
  const source = useOrders();
  const [windowDays, setWindowDays] = useState("28");
  const [horizon, setHorizon] = useState("7");
  const [complete, setComplete] = useState(false);
  const [page, setPage] = useState(1);
  const today = source.updated ? orderDay(source.updated) : "";
  const result = today ? forecastOrders(source.data, today, Number(windowDays), Number(horizon)) : null;
  const ready = Boolean(result?.eligible && complete);
  function refresh() { setComplete(false); source.refresh(); }
  return <div className="space-y-6">
    <ModuleHeader title="Forecasts" description="Explore a baseline estimate of future order intake using recorded history." loading={source.loading} refresh={refresh}>
      <Button variant="outline" disabled={source.loading || !!source.error || !ready} onClick={() => { if (result) downloadCsv("order-intake-estimate.csv", [["Forecast date (Asia/Colombo)", "Estimated orders", "Method", "History start", "History end", "Generated at", "Assumption"], ...result.predictions.map((d) => [d.day, d.count.toFixed(2), "Daily average", result.start, result.end, source.updated ?? "", "User confirmed complete history; days without orders counted as zero"])]); }}>Export estimate</Button>
    </ModuleHeader>
    <Notice>This is an exploratory daily-average baseline, not a validated demand model. It predicts order creation counts, not delivery dates or vehicle requirements. Estimates are calculated on demand and are not saved.</Notice>
    <div className="flex flex-wrap gap-3">
      <Choice label="History window" value={windowDays} onChange={(v) => { setWindowDays(v); setComplete(false); setPage(1); }} options={[14, 28, 56].map((n) => ({ value: String(n), label: `${n} complete history days` }))} />
      <Choice label="Forecast horizon" value={horizon} onChange={(v) => { setHorizon(v); setPage(1); }} options={[7, 14].map((n) => ({ value: String(n), label: `Next ${n} days` }))} />
    </div>
    <DataGate loading={source.loading} error={source.error} retry={refresh}>
      {result && <>
        <Panel title="History and assumptions"><p className="text-sm">History: {result.start} to {result.end} · Asia/Colombo</p><p className="mt-2 text-xs text-muted-foreground">Today is excluded because it is incomplete. All recorded orders are counted, including drafts and cancellations. No seasonality, trend, or confidence interval is estimated.</p>
          {!result.eligible ? <p className="mt-4 rounded-md bg-warning-muted p-4 text-sm text-warning-muted-foreground">Insufficient history. At least {windowDays} calendar days of records and some orders in that window are needed. Try a shorter window or return when more history is available.</p> : <div className="mt-4 flex items-start gap-3 rounded-md border border-border p-4"><Checkbox id="complete-history" checked={complete} onCheckedChange={(value) => setComplete(value === true)} /><Label htmlFor="complete-history" className="leading-relaxed">I confirm this history is complete. Days without recorded orders should count as zero in this estimate.</Label></div>}
        </Panel>
        <section aria-label="Forecast summary" className="grid gap-4 sm:grid-cols-3"><MetricCard label="Recorded orders in window" value={result.total} /><MetricCard label="Estimated orders per day" value={ready ? result.mean.toFixed(1) : "—"} /><MetricCard label={`Estimated next ${horizon} days`} value={ready ? (result.mean * Number(horizon)).toFixed(1) : "—"} /></section>
        {ready ? <Panel title="Order intake estimate"><p className="mb-4 text-xs text-muted-foreground">Each day uses {result.total} recorded orders ÷ {windowDays} days. Fractional values are expected averages. Validate against future observations before using this for staffing or dispatch decisions.</p><PagedTable label="Forecast days" columns={["Date", "Estimated orders", "Method"]} page={page} onPage={setPage} rows={result.predictions.map((d) => ({ key: d.day, cells: [d.day, d.count.toFixed(1), `${windowDays}-day average`] }))} /></Panel> : <Panel title="Estimate not generated"><p className="text-sm text-muted-foreground">{result.eligible ? "Confirm the history assumption above to view an estimate." : "More historical data is needed before an estimate can be generated."}</p></Panel>}
        <Panel title="Recorded history"><div className="max-h-80 overflow-y-auto pr-3"><Bars rows={result.days.map((d) => ({ label: d.day, value: d.count }))} /></div></Panel>
      </>}
    </DataGate>
  </div>;
}
