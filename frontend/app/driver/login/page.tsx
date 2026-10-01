"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CloudOff, Eye, EyeOff, Lock, Mail, Navigation } from "lucide-react";
import { ApiError } from "@/lib/api";
import { clearToken, setToken } from "@/lib/auth";
import { driverApi } from "@/lib/driver/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/driver/notice";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { access_token } = await driverApi.login(email.trim(), password);
      setToken(access_token);
      // The driver API only answers drivers: check before going in.
      await driverApi.me();
      router.replace(next?.startsWith("/driver") ? next : "/driver");
    } catch (err) {
      clearToken();
      if (err instanceof ApiError && err.status === 403) setError("This account isn't a driver account.");
      else if (err instanceof ApiError && !err.isNetworkError) setError(err.message);
      else setError("Couldn't reach Waypoint. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <div className="flex flex-col gap-8 bg-brand-strong px-5 pt-10 pb-12 text-white">
        <div className="flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-xl border border-white/25 bg-white/15">
            <Navigation className="size-4.5" aria-hidden />
          </span>
          <span className="text-xl font-extrabold tracking-widest">WAYPOINT</span>
        </div>
        <div className="flex max-w-xs flex-col gap-2">
          <span className="text-[11px] font-bold tracking-[0.12em] text-white/70">DRIVER</span>
          <h1 className="text-4xl leading-tight font-extrabold">Ready for today&apos;s run?</h1>
          <p className="text-sm text-white/75">Sign in to see your trips and record each delivery.</p>
        </div>
      </div>

      <form onSubmit={submit} className="-mt-6 flex flex-1 flex-col gap-5 rounded-t-2xl bg-card px-5 pt-7 pb-6">
        {error && (
          <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive-muted px-3 py-2.5 text-sm font-medium text-destructive">
            {error}
          </p>
        )}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="driver-email">Email</Label>
          <div className="relative">
            <Mail className="pointer-events-none absolute top-1/2 left-3 size-4.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              id="driver-email"
              type="email"
              inputMode="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-12 pl-10 text-base"
              placeholder="you@waypoint.com"
            />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="driver-password">Password</Label>
          <div className="relative">
            <Lock className="pointer-events-none absolute top-1/2 left-3 size-4.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              id="driver-password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-12 pr-12 pl-10 text-base"
            />
            <button
              type="button"
              onClick={() => setShowPassword((shown) => !shown)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              className="absolute top-1/2 right-1 flex size-10 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              {showPassword ? <EyeOff className="size-4.5" /> : <Eye className="size-4.5" />}
            </button>
          </div>
        </div>
        <Button type="submit" size="lg" disabled={busy} className="h-13 text-base font-bold">
          {busy ? "Signing in…" : "Sign in"}
        </Button>

        <Notice tone="info" icon={CloudOff} title="Works without signal once you're signed in" className="mt-auto">
          Your trips and delivery records are kept on this phone and sync when you&apos;re back online.
        </Notice>
      </form>
    </div>
  );
}

export default function DriverLoginPage() {
  return (
    <React.Suspense fallback={<div className="min-h-dvh bg-background" />}>
      <LoginForm />
    </React.Suspense>
  );
}
