import React from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge, StatusVariant } from "./StatusBadge";
import { Button } from "@/components/ui/button";
import { TableLoading } from "@/components/ui/table-loading";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface VehicleData {
  code: string;
  vehicle_type: string;
  temperature_mode: string;
  depot_name: string;
  weekly_fuel_status: string;
  trips_today: number;
  trips_planned: number;
  maintenance_state: string | null;
}

interface DriverData {
  user: { full_name: string } | null;
}

export interface Allocation {
  id: number;
  status: string;
  run_id: string | null;
  departure_time: string | null;
  load_percentage: number;
  volume_percentage: number;
  orders: unknown[];
  vehicle: VehicleData | null;
  driver: DriverData | null;
}

interface AllocationTableProps {
  allocations: Allocation[];
  isLoading?: boolean;
  onViewClick: (allocation: Allocation) => void;
}

export function AllocationTable({ allocations, isLoading = false, onViewClick }: AllocationTableProps) {
  const getStatusVariant = (status: string): StatusVariant => {
    switch (status.toLowerCase()) {
      case "allocated":  return "primary";
      case "ready":      return "success";
      case "draft":
      case "review":     return "warning";
      case "loading":    return "warning";
      case "dispatched":
      case "completed":  return "success";
      case "unavailable":
      case "cancelled":  return "destructive";
      default:           return "neutral";
    }
  };

  const getStatusLabel = (status: string): string => {
    if (status.toLowerCase() === "draft") return "Review";
    return status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
  };

  const getActionButton = (allocation: Allocation) => {
    const s = allocation.status.toLowerCase();
    
    // DRAFT/REVIEW: needs dispatcher attention — highlighted solid button
    if (s === "draft" || s === "review") {
      return (
        <Button
          style={{ backgroundColor: "#1c355e", color: "#ffffff" }}
          className="shadow-none px-6 w-[100px]"
          size="sm"
          onClick={() => onViewClick(allocation)}
        >
          Review
        </Button>
      );
    }

    // Everything else (allocated, ready, loading, dispatched, available, unavailable, etc.)
    return (
      <Button
        variant="outline"
        className="border-slate-300 text-[#1c355e] shadow-none px-6 w-[100px]"
        size="sm"
        onClick={() => onViewClick(allocation)}
      >
        View
      </Button>
    );
  };

  const getBarColor = (status: string): string => {
    const s = status.toLowerCase();
    if (s === "draft" || s === "review") return "#c08535";
    return "#1c355e";
  };

  return (
    <Card className="border-border shadow-none">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">Vehicle Allocation Board</CardTitle>
        <CardDescription>
          One row per vehicle. Manage assigned orders, drivers and load readiness.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table className="dispatcher-table">
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="pl-6 px-4 text-left w-[120px] whitespace-nowrap">Vehicle</TableHead>
                <TableHead className="px-4 text-left w-[120px] whitespace-nowrap">Type</TableHead>
                <TableHead className="px-4 text-left w-[160px] whitespace-nowrap">Driver</TableHead>
                <TableHead className="px-4 text-left w-[140px] whitespace-nowrap">Load</TableHead>
                <TableHead className="px-4 text-center w-[80px] whitespace-nowrap">Orders</TableHead>
                <TableHead className="px-4 text-center w-[100px] whitespace-nowrap">Run</TableHead>
                <TableHead className="px-4 text-center w-[100px] whitespace-nowrap">Departure</TableHead>
                <TableHead className="px-4 text-center w-[120px] whitespace-nowrap">Status</TableHead>
                <TableHead className="pr-6 text-center w-[120px] whitespace-nowrap">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={9} className="h-24 text-center">
                    <TableLoading label="Loading allocations..." />
                  </TableCell>
                </TableRow>
              ) : allocations.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={9}
                    className="text-center h-24 text-muted-foreground"
                  >
                    No vehicle allocations found.
                  </TableCell>
                </TableRow>
              ) : (
                allocations.map((allocation) => (
                  <TableRow key={allocation.id} className="hover:bg-muted/30">
                    <TableCell className="pl-6 px-4 text-left py-4">
                      <div className="font-semibold text-foreground">
                        {allocation.vehicle?.code || "Unassigned"}
                      </div>
                    </TableCell>
                    <TableCell className="px-4 text-left py-4">
                      <div className="text-sm text-muted-foreground">
                        {allocation.vehicle?.vehicle_type || "N/A"}
                      </div>
                    </TableCell>
                    <TableCell className="px-4 text-left py-4">
                      <div className="text-sm">
                        {allocation.driver?.user?.full_name || (
                          <span className="text-muted-foreground italic">Unassigned</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="px-4 text-left py-4">
                      <div className="flex flex-col justify-center gap-1.5 w-[80px]">
                        <span className="text-xs font-semibold text-[#1c355e]">
                          {allocation.load_percentage}%
                        </span>
                        <div
                          style={{ height: 6, backgroundColor: "#e8eaed", borderRadius: 999, overflow: "hidden" }}
                        >
                          <div
                            style={{
                              height: "100%",
                              width: `${allocation.load_percentage ?? 0}%`,
                              backgroundColor: getBarColor(allocation.status),
                              borderRadius: 999,
                              transition: "width 0.3s ease",
                            }}
                          />
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="px-4 text-center py-4 text-sm text-muted-foreground">
                      {allocation.orders?.length || 0}
                    </TableCell>
                    <TableCell className="px-4 text-center py-4 text-sm text-muted-foreground">
                      {allocation.run_id || "—"}
                    </TableCell>
                    <TableCell className="px-4 text-center py-4 text-sm text-muted-foreground">
                      {allocation.departure_time ? (
                        new Date(allocation.departure_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                      ) : "—"}
                    </TableCell>
                    <TableCell className="px-4 text-center py-4">
                      <div className="flex justify-center">
                        <StatusBadge
                          status={getStatusLabel(allocation.status)}
                          variant={getStatusVariant(allocation.status)}
                        />
                      </div>
                    </TableCell>
                    <TableCell className="pr-6 text-center py-4">
                      <div className="flex justify-center">
                        {getActionButton(allocation)}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
