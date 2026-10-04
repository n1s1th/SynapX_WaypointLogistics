import React from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge, StatusVariant } from "@/components/dispatcher/StatusBadge";
import { format } from "date-fns";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TableLoading } from "@/components/ui/table-loading";

import { DeliveryRun } from "@/app/dispatcher/delivery-runs/page";

interface DeliveryRunTableProps {
  runs: DeliveryRun[];
  isLoading: boolean;
  selectedRunId: number | null;
  onRowClick: (run: DeliveryRun) => void;
}

export function DeliveryRunTable({ runs, isLoading, selectedRunId, onRowClick }: DeliveryRunTableProps) {
  const getStatusVariant = (status: string): StatusVariant => {
    switch (status) {
      case "scheduled": return "primary";
      case "ready": return "success";
      case "en_route": return "info";
      case "delayed": return "destructive";
      case "completed": return "success";
      default: return "neutral";
    }
  };

  return (
    <Card className="border border-[#E5E5E2] rounded-[10px] shadow-xs overflow-hidden flex flex-col">
      <CardHeader className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#E5E5E2] bg-white">
        <div>
          <CardTitle className="text-[18px] font-bold text-[#171A1F] tracking-tight">Delivery Runs Board</CardTitle>
          <CardDescription className="text-[12px] text-[#6B7280] mt-0.5">
            Manage planned trips, stop sequences, manifests, and route readiness.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="p-0 bg-white">
        <div className="overflow-x-auto">
          <Table className="dispatcher-table w-full text-left border-collapse">
            <TableHeader className="border-b border-[#E5E5E2] bg-[#F8F9FA] text-[11px] font-semibold text-[#6B7280] uppercase tracking-wider">
              <TableRow>
                <TableHead className="pl-6 px-4 text-left w-[120px] whitespace-nowrap">Run</TableHead>
                <TableHead className="px-4 text-left w-[120px] whitespace-nowrap">Vehicle</TableHead>
                <TableHead className="px-4 text-left w-[160px] whitespace-nowrap">Driver</TableHead>
                <TableHead className="px-4 text-center w-[80px] whitespace-nowrap">Stops</TableHead>
                <TableHead className="px-4 text-center w-[100px] whitespace-nowrap">Departure</TableHead>
                <TableHead className="px-4 text-center w-[100px] whitespace-nowrap">ETA</TableHead>
                <TableHead className="px-4 text-left w-[140px] whitespace-nowrap">Progress</TableHead>
                <TableHead className="px-4 text-center w-[120px] whitespace-nowrap">Status</TableHead>
                <TableHead className="pr-6 text-center w-[120px] whitespace-nowrap">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-[#E5E5E2] text-sm bg-white">
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center h-24 text-muted-foreground">
                    <TableLoading label="Loading delivery runs..." />
                  </TableCell>
                </TableRow>
              ) : runs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center h-24 text-muted-foreground">
                    No delivery runs found.
                  </TableCell>
                </TableRow>
              ) : (
                runs.map((run) => {
                  const isSelected = run.id === selectedRunId;
                  const isDelivering = run.status === "en_route" || run.status === "completed";
                  const currentStops = isDelivering ? run.stops_completed : (run.loader?.stops_completed ?? 0);
                  const totalStops = isDelivering ? run.stop_count : (run.loader?.stop_count ?? run.stop_count);
                  const progressPct = totalStops > 0 ? (currentStops / totalStops) * 100 : 0;
                  
                  return (
                    <TableRow 
                      key={run.id}
                      onClick={() => onRowClick(run)}
                      className={`cursor-pointer transition-colors hover:bg-muted/30 ${isSelected ? 'bg-muted/20 border-l-2 border-l-[#1c355e]' : ''}`}
                    >
                      <TableCell className="pl-6 px-4 text-left py-4">
                        <div className="font-semibold text-foreground">{run.trip_code}</div>
                      </TableCell>
                      <TableCell className="px-4 text-left py-4">
                        <div className="text-sm text-muted-foreground">{run.vehicle_number}</div>
                      </TableCell>
                      <TableCell className="px-4 text-left py-4">
                        <div className="text-sm">{run.driver_name}</div>
                      </TableCell>
                      <TableCell className="px-4 text-center py-4 text-sm text-muted-foreground">
                        {run.stop_count}
                      </TableCell>
                      <TableCell className="px-4 text-center py-4 text-sm text-muted-foreground">
                        {run.departure_time ? format(new Date(run.departure_time), "HH:mm") : "—"}
                      </TableCell>
                      <TableCell className="px-4 text-center py-4 text-sm text-muted-foreground">
                        {run.estimated_arrival ? format(new Date(run.estimated_arrival), "HH:mm") : "—"}
                      </TableCell>
                      <TableCell className="px-4 text-left py-4">
                        <div className="flex flex-col justify-center gap-1.5 w-[80px]">
                          <span className="text-xs font-semibold text-[#1c355e]">
                            {Math.round(progressPct)}%
                          </span>
                          <div style={{ height: 6, backgroundColor: "#e8eaed", borderRadius: 999, overflow: "hidden" }}>
                            <div
                              style={{
                                height: "100%",
                                width: `${progressPct}%`,
                                backgroundColor: "#1c355e",
                                borderRadius: 999,
                                transition: "width 0.3s ease",
                              }}
                            />
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="px-4 text-center py-4">
                        <div className="flex justify-center">
                          <StatusBadge
                            status={run.displayStatus === "en_route" ? "On Route" : run.displayStatus.charAt(0).toUpperCase() + run.displayStatus.slice(1)}
                            variant={getStatusVariant(run.displayStatus)}
                          />
                        </div>
                      </TableCell>
                      <TableCell className="pr-6 text-center py-4">
                        <div className="flex justify-center">
                          <Button
                            variant="outline"
                            className="border-slate-300 text-[#1c355e] shadow-none px-6 w-[100px]"
                            size="sm"
                          >
                            View
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
