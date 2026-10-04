"use client";

import { useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { Truck } from "lucide-react";

export default function LoginPage() {
  const { loginWithKeycloak, isAuthenticated } = useAuth();

  useEffect(() => {
    if (!isAuthenticated) {
      void loginWithKeycloak();
    }
  }, [isAuthenticated, loginWithKeycloak]);

  return (
    <div className="min-h-screen bg-[#F6F7F9] text-slate-900 flex flex-col items-center justify-center p-4 font-sans antialiased">
      <div className="flex flex-col items-center gap-4 text-center max-w-sm">
        <div className="h-12 w-12 rounded-xl bg-[#092C4C] flex items-center justify-center text-white shadow-sm">
          <Truck className="h-6 w-6 text-white" />
        </div>
        <div className="relative mx-auto w-10 h-10 flex items-center justify-center mt-2">
          <div className="absolute inset-0 rounded-full border-3 border-slate-200 border-t-[#092C4C] animate-spin" />
        </div>
        <div>
          <h1 className="text-base font-bold text-slate-900">Redirecting to Waypoint Sign-in</h1>
          <p className="text-xs text-slate-500 mt-1">Connecting to Keycloak Single Sign-On...</p>
        </div>
      </div>
    </div>
  );
}
