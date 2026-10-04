"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableHead, TableHeader, TableRow, TableCell, TableBody } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";

export function ModuleHeader({ title, description, loading, refresh, children }: { title: string; description: string; loading: boolean; refresh: () => void; children?: ReactNode }) {
  return <header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-3xl font-bold tracking-tight">{title}</h1><p className="mt-2 max-w-3xl text-sm text-muted-foreground">{description}</p></div><div className="flex gap-2"><Button variant="outline" disabled={loading} onClick={refresh}>Refresh</Button>{children}</div></header>;
}

export function DataGate({ loading, error, retry, children }: { loading: boolean; error: string | null; retry: () => void; children: ReactNode }) {
  if (loading) return <div role="status" aria-label="Loading data" className="space-y-4"><p className="text-sm text-muted-foreground">Loading records…</p><Skeleton className="h-24 w-full" /><Skeleton className="h-72 w-full" /></div>;
  if (error) return <Alert variant="destructive"><AlertTitle>Data unavailable</AlertTitle><AlertDescription><p>{error} No report is displayed from incomplete data.</p><Button variant="outline" className="mt-3" onClick={retry}>Retry</Button></AlertDescription></Alert>;
  return <>{children}</>;
}

export function Choice({ label, value, options, onChange }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void }) {
  return <Select value={value} onValueChange={onChange}><SelectTrigger aria-label={label} className="w-full border-border bg-card data-[size=default]:h-10 sm:w-48"><SelectValue /></SelectTrigger><SelectContent>{options.map((item) => <SelectItem value={item.value} key={item.value}>{item.label}</SelectItem>)}</SelectContent></Select>;
}

export function Status({ value }: { value: string }) {
  const style = value === "delivered" ? "bg-success-muted text-success" : value === "cancelled" ? "bg-muted text-muted-foreground" : "bg-info-muted text-info";
  return <Badge className={`border-0 capitalize ${style}`}>{value.replaceAll("_", " ")}</Badge>;
}

export function PagedTable({ columns, rows, page, onPage, empty = "No records found.", label = "Results" }: { columns: string[]; rows: { key: string | number; cells: ReactNode[] }[]; page: number; onPage: (page: number) => void; empty?: string; label?: string }) {
  const pages = Math.max(1, Math.ceil(rows.length / 10));
  const current = Math.min(page, pages);
  return <><Table className="dispatcher-table"><caption className="sr-only">{label}</caption><TableHeader><TableRow>{columns.map((column) => <TableHead key={column} scope="col">{column}</TableHead>)}</TableRow></TableHeader><TableBody>{rows.length ? rows.slice((current - 1) * 10, current * 10).map((row) => <TableRow key={row.key}>{row.cells.map((cell, index) => <TableCell key={columns[index]} className="h-16 max-w-sm whitespace-normal break-words">{cell}</TableCell>)}</TableRow>) : <TableRow><TableCell colSpan={columns.length} className="h-40 text-center text-muted-foreground">{empty}</TableCell></TableRow>}</TableBody></Table><nav aria-label={`${label} pagination`} className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground"><span>{rows.length} records · Page {current} of {pages}</span><div className="flex gap-2"><Button size="sm" variant="outline" disabled={current === 1} onClick={() => onPage(current - 1)}>Previous</Button><Button size="sm" variant="outline" disabled={current === pages} onClick={() => onPage(current + 1)}>Next</Button></div></nav></>;
}

export function Panel({ title, children }: { title: string; children: ReactNode }) {
  return <Card className="rounded-lg border border-border shadow-none ring-0"><CardHeader><CardTitle><h2>{title}</h2></CardTitle></CardHeader><CardContent>{children}</CardContent></Card>;
}

export function Bars({ rows }: { rows: { label: string; value: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return <ul className="space-y-4">{rows.map((row) => <li key={row.label}><div className="mb-2 flex justify-between gap-4 text-xs"><span className="capitalize">{row.label.replaceAll("_", " ")}</span><span className="font-semibold tabular-nums">{row.value}</span></div><Progress aria-label={`${row.label}: ${row.value}`} value={row.value / max * 100} /></li>)}</ul>;
}
