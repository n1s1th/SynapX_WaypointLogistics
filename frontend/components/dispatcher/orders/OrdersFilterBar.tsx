"use client";

import React from "react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, Calendar } from "lucide-react";

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
  onDateChange?: (val: string) => void;
}

export function OrdersFilterBar({
  searchQuery,
  onSearchChange,
  statusFilter,
  onStatusChange,
  brandFilter,
  onBrandChange,
  districtFilter,
  onDistrictChange,
  dateFilter,
}: OrdersFilterBarProps) {
  return (
    <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3 w-full">
      {/* Search Input */}
      <div className="relative flex-1 min-w-[240px]">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          placeholder="Search orders..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-9 h-10 text-xs bg-card border-border rounded-md shadow-none focus-visible:ring-1 focus-visible:ring-[#18385F]"
        />
      </div>

      {/* Status Filter */}
      <div className="w-full sm:w-[150px]">
        <Select value={statusFilter} onValueChange={onStatusChange}>
          <SelectTrigger className="h-10 text-xs bg-card border-border rounded-md shadow-none">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent className="text-xs">
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="unallocated">Unallocated</SelectItem>
            <SelectItem value="submitted">Submitted</SelectItem>
            <SelectItem value="confirmed">Confirmed</SelectItem>
            <SelectItem value="priority">Priority</SelectItem>
            <SelectItem value="allocated">Allocated</SelectItem>
            <SelectItem value="deferred">Deferred</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Brand Filter */}
      <div className="w-full sm:w-[140px]">
        <Select value={brandFilter} onValueChange={onBrandChange}>
          <SelectTrigger className="h-10 text-xs bg-card border-border rounded-md shadow-none">
            <SelectValue placeholder="Brand" />
          </SelectTrigger>
          <SelectContent className="text-xs">
            <SelectItem value="all">All Brands</SelectItem>
            <SelectItem value="Fresh">Fresh</SelectItem>
            <SelectItem value="Style">Style</SelectItem>
            <SelectItem value="Tech">Tech</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* District Filter */}
      <div className="w-full sm:w-[150px]">
        <Select value={districtFilter} onValueChange={onDistrictChange}>
          <SelectTrigger className="h-10 text-xs bg-card border-border rounded-md shadow-none">
            <SelectValue placeholder="District" />
          </SelectTrigger>
          <SelectContent className="text-xs">
            <SelectItem value="all">All Districts</SelectItem>
            <SelectItem value="Colombo">Colombo</SelectItem>
            <SelectItem value="Gampaha">Gampaha</SelectItem>
            <SelectItem value="Kandy">Kandy</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Operating Date */}
      <div className="w-full sm:w-[150px] relative">
        <div className="flex items-center justify-between px-3 h-10 rounded-md border border-border bg-card text-xs font-medium text-foreground cursor-pointer hover:bg-muted/30">
          <span>{dateFilter || "26 Sep 2026"}</span>
          <Calendar className="size-3.5 text-muted-foreground ml-2 shrink-0" />
        </div>
      </div>
    </div>
  );
}
