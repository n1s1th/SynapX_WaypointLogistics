"use client";

import React, { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  Truck,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  ArrowRight,
  Lock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  getDefaultPortalForRoles,
  KeycloakAppRole,
  ROLE_CONFIGS,
} from "@/lib/keycloak";
import {
  PKCE_STATE_KEY,
  PKCE_VERIFIER_KEY,
  saveAuthSession,
  TARGET_ROLE_KEY,
} from "@/lib/auth";

// A Keycloak login code works once. React runs effects twice in development (and the effect can re-run when
// the router updates), so remember which codes this page load already sent and never send one again.
const exchangedCodes = new Set<string>();

function CallbackHandler() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [status, setStatus] = useState<"processing" | "success" | "error">("processing");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [detectedRoles, setDetectedRoles] = useState<KeycloakAppRole[]>([]);
  const [destination, setDestination] = useState<string>("/");
  const [userName, setUserName] = useState<string>("");

  useEffect(() => {
    async function processCallback() {
      const code = searchParams.get("code");
      const state = searchParams.get("state");
      const error = searchParams.get("error");
      const errorDescription = searchParams.get("error_description");

      if (error) {
        setStatus("error");
        setErrorMessage(errorDescription || error || "Keycloak authentication failed");
        return;
      }

      if (!code) {
        setStatus("error");
        setErrorMessage("No authorization code received from Keycloak");
        return;
      }
      if (exchangedCodes.has(code)) return;
      exchangedCodes.add(code);

      // Validate PKCE state if present in session
      const savedState = sessionStorage.getItem(PKCE_STATE_KEY);
      if (savedState && state && savedState !== state) {
        setStatus("error");
        setErrorMessage("Security state mismatch. Please initiate sign in again.");
        return;
      }

      const verifier = sessionStorage.getItem(PKCE_VERIFIER_KEY) || undefined;
      const targetRole = sessionStorage.getItem(TARGET_ROLE_KEY) as KeycloakAppRole | null;
      const redirectUri = `${window.location.origin}/auth/callback`;

      try {
        const res = await fetch("/api/auth/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code,
            code_verifier: verifier,
            redirect_uri: redirectUri,
          }),
        });

        const data = await res.json();

        if (!res.ok) {
          setStatus("error");
          setErrorMessage(data.error_description || "Token exchange with Keycloak failed");
          return;
        }

        // Store tokens & extract profile
        const user = saveAuthSession({
          access_token: data.access_token,
          refresh_token: data.refresh_token,
          id_token: data.id_token,
        });

        setUserName(user.name || user.username);
        setDetectedRoles(user.roles);

        // Determine destination portal based on Keycloak role
        let targetPortal = getDefaultPortalForRoles(user.roles);
        if (targetRole && user.roles.includes(targetRole)) {
          targetPortal = ROLE_CONFIGS[targetRole].route;
        }

        setDestination(targetPortal);
        setStatus("success");

        // Clean up temporary PKCE keys
        sessionStorage.removeItem(PKCE_STATE_KEY);
        sessionStorage.removeItem(PKCE_VERIFIER_KEY);
        sessionStorage.removeItem(TARGET_ROLE_KEY);

        // Immediate direct redirect to role portal
        router.replace(targetPortal);
      } catch (err: unknown) {
        setStatus("error");
        setErrorMessage(
          err instanceof Error ? err.message : "Unexpected connection error during login"
        );
      }
    }

    void processCallback();
  }, [router, searchParams]);

  return (
    <div className="min-h-screen bg-[#F6F7F9] text-slate-900 flex flex-col items-center justify-center p-4 font-sans antialiased">
      <div className="w-full max-w-md">
        {/* Brand Header */}
        <div className="flex flex-col items-center text-center gap-3 mb-6">
          <div className="h-12 w-12 rounded-xl bg-[#092C4C] flex items-center justify-center text-white shadow-sm">
            <Truck className="h-6 w-6 text-white" />
          </div>
          <div>
            <div className="flex items-center justify-center gap-2">
              <span className="font-bold text-lg tracking-tight text-slate-900">
                Waypoint Logistics
              </span>
              <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-300">
                SynapX
              </span>
            </div>
            <p className="text-xs text-slate-500 font-medium mt-0.5">
              Operations Platform &bull; Single Sign-On
            </p>
          </div>
        </div>

        {/* Status Card matching Waypoint styling */}
        <Card className="border border-slate-200 bg-white shadow-xl rounded-2xl overflow-hidden">
          <CardContent className="pt-8 pb-8 px-6 text-center space-y-5">
            {status === "processing" && (
              <div className="space-y-4">
                <div className="relative mx-auto w-14 h-14 flex items-center justify-center">
                  <div className="absolute inset-0 rounded-full border-3 border-slate-200 border-t-[#092C4C] animate-spin" />
                  <Lock className="w-5 h-5 text-[#092C4C]" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-900">Authenticating with Keycloak</h2>
                  <p className="text-xs text-slate-500 mt-1">
                    Verifying authorization credentials and permissions...
                  </p>
                </div>
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-100 border border-slate-200 text-[11px] text-slate-600 font-mono">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  Realm: waypointlogistics
                </div>
              </div>
            )}

            {status === "success" && (
              <div className="space-y-4">
                <div className="mx-auto w-14 h-14 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600">
                  <CheckCircle2 className="w-7 h-7" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-900">Signed In Successfully</h2>
                  <p className="text-xs text-slate-600 mt-1">
                    Welcome back, <span className="font-semibold text-slate-900">{userName}</span>
                  </p>
                </div>

                {detectedRoles.length > 0 && (
                  <div className="pt-1">
                    <p className="text-[11px] text-slate-500 mb-1.5 font-medium">Assigned Keycloak Roles:</p>
                    <div className="flex flex-wrap items-center justify-center gap-1.5">
                      {detectedRoles.map((role) => (
                        <span
                          key={role}
                          className="px-2.5 py-0.5 rounded text-xs font-semibold bg-slate-100 border border-slate-300 text-slate-800 uppercase tracking-wide font-mono"
                        >
                          {role}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <div className="pt-2">
                  <Button
                    asChild
                    className="w-full bg-[#092C4C] hover:bg-[#061e34] text-white font-medium text-xs h-10 shadow-xs"
                  >
                    <Link href={destination} className="flex items-center justify-center gap-2">
                      <span>Entering Workspace</span>
                      <ArrowRight className="w-4 h-4" />
                    </Link>
                  </Button>
                </div>
              </div>
            )}

            {status === "error" && (
              <div className="space-y-4">
                <div className="mx-auto w-14 h-14 rounded-full bg-rose-50 border border-rose-200 flex items-center justify-center text-rose-600">
                  <AlertTriangle className="w-7 h-7" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-900">Authentication Failed</h2>
                  <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded p-2.5 mt-2 font-mono break-all text-left">
                    {errorMessage}
                  </p>
                </div>
                <div className="pt-2">
                  <Button
                    asChild
                    className="w-full bg-[#092C4C] hover:bg-[#061e34] text-white text-xs h-10"
                  >
                    <Link href="/login">Return to Sign In</Link>
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#F6F7F9] flex items-center justify-center">
          <div className="flex items-center gap-3 text-slate-600">
            <RefreshCw className="w-5 h-5 animate-spin text-[#092C4C]" />
            <span className="text-sm font-medium">Validating session...</span>
          </div>
        </div>
      }
    >
      <CallbackHandler />
    </Suspense>
  );
}
