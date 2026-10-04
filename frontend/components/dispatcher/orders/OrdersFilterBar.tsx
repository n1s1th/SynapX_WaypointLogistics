"use client";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, CalendarDays, RotateCcw } from "lucide-react";

interface OrdersFilterBarProps {
  searchQuery: string;
  onSearchChange: (val: string) => void;
  statusFilter: string;
  onStatusChange: (val: string) => void;
  brandFilter: string;
  onBrandChange: (val: string) => void;
  districtFilter: string;
  onDistrictChange: (val: string) => void;
  dateFilter: string;
  onDateChange: (val: string) => void;
  temperatureFilter: string;
  onTemperatureChange: (val: string) => void;
  sortOrder: string;
  onSortChange: (val: string) => void;
  onReset: () => void;
}

export function OrderFilterSelect({ label, value, onChange, options }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: [string, string][];
}) {
  return <Select value={value} onValueChange={onChange}>
    <SelectTrigger aria-label={label} className="h-9 w-full bg-card border-border text-xs shadow-none">
      <SelectValue />
    </SelectTrigger>
    <SelectContent>{options.map(([key, title]) => <SelectItem key={key} value={key}>{title}</SelectItem>)}</SelectContent>
  </Select>;
}

export function OrdersFilterBar(props: OrdersFilterBarProps) {
  const selectedDate = props.dateFilter ? new Date(props.dateFilter + "T00:00:00") : undefined;
  const hasFilters = !!props.searchQuery || props.statusFilter !== "all" || props.brandFilter !== "all" || props.districtFilter !== "all" || props.temperatureFilter !== "all" || !!props.dateFilter || props.sortOrder !== "newest";
  return <div className="rounded-lg border border-border bg-card p-4 space-y-3">
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative min-w-48 flex-1">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input aria-label="Search orders" placeholder="Search order, outlet or address…" value={props.searchQuery} onChange={(event) => props.onSearchChange(event.target.value)} className="h-9 pl-9 text-xs border-border shadow-none" />
      </div>
      <div className="w-40"><OrderFilterSelect label="Order sorting" value={props.sortOrder} onChange={props.onSortChange} options={[["newest", "Newest first"], ["oldest", "Oldest first"]]} /></div>
      <Button variant="ghost" size="sm" onClick={props.onReset} disabled={!hasFilters} className="text-xs"><RotateCcw className="size-3.5" />Reset filters</Button>
    </div>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      <OrderFilterSelect label="Order status" value={props.statusFilter} onChange={props.onStatusChange} options={[["all", "All statuses"], ["unallocated", "Unallocated"], ["submitted", "Submitted"], ["confirmed", "Confirmed"], ["priority", "Priority"], ["allocated", "Allocated"], ["deferred", "Deferred"], ["dispatched", "Dispatched"], ["delivered", "Delivered"], ["completed", "Completed"], ["cancelled", "Cancelled"]]} />
      <OrderFilterSelect label="Brand" value={props.brandFilter} onChange={props.onBrandChange} options={[["all", "All brands"], ["Fresh", "Fresh"], ["Style", "Style"], ["Tech", "Tech"]]} />
      <OrderFilterSelect label="District" value={props.districtFilter} onChange={props.onDistrictChange} options={[["all", "All districts"], ...["Badulla", "Colombo", "Galle", "Gampaha", "Kalutara", "Kandy", "Kegalle", "Kurunegala", "Matale", "Matara", "Nuwara Eliya", "Puttalam"].map((district): [string, string] => [district, district])]} />
      <OrderFilterSelect label="Temperature" value={props.temperatureFilter} onChange={props.onTemperatureChange} options={[["all", "All temperatures"], ["Chilled", "Chilled"], ["Ambient", "Ambient"]]} />
      <Popover>
        <PopoverTrigger asChild><Button variant="outline" aria-label="Filter by operating date" className="h-9 justify-between border-border text-xs font-normal"><span>{selectedDate ? selectedDate.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "All operating dates"}</span><CalendarDays className="size-3.5 text-muted-foreground" /></Button></PopoverTrigger>
        <PopoverContent align="end" className="w-auto p-2">
          <Calendar mode="single" selected={selectedDate} defaultMonth={selectedDate} onSelect={(date) => props.onDateChange(date ? [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-") : "")} />
          <Button variant="ghost" size="sm" className="w-full text-xs" onClick={() => props.onDateChange("")}>All operating dates</Button>
        </PopoverContent>
      </Popover>
    </div>
  </div>;
}
