"use client";

import React, { useState } from "react";
import {
  Users,
  UserPlus,
  Search,
  Edit2,
  Lock,
  Mail,
  User as UserIcon,
  RefreshCw,
  Key,
  Trash2,
  KeyRound,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
  MapPin,
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
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { AdminUser, adminService } from "@/services/admin-service";

interface UsersTabProps {
  users: AdminUser[];
  isLoading: boolean;
  onRefresh: () => void;
}

export function UsersTab({ users, isLoading, onRefresh }: UsersTabProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Status Notification Banner
  const [notification, setNotification] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // Create Dialog State
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({
    full_name: "",
    email: "",
    password: "",
    role: "DISPATCHER",
    assigned_depot: "peliyagoda",
    is_active: true,
  });
  const [isSubmittingCreate, setIsSubmittingCreate] = useState(false);
  const [createError, setCreateError] = useState("");

  // Edit Dialog State
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [editForm, setEditForm] = useState({
    full_name: "",
    email: "",
    role: "DISPATCHER",
    assigned_depot: "unassigned",
    password: "",
    is_active: true,
  });
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false);
  const [editError, setEditError] = useState("");

  // Reset Password Dialog State
  const [isResetPasswordOpen, setIsResetPasswordOpen] = useState(false);
  const [resetUser, setResetUser] = useState<AdminUser | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [isTemporaryPassword, setIsTemporaryPassword] = useState(false);
  const [isSubmittingReset, setIsSubmittingReset] = useState(false);
  const [resetError, setResetError] = useState("");

  // Delete Confirmation Dialog State
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [userToDelete, setUserToDelete] = useState<AdminUser | null>(null);
  const [isSubmittingDelete, setIsSubmittingDelete] = useState(false);

  // Filter users
  const filteredUsers = users.filter((user) => {
    const q = searchQuery.toLowerCase();
    const matchesSearch =
      user.full_name.toLowerCase().includes(q) ||
      user.email.toLowerCase().includes(q) ||
      (user.username && user.username.toLowerCase().includes(q)) ||
      (user.keycloak_id && user.keycloak_id.toLowerCase().includes(q));

    const matchesRole =
      roleFilter === "ALL" || user.role.toUpperCase() === roleFilter.toUpperCase();

    const matchesStatus =
      statusFilter === "ALL" ||
      (statusFilter === "ACTIVE" && user.is_active) ||
      (statusFilter === "INACTIVE" && !user.is_active);

    return matchesSearch && matchesRole && matchesStatus;
  });

  // Copy Keycloak ID
  const handleCopyId = (id: string) => {
    navigator.clipboard.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Handle Quick Status Toggle
  const handleToggleStatus = async (user: AdminUser) => {
    const idToUse = user.keycloak_id || user.id;
    if (!idToUse) return;

    try {
      await adminService.toggleUserStatus(idToUse, !user.is_active);
      setNotification({
        type: "success",
        message: `Account for ${user.full_name} was successfully ${!user.is_active ? "enabled" : "disabled"} in Keycloak.`,
      });
      onRefresh();
    } catch (err: unknown) {
      setNotification({
        type: "error",
        message: err instanceof Error ? err.message : "Failed to toggle status in Keycloak",
      });
    }
  };

  // Handle Create User directly in Keycloak
  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError("");
    if (!createForm.full_name || !createForm.email || !createForm.password) {
      setCreateError("All fields are required.");
      return;
    }

    setIsSubmittingCreate(true);
    try {
      await adminService.createUser({
        full_name: createForm.full_name,
        email: createForm.email,
        password: createForm.password,
        role: createForm.role,
        assigned_depot:
          createForm.role === "DISPATCHER" && createForm.assigned_depot !== "unassigned"
            ? createForm.assigned_depot
            : null,
        is_active: createForm.is_active,
      });
      setIsCreateOpen(false);
      setCreateForm({
        full_name: "",
        email: "",
        password: "",
        role: "DISPATCHER",
        assigned_depot: "peliyagoda",
        is_active: true,
      });
      setNotification({
        type: "success",
        message: `Keycloak user ${createForm.email} provisioned with role ${createForm.role}.`,
      });
      onRefresh();
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : "Creation failed");
    } finally {
      setIsSubmittingCreate(false);
    }
  };

  // Open Edit Dialog
  const openEditModal = (user: AdminUser) => {
    setSelectedUser(user);
    setEditForm({
      full_name: user.full_name,
      email: user.email,
      role: user.role,
      assigned_depot: user.assigned_depot ? user.assigned_depot.toLowerCase() : "unassigned",
      password: "",
      is_active: user.is_active,
    });
    setEditError("");
    setIsEditOpen(true);
  };

  // Handle Edit Submit
  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;
    const idToUse = selectedUser.keycloak_id || selectedUser.id;
    if (!idToUse) return;

    setEditError("");
    setIsSubmittingEdit(true);
    try {
      await adminService.updateUser(idToUse, {
        full_name: editForm.full_name,
        email: editForm.email,
        role: editForm.role,
        assigned_depot:
          editForm.role === "DISPATCHER"
            ? editForm.assigned_depot === "unassigned"
              ? null
              : editForm.assigned_depot
            : null,
        is_active: editForm.is_active,
        password: editForm.password ? editForm.password : undefined,
      });
      setIsEditOpen(false);
      setNotification({
        type: "success",
        message: `User ${editForm.full_name} successfully updated in Keycloak.`,
      });
      onRefresh();
    } catch (err: unknown) {
      setEditError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setIsSubmittingEdit(false);
    }
  };

  // Open Password Reset Modal
  const openResetPasswordModal = (user: AdminUser) => {
    setResetUser(user);
    setNewPassword("");
    setIsTemporaryPassword(false);
    setResetError("");
    setIsResetPasswordOpen(true);
  };

  // Handle Password Reset
  const handleResetPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetUser) return;
    const idToUse = resetUser.keycloak_id || resetUser.id;
    if (!idToUse) return;

    if (!newPassword || newPassword.length < 6) {
      setResetError("Password must be at least 6 characters.");
      return;
    }

    setIsSubmittingReset(true);
    setResetError("");
    try {
      await adminService.resetUserPassword(idToUse, newPassword, isTemporaryPassword);
      setIsResetPasswordOpen(false);
      setNotification({
        type: "success",
        message: `Keycloak password updated for ${resetUser.full_name} (${resetUser.email}).`,
      });
    } catch (err: unknown) {
      setResetError(err instanceof Error ? err.message : "Failed to reset password");
    } finally {
      setIsSubmittingReset(false);
    }
  };

  // Open Delete Modal
  const openDeleteModal = (user: AdminUser) => {
    setUserToDelete(user);
    setIsDeleteOpen(true);
  };

  // Handle Delete User
  const handleDeleteSubmit = async () => {
    if (!userToDelete) return;
    const idToUse = userToDelete.keycloak_id || userToDelete.id;
    if (!idToUse) return;

    setIsSubmittingDelete(true);
    try {
      await adminService.deleteUser(idToUse);
      setIsDeleteOpen(false);
      setNotification({
        type: "success",
        message: `User ${userToDelete.full_name} has been removed from Keycloak.`,
      });
      onRefresh();
    } catch (err: unknown) {
      setNotification({
        type: "error",
        message: err instanceof Error ? err.message : "Failed to delete user",
      });
    } finally {
      setIsSubmittingDelete(false);
    }
  };

  const getRoleBadge = (role: string) => {
    switch (role.toUpperCase()) {
      case "ADMIN":
        return <Badge className="bg-purple-100 text-purple-900 border-purple-300">System Admin</Badge>;
      case "DISPATCHER":
        return <Badge className="bg-blue-100 text-blue-900 border-blue-300">Dispatcher</Badge>;
      case "STORE_MANAGER":
      case "WAREHOUSE_MANAGER":
        return <Badge className="bg-emerald-100 text-emerald-900 border-emerald-300">Store Manager</Badge>;
      case "DRIVER":
        return <Badge className="bg-indigo-100 text-indigo-900 border-indigo-300">Driver</Badge>;
      case "LOADER":
        return <Badge className="bg-teal-100 text-teal-900 border-teal-300">Dock Loader</Badge>;
      default:
        return <Badge variant="outline">{role}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header with Title and Create Button */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Key className="size-5 text-purple-600" />
            <span>Keycloak IAM User Directory</span>
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Keycloak Realm: <span className="font-mono font-semibold text-foreground">waypointlogistics</span> — All identities, credentials, and realm roles are managed directly in Keycloak.
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
            onClick={() => setIsCreateOpen(true)}
            className="bg-primary text-primary-foreground text-xs gap-1.5 font-semibold"
          >
            <UserPlus className="size-3.5" />
            <span>Create Keycloak User</span>
          </Button>
        </div>
      </div>

      {/* Notification Banner */}
      {notification && (
        <div
          className={`p-3 rounded-lg border text-xs flex items-center justify-between gap-3 ${
            notification.type === "success"
              ? "bg-emerald-50 text-emerald-900 border-emerald-200"
              : "bg-red-50 text-red-900 border-red-200"
          }`}
        >
          <div className="flex items-center gap-2">
            {notification.type === "success" ? (
              <CheckCircle2 className="size-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="size-4 text-red-600 shrink-0" />
            )}
            <span className="font-medium">{notification.message}</span>
          </div>
          <button
            onClick={() => setNotification(null)}
            className="text-[11px] underline opacity-80 hover:opacity-100"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Filter and Search Controls */}
      <Card className="border-border shadow-xs">
        <CardContent className="p-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
              <Input
                placeholder="Search by name, email, username or UUID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 text-xs"
              />
            </div>

            {/* Role Filter */}
            <Select value={roleFilter} onValueChange={setRoleFilter}>
              <SelectTrigger className="text-xs">
                <SelectValue placeholder="Filter by Role" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Roles</SelectItem>
                <SelectItem value="ADMIN">System Administrator</SelectItem>
                <SelectItem value="DISPATCHER">Dispatcher</SelectItem>
                <SelectItem value="STORE_MANAGER">Store Manager</SelectItem>
                <SelectItem value="DRIVER">Driver</SelectItem>
                <SelectItem value="LOADER">Dock Loader</SelectItem>
              </SelectContent>
            </Select>

            {/* Status Filter */}
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="text-xs">
                <SelectValue placeholder="Filter by Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Statuses</SelectItem>
                <SelectItem value="ACTIVE">Enabled Accounts</SelectItem>
                <SelectItem value="INACTIVE">Disabled Accounts</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Users Table */}
      <Card className="border-border shadow-xs overflow-hidden">
        <Table>
          <TableHeader className="bg-slate-50">
            <TableRow>
              <TableHead className="text-xs font-semibold">Keycloak Identity</TableHead>
              <TableHead className="text-xs font-semibold">Realm Role</TableHead>
              <TableHead className="text-xs font-semibold">SSO Status</TableHead>
              <TableHead className="text-xs font-semibold">Keycloak ID</TableHead>
              <TableHead className="text-xs font-semibold">Created</TableHead>
              <TableHead className="text-xs font-semibold text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-xs text-muted-foreground">
                  <div className="flex items-center justify-center gap-2">
                    <RefreshCw className="size-4 animate-spin text-primary" />
                    <span>Loading Keycloak directory...</span>
                  </div>
                </TableCell>
              </TableRow>
            ) : filteredUsers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-xs text-muted-foreground">
                  No Keycloak users found matching current filters.
                </TableCell>
              </TableRow>
            ) : (
              filteredUsers.map((user) => (
                <TableRow key={user.keycloak_id || user.id || user.email} className="hover:bg-slate-50/60">
                  <TableCell className="py-3">
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-full bg-purple-100 flex items-center justify-center text-purple-900 font-bold text-xs shrink-0">
                        {user.full_name ? user.full_name.charAt(0).toUpperCase() : user.email.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="font-semibold text-xs text-foreground flex items-center gap-1.5">
                          <span>{user.full_name || user.username || user.email}</span>
                          {user.email_verified && (
                            <Badge variant="outline" className="text-[9px] py-0 px-1 border-emerald-200 bg-emerald-50 text-emerald-800">
                              Verified
                            </Badge>
                          )}
                        </div>
                        <div className="text-[11px] text-muted-foreground flex items-center gap-1.5 mt-0.5">
                          <Mail className="size-3 text-muted-foreground/70" />
                          <span>{user.email}</span>
                          {user.username && user.username !== user.email && (
                            <span className="font-mono text-[10px] text-slate-500">(@{user.username})</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="py-3">
                    <div className="flex flex-col gap-1 items-start">
                      {getRoleBadge(user.role)}
                      {user.role === "DISPATCHER" && (
                        user.assigned_depot ? (
                          <Badge
                            variant="outline"
                            className={`text-[10px] py-0 px-1.5 font-medium flex items-center gap-1 ${
                              user.assigned_depot.toLowerCase() === "kandy"
                                ? "bg-purple-50 text-purple-700 border-purple-200"
                                : "bg-blue-50 text-blue-700 border-blue-200"
                            }`}
                          >
                            <MapPin className="size-2.5" />
                            <span>{user.assigned_depot.toLowerCase() === "kandy" ? "Kandy Hub" : "Peliyagoda Hub"}</span>
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="text-[10px] py-0 px-1.5 font-medium bg-amber-50 text-amber-700 border-amber-200 flex items-center gap-1"
                          >
                            <AlertCircle className="size-2.5 text-amber-600" />
                            <span>Unassigned Hub</span>
                          </Badge>
                        )
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="py-3">
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={user.is_active}
                        onCheckedChange={() => handleToggleStatus(user)}
                      />
                      <span className={`text-[11px] font-medium ${user.is_active ? "text-emerald-700" : "text-muted-foreground"}`}>
                        {user.is_active ? "Enabled" : "Disabled"}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="py-3">
                    {user.keycloak_id ? (
                      <div className="flex items-center gap-1">
                        <span className="font-mono text-[11px] text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
                          {user.keycloak_id.length > 12 ? `${user.keycloak_id.slice(0, 8)}...` : user.keycloak_id}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-6 text-muted-foreground hover:text-foreground"
                          onClick={() => handleCopyId(user.keycloak_id!)}
                          title="Copy Full Keycloak UUID"
                        >
                          {copiedId === user.keycloak_id ? (
                            <Check className="size-3 text-emerald-600" />
                          ) : (
                            <Copy className="size-3" />
                          )}
                        </Button>
                      </div>
                    ) : (
                      <span className="text-[11px] text-muted-foreground font-mono">local-legacy</span>
                    )}
                  </TableCell>
                  <TableCell className="py-3 text-[11px] text-muted-foreground">
                    {user.created_at ? new Date(user.created_at).toLocaleDateString() : "Keycloak"}
                  </TableCell>
                  <TableCell className="py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEditModal(user)}
                        className="text-xs gap-1 h-8 text-primary hover:bg-slate-100"
                        title="Edit User Details & Role"
                      >
                        <Edit2 className="size-3" />
                        <span className="hidden sm:inline">Edit</span>
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openResetPasswordModal(user)}
                        className="text-xs gap-1 h-8 text-amber-700 hover:bg-amber-50 hover:text-amber-800"
                        title="Reset Keycloak Password"
                      >
                        <KeyRound className="size-3" />
                        <span className="hidden sm:inline">Password</span>
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openDeleteModal(user)}
                        className="text-xs gap-1 h-8 text-red-600 hover:bg-red-50 hover:text-red-700"
                        title="Delete from Keycloak"
                      >
                        <Trash2 className="size-3" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      {/* Create Keycloak User Dialog */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center gap-2">
              <Key className="size-4 text-purple-600" />
              <span>Create Keycloak Realm User</span>
            </DialogTitle>
            <DialogDescription className="text-xs">
              Provisions a new identity directly in Keycloak Realm <code className="font-mono">waypointlogistics</code>.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateSubmit} className="space-y-4 py-2">
            {createError && (
              <div className="p-2.5 rounded text-xs bg-red-50 text-red-800 border border-red-200">
                {createError}
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Full Name</Label>
              <div className="relative">
                <UserIcon className="absolute left-3 top-2.5 size-3.5 text-muted-foreground" />
                <Input
                  className="pl-8 text-xs"
                  placeholder="e.g. Kasun Silva"
                  value={createForm.full_name}
                  onChange={(e) => setCreateForm({ ...createForm, full_name: e.target.value })}
                  required
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Email Address (Keycloak Username)</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-2.5 size-3.5 text-muted-foreground" />
                <Input
                  type="email"
                  className="pl-8 text-xs"
                  placeholder="kasun.silva@waypoint.com"
                  value={createForm.email}
                  onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
                  required
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Initial Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-2.5 size-3.5 text-muted-foreground" />
                <Input
                  type="password"
                  className="pl-8 text-xs"
                  placeholder="Minimum 6 characters"
                  value={createForm.password}
                  onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
                  required
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Keycloak Realm Role</Label>
              <Select
                value={createForm.role}
                onValueChange={(val) => setCreateForm({ ...createForm, role: val })}
              >
                <SelectTrigger className="text-xs">
                  <SelectValue placeholder="Select Realm Role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ADMIN">System Administrator (admin)</SelectItem>
                  <SelectItem value="DISPATCHER">Dispatcher (dispatcher)</SelectItem>
                  <SelectItem value="STORE_MANAGER">Store Manager (store_manager)</SelectItem>
                  <SelectItem value="DRIVER">Delivery Driver (driver)</SelectItem>
                  <SelectItem value="LOADER">Dock Loader (loader)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {createForm.role === "DISPATCHER" && (
              <div className="space-y-1.5 p-3 rounded-lg border border-blue-100 bg-blue-50/40">
                <Label className="text-xs font-semibold flex items-center gap-1.5 text-blue-950">
                  <MapPin className="size-3.5 text-blue-600" />
                  <span>Assigned Depot Hub</span>
                </Label>
                <Select
                  value={createForm.assigned_depot}
                  onValueChange={(val) => setCreateForm({ ...createForm, assigned_depot: val })}
                >
                  <SelectTrigger className="text-xs bg-white">
                    <SelectValue placeholder="Select Depot Assignment" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="peliyagoda">Peliyagoda Central Depot (Western Province)</SelectItem>
                    <SelectItem value="kandy">Kandy Regional Depot (Central Province)</SelectItem>
                    <SelectItem value="unassigned">Unassigned (Assign later)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  The dispatcher will strictly access orders, fleet, and manifests for this depot.
                </p>
              </div>
            )}

            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <div className="space-y-0.5">
                <Label className="text-xs font-semibold">Account Status</Label>
                <p className="text-[11px] text-muted-foreground">Enabled for immediate Keycloak SSO login.</p>
              </div>
              <Switch
                checked={createForm.is_active}
                onCheckedChange={(checked) => setCreateForm({ ...createForm, is_active: checked })}
              />
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsCreateOpen(false)}
                className="text-xs border-border"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={isSubmittingCreate}
                className="bg-primary text-primary-foreground text-xs font-semibold gap-1.5"
              >
                {isSubmittingCreate && <RefreshCw className="size-3.5 animate-spin" />}
                <span>Create in Keycloak</span>
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit User Dialog */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center gap-2">
              <Edit2 className="size-4 text-primary" />
              <span>Edit Keycloak User</span>
            </DialogTitle>
            <DialogDescription className="text-xs">
              Update identity attributes and realm role assignments in Keycloak.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleEditSubmit} className="space-y-4 py-2">
            {editError && (
              <div className="p-2.5 rounded text-xs bg-red-50 text-red-800 border border-red-200">
                {editError}
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Full Name</Label>
              <Input
                className="text-xs"
                value={editForm.full_name}
                onChange={(e) => setEditForm({ ...editForm, full_name: e.target.value })}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Email Address</Label>
              <Input
                type="email"
                className="text-xs"
                value={editForm.email}
                onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Keycloak Realm Role</Label>
              <Select
                value={editForm.role}
                onValueChange={(val) => setEditForm({ ...editForm, role: val })}
              >
                <SelectTrigger className="text-xs">
                  <SelectValue placeholder="Select Realm Role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ADMIN">System Administrator (admin)</SelectItem>
                  <SelectItem value="DISPATCHER">Dispatcher (dispatcher)</SelectItem>
                  <SelectItem value="STORE_MANAGER">Store Manager (store_manager)</SelectItem>
                  <SelectItem value="DRIVER">Delivery Driver (driver)</SelectItem>
                  <SelectItem value="LOADER">Dock Loader (loader)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {editForm.role === "DISPATCHER" && (
              <div className="space-y-1.5 p-3 rounded-lg border border-blue-100 bg-blue-50/40">
                <Label className="text-xs font-semibold flex items-center gap-1.5 text-blue-950">
                  <MapPin className="size-3.5 text-blue-600" />
                  <span>Assigned Depot Hub</span>
                </Label>
                <Select
                  value={editForm.assigned_depot}
                  onValueChange={(val) => setEditForm({ ...editForm, assigned_depot: val })}
                >
                  <SelectTrigger className="text-xs bg-white">
                    <SelectValue placeholder="Select Depot Assignment" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="peliyagoda">Peliyagoda Central Depot (Western Province)</SelectItem>
                    <SelectItem value="kandy">Kandy Regional Depot (Central Province)</SelectItem>
                    <SelectItem value="unassigned">Unassigned (Clear Assignment)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  Dispatcher portal data will be strictly isolated to this operational depot.
                </p>
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">New Password (leave blank to keep unchanged)</Label>
              <Input
                type="password"
                className="text-xs"
                placeholder="Optional new password"
                value={editForm.password}
                onChange={(e) => setEditForm({ ...editForm, password: e.target.value })}
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <div className="space-y-0.5">
                <Label className="text-xs font-semibold">Account Status</Label>
                <p className="text-[11px] text-muted-foreground">Enable or disable login access.</p>
              </div>
              <Switch
                checked={editForm.is_active}
                onCheckedChange={(checked) => setEditForm({ ...editForm, is_active: checked })}
              />
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsEditOpen(false)}
                className="text-xs border-border"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={isSubmittingEdit}
                className="bg-primary text-primary-foreground text-xs font-semibold gap-1.5"
              >
                {isSubmittingEdit && <RefreshCw className="size-3.5 animate-spin" />}
                <span>Save to Keycloak</span>
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Reset Password Modal */}
      <Dialog open={isResetPasswordOpen} onOpenChange={setIsResetPasswordOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center gap-2">
              <KeyRound className="size-4 text-amber-600" />
              <span>Reset Keycloak Password</span>
            </DialogTitle>
            <DialogDescription className="text-xs">
              Set a new password for <span className="font-semibold text-foreground">{resetUser?.full_name}</span> ({resetUser?.email}).
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleResetPasswordSubmit} className="space-y-4 py-2">
            {resetError && (
              <div className="p-2.5 rounded text-xs bg-red-50 text-red-800 border border-red-200">
                {resetError}
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">New Password</Label>
              <Input
                type="password"
                className="text-xs"
                placeholder="Enter new password (min. 6 characters)"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
              />
            </div>

            <div className="flex items-center gap-2 pt-1">
              <input
                type="checkbox"
                id="temp-password"
                checked={isTemporaryPassword}
                onChange={(e) => setIsTemporaryPassword(e.target.checked)}
                className="rounded border-slate-300 text-primary"
              />
              <label htmlFor="temp-password" className="text-xs text-muted-foreground cursor-pointer">
                Temporary password (user must change on next Keycloak login)
              </label>
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsResetPasswordOpen(false)}
                className="text-xs border-border"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={isSubmittingReset}
                className="bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold gap-1.5"
              >
                {isSubmittingReset && <RefreshCw className="size-3.5 animate-spin" />}
                <span>Set Password</span>
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Modal */}
      <Dialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-red-600 flex items-center gap-2">
              <Trash2 className="size-4" />
              <span>Delete User from Keycloak</span>
            </DialogTitle>
            <DialogDescription className="text-xs">
              Are you sure you want to permanently delete <strong className="text-foreground">{userToDelete?.full_name}</strong> ({userToDelete?.email})?
            </DialogDescription>
          </DialogHeader>

          <p className="text-xs text-muted-foreground bg-red-50 p-3 rounded border border-red-200 text-red-900">
            This action immediately purges the user from the Keycloak IAM Realm (<code className="font-mono">waypointlogistics</code>). They will be unable to log in to any Waypoint portal.
          </p>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsDeleteOpen(false)}
              className="text-xs border-border"
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={isSubmittingDelete}
              onClick={handleDeleteSubmit}
              className="bg-red-600 hover:bg-red-700 text-white text-xs font-semibold gap-1.5"
            >
              {isSubmittingDelete && <RefreshCw className="size-3.5 animate-spin" />}
              <span>Delete User</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
