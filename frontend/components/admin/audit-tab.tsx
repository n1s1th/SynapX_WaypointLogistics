"use client";

import React, { useState } from "react";
import {
  History,
  Search,
  RefreshCw,
  FileText,
  Clock,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AuditLog } from "@/services/admin-service";

interface AuditTabProps {
  logs: AuditLog[];
  isLoading: boolean;
  onRefresh: () => void;
}

export function AuditTab({ logs, isLoading, onRefresh }: AuditTabProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [actionFilter, setActionFilter] = useState("ALL");
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);

  const filteredLogs = logs.filter((log) => {
    const matchesSearch =
      log.summary.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.actor_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.actor_email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.entity_name.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesAction = actionFilter === "ALL" || log.action_type.toUpperCase() === actionFilter.toUpperCase();

    return matchesSearch && matchesAction;
  });

  const getActionBadge = (action: string) => {
    switch (action.toUpperCase()) {
      case "USER_MUTATION":
        return <Badge className="bg-blue-100 text-blue-900 border-blue-300">User Account</Badge>;
      case "ROLE_ASSIGNMENT":
        return <Badge className="bg-purple-100 text-purple-900 border-purple-300">Role Allocation</Badge>;
      case "VEHICLE_MUTATION":
        return <Badge className="bg-slate-100 text-slate-800 border-slate-300">Fleet Asset</Badge>;
      case "OUTLET_MUTATION":
        return <Badge className="bg-teal-100 text-teal-900 border-teal-300">Outlet Profile</Badge>;
      case "CONFIG_UPDATE":
        return <Badge className="bg-amber-100 text-amber-900 border-amber-300">Config Change</Badge>;
      default:
        return <Badge variant="outline">{action}</Badge>;
    }
  };

  const getSeverityBadge = (severity: AuditLog["severity"]) => {
    switch (severity) {
      case "CRITICAL":
        return <Badge className="bg-red-100 text-red-900 border-red-300">Critical</Badge>;
      case "WARNING":
        return <Badge className="bg-amber-100 text-amber-900 border-amber-300">Warning</Badge>;
      case "INFO":
      default:
        return <Badge className="bg-emerald-50 text-emerald-800 border-emerald-300">Info</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <History className="size-5 text-primary" />
            <span>Administrative Audit &amp; Activity Log</span>
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Cryptographically timestamped trail of administrative changes: user updates, role allocations, and configuration mutations.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={onRefresh}
          className="text-xs gap-1.5 border-border"
        >
          <RefreshCw className={`size-3.5 ${isLoading ? "animate-spin" : ""}`} />
          <span>Refresh</span>
        </Button>
      </div>

      {/* Filters */}
      <Card className="border-border shadow-xs">
        <CardContent className="p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
              <Input
                placeholder="Search audit records by actor, summary, entity..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 text-xs"
              />
            </div>

            <Select value={actionFilter} onValueChange={setActionFilter}>
              <SelectTrigger className="text-xs">
                <SelectValue placeholder="Action Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Administrative Actions</SelectItem>
                <SelectItem value="USER_MUTATION">User Account Changes</SelectItem>
                <SelectItem value="ROLE_ASSIGNMENT">Role Assignments</SelectItem>
                <SelectItem value="VEHICLE_MUTATION">Fleet Modifications</SelectItem>
                <SelectItem value="OUTLET_MUTATION">Outlet Updates</SelectItem>
                <SelectItem value="CONFIG_UPDATE">Configuration Adjustments</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Audit Log Table */}
      <Card className="border-border shadow-xs overflow-hidden">
        <Table>
          <TableHeader className="bg-slate-50">
            <TableRow>
              <TableHead className="text-xs font-semibold">Timestamp</TableHead>
              <TableHead className="text-xs font-semibold">Action Category</TableHead>
              <TableHead className="text-xs font-semibold">Entity Target</TableHead>
              <TableHead className="text-xs font-semibold">Change Summary</TableHead>
              <TableHead className="text-xs font-semibold">Actor</TableHead>
              <TableHead className="text-xs font-semibold text-right">Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-xs text-muted-foreground">
                  Loading audit logs...
                </TableCell>
              </TableRow>
            ) : filteredLogs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-xs text-muted-foreground">
                  No audit entries found.
                </TableCell>
              </TableRow>
            ) : (
              filteredLogs.map((log) => (
                <TableRow key={log.id} className="hover:bg-slate-50/60">
                  <TableCell className="py-3 font-mono text-[11px] text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                      <Clock className="size-3 text-muted-foreground" />
                      <span>{new Date(log.timestamp).toLocaleString()}</span>
                    </div>
                  </TableCell>
                  <TableCell className="py-3">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {getActionBadge(log.action_type)}
                      {getSeverityBadge(log.severity)}
                    </div>
                  </TableCell>
                  <TableCell className="py-3">
                    <div className="font-semibold text-xs text-foreground">{log.entity_name}</div>
                    {log.entity_id && (
                      <div className="text-[11px] font-mono text-muted-foreground">
                        ID: {log.entity_id}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="py-3 text-xs text-foreground max-w-md">
                    {log.summary}
                  </TableCell>
                  <TableCell className="py-3">
                    <div className="text-xs font-semibold text-foreground">{log.actor_name}</div>
                    <div className="text-[10px] text-muted-foreground font-mono">{log.actor_email}</div>
                  </TableCell>
                  <TableCell className="py-3 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedLog(log)}
                      className="text-xs text-primary h-7 gap-1 hover:bg-slate-100"
                    >
                      <FileText className="size-3" />
                      <span>View</span>
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      {/* Log Detail Dialog */}
      <Dialog open={!!selectedLog} onOpenChange={(open) => !open && setSelectedLog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center gap-2">
              <History className="size-4 text-primary" />
              <span>Audit Event Record</span>
            </DialogTitle>
            <DialogDescription className="text-xs">
              Detailed payload and actor signature for audit #{selectedLog?.id}.
            </DialogDescription>
          </DialogHeader>

          {selectedLog && (
            <div className="space-y-3 py-2 text-xs">
              <div className="grid grid-cols-2 gap-2 p-3 bg-slate-50 rounded-lg border border-border">
                <div>
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase">Timestamp</span>
                  <div className="font-mono text-foreground">{new Date(selectedLog.timestamp).toISOString()}</div>
                </div>
                <div>
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase">Actor</span>
                  <div className="font-medium text-foreground">{selectedLog.actor_name}</div>
                  <div className="text-[10px] text-muted-foreground font-mono">{selectedLog.actor_email}</div>
                </div>
              </div>

              <div>
                <span className="text-[10px] font-semibold text-muted-foreground uppercase">Summary</span>
                <p className="mt-1 p-2.5 rounded bg-white border border-border text-foreground">
                  {selectedLog.summary}
                </p>
              </div>

              {selectedLog.diff && (
                <div>
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase">Recorded Mutation Diff</span>
                  <pre className="mt-1 p-2.5 rounded bg-slate-900 text-slate-100 font-mono text-[11px] overflow-x-auto">
                    {JSON.stringify(selectedLog.diff, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
