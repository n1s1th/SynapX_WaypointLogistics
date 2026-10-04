"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ShieldAlert, Lock, ArrowRight, UserCheck, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/lib/auth-context";
import { KeycloakAppRole, ROLE_CONFIGS } from "@/lib/keycloak";

interface RoleGuardProps {
  allowedRoles: KeycloakAppRole[];
  children: React.ReactNode;
  fallbackTitle?: string;
}

export function RoleGuard({
  allowedRoles,
  children,
  fallbackTitle = "Access Restricted",
}: RoleGuardProps) {
  const pathname = usePathname();
  const { user, isAuthenticated, isLoading, loginWithKeycloak, logout } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-[50vh] flex flex-col items-center justify-center gap-3 text-slate-500">
        <RefreshCw className="w-6 h-6 animate-spin text-teal-600" />
        <p className="text-sm font-medium">Verifying Keycloak permissions...</p>
      </div>
    );
  }

  // Not authenticated at all
  if (!isAuthenticated || !user) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center p-4">
        <Card className="max-w-md w-full border-slate-200 shadow-lg text-center">
          <CardHeader className="pb-2">
            <div className="w-12 h-12 rounded-xl bg-slate-100 border border-slate-200 text-slate-800 flex items-center justify-center mx-auto mb-2">
              <Lock className="w-6 h-6 text-[#092C4C]" />
            </div>
            <CardTitle className="text-xl font-bold text-slate-900">Keycloak Sign In Required</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pt-2">
            <p className="text-sm text-slate-600">
              You must sign in via your Keycloak corporate account to access this operational workspace.
            </p>
            <div className="pt-2">
              <Button
                onClick={() => loginWithKeycloak()}
                className="w-full bg-[#092C4C] hover:bg-[#061e34] text-white flex items-center justify-center gap-2"
              >
                <span>Sign In with Keycloak</span>
                <ArrowRight className="w-4 h-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Check if user has ANY of the allowed roles
  const hasAccess = allowedRoles.some((role) => user.roles.includes(role));

  if (!hasAccess) {
    const userRoleLabels = user.roles.map((r) => ROLE_CONFIGS[r]?.label || r).join(", ") || "None";
    const allowedLabels = allowedRoles.map((r) => ROLE_CONFIGS[r]?.label || r).join(" or ");
    const userPrimaryPortal = user.primaryRole ? ROLE_CONFIGS[user.primaryRole]?.route : "/";

    return (
      <div className="min-h-[70vh] flex items-center justify-center p-4">
        <Card className="max-w-lg w-full border-amber-200 bg-amber-50/30 shadow-lg">
          <CardHeader className="pb-3 text-center">
            <div className="w-12 h-12 rounded-xl bg-amber-100 border border-amber-300 text-amber-800 flex items-center justify-center mx-auto mb-2">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <CardTitle className="text-xl font-bold text-slate-900">{fallbackTitle}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-center">
            <p className="text-sm text-slate-600">
              This console requires the <strong className="text-slate-900">{allowedLabels}</strong> Keycloak role.
            </p>

            <div className="p-3 bg-white rounded-lg border border-slate-200 text-xs text-left space-y-1">
              <div className="flex justify-between">
                <span className="text-slate-500">Signed in as:</span>
                <span className="font-semibold text-slate-900">{user.name || user.username}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Your Keycloak Roles:</span>
                <span className="font-mono font-bold text-teal-700">{userRoleLabels}</span>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-center gap-2 pt-2">
              <Button asChild className="w-full bg-[#092C4C] hover:bg-[#061e34] text-white">
                <Link href={userPrimaryPortal}>
                  <UserCheck className="w-4 h-4 mr-1.5" />
                  <span>Go to My Workspace</span>
                </Link>
              </Button>
              <Button
                variant="outline"
                onClick={() => logout(true)}
                className="w-full border-slate-300 hover:bg-slate-100 text-slate-700"
              >
                Switch Account
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
}
