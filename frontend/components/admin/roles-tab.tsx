"use client";

import React, { useState } from "react";
import {
  ShieldCheck,
  CheckCircle2,
  UserCheck,
  ArrowRight,
  KeyRound,
  RefreshCw,
} from "lucide-react";
import { Card, CardHeader, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { AdminUser, RoleDetail, adminService } from "@/services/admin-service";

interface RolesTabProps {
  roles: RoleDetail[];
  users: AdminUser[];
  isLoading: boolean;
  onRefresh: () => void;
}

export function RolesTab({ roles, users, isLoading, onRefresh }: RolesTabProps) {
  const [isAssignOpen, setIsAssignOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [selectedRole, setSelectedRole] = useState<string>("DISPATCHER");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [assignError, setAssignError] = useState("");

  const handleAssignRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUserId) {
      setAssignError("Please choose a user.");
      return;
    }

    setIsSubmitting(true);
    setAssignError("");
    try {
      await adminService.assignRole(Number(selectedUserId), selectedRole);
      setIsAssignOpen(false);
      onRefresh();
    } catch (err: unknown) {
      setAssignError(err instanceof Error ? err.message : "Failed to assign role");
    } finally {
      setIsSubmitting(false);
    }
  };

  const openAssignForRole = (roleKey: string) => {
    setSelectedRole(roleKey);
    setSelectedUserId("");
    setAssignError("");
    setIsAssignOpen(true);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <ShieldCheck className="size-5 text-primary" />
            <span>Roles &amp; Access Control (RBAC)</span>
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Role definitions, assigned operational permissions, and security privileges for Waypoint users.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            className="text-xs gap-1.5 border-border"
          >
            <RefreshCw className={`size-3.5 ${isLoading ? "animate-spin" : ""}`} />
            <span>Refresh</span>
          </Button>
          <Button
            size="sm"
            onClick={() => setIsAssignOpen(true)}
            className="bg-primary text-primary-foreground text-xs gap-1.5 font-semibold"
          >
            <UserCheck className="size-3.5" />
            <span>Assign Role to User</span>
          </Button>
        </div>
      </div>

      {/* Grid of the 4 operational roles + Admin */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {roles.map((role) => (
          <Card
            key={role.key}
            className="border-border shadow-xs flex flex-col justify-between hover:border-primary/40 transition-colors"
          >
            <div>
              <CardHeader className="pb-3 border-b border-border bg-slate-50/50">
                <div className="flex items-center justify-between">
                  <Badge variant="outline" className={`text-xs font-semibold ${role.badge_variant}`}>
                    {role.display_title}
                  </Badge>
                  <span className="text-xs font-bold text-slate-700 bg-white px-2 py-0.5 rounded border border-border">
                    {role.user_count} {role.user_count === 1 ? "User" : "Users"}
                  </span>
                </div>
                <CardDescription className="text-xs text-muted-foreground mt-2 leading-relaxed">
                  {role.description}
                </CardDescription>
              </CardHeader>

              <CardContent className="p-4 space-y-3">
                <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <KeyRound className="size-3 text-primary" />
                  <span>Granted Permissions ({role.permissions.length})</span>
                </div>

                <div className="space-y-2">
                  {role.permissions.map((perm) => (
                    <div key={perm.id} className="flex items-start gap-2 text-xs">
                      <CheckCircle2 className="size-3.5 text-emerald-700 shrink-0 mt-0.5" />
                      <div>
                        <div className="font-semibold text-foreground text-xs">{perm.name}</div>
                        <div className="text-[11px] text-muted-foreground leading-tight">
                          {perm.description}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </div>

            <div className="p-3 border-t border-border bg-slate-50/50 rounded-b-lg flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground font-mono">
                {role.key === "LOADER" ? "Dock Tablet / PIN Auth" : "Keycloak / RBAC mapped"}
              </span>
              {role.key === "LOADER" ? (
                <span className="text-[11px] font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded border border-border">
                  Managed in Users
                </span>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => openAssignForRole(role.key)}
                  className="text-xs font-semibold text-primary h-7 gap-1 bg-white border-border"
                >
                  <span>Assign User</span>
                  <ArrowRight className="size-3" />
                </Button>
              )}
            </div>
          </Card>
        ))}
      </div>

      {/* Role Assignment Dialog */}
      <Dialog open={isAssignOpen} onOpenChange={setIsAssignOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center gap-2">
              <UserCheck className="size-4 text-primary" />
              <span>Assign Operational Role</span>
            </DialogTitle>
            <DialogDescription className="text-xs">
              Change the operational workspace and permissions for an existing user.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleAssignRole} className="space-y-4 py-2">
            {assignError && (
              <div className="p-2.5 rounded text-xs bg-red-50 text-red-800 border border-red-200">
                {assignError}
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-xs">Select User</Label>
              <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                <SelectTrigger className="text-xs">
                  <SelectValue placeholder="Choose user account..." />
                </SelectTrigger>
                <SelectContent className="max-h-60">
                  {users
                    .filter((u) => u.role !== "LOADER")
                    .map((user) => (
                      <SelectItem key={user.id} value={String(user.id)}>
                        {user.full_name} ({user.email}) &bull; Current: {user.role_display}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">New Target Role</Label>
              <Select value={selectedRole} onValueChange={setSelectedRole}>
                <SelectTrigger className="text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="DISPATCHER">Dispatcher (Trip Manifests &amp; Staging)</SelectItem>
                  <SelectItem value="STORE_MANAGER">Store Manager (Store Replenishment &amp; Receipts)</SelectItem>
                  <SelectItem value="DRIVER">Driver (Navigation &amp; Proof of Delivery)</SelectItem>
                  <SelectItem value="ADMIN">System Administrator (Full Infrastructure Access)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="p-3 rounded-lg bg-blue-50/50 border border-blue-200 text-xs text-blue-900 leading-relaxed">
              Role assignment immediately updates the user&apos;s permissions across both the database and identity sessions.
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsAssignOpen(false)}
                className="text-xs"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={isSubmitting}
                className="bg-primary text-primary-foreground text-xs font-semibold"
              >
                {isSubmitting ? "Updating..." : "Save Role Assignment"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
