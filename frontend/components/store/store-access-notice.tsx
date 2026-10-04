"use client";

import Link from "next/link";
import { LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/lib/auth-context";

// Shown instead of the Store Manager screens when the login doesn't lead to an outlet: not signed in,
// signed in with another role, or a store manager the admin hasn't assigned to a store yet.
export function StoreAccessNotice({ title, message }: { title: string; message: string }) {
  const { isAuthenticated, loginWithKeycloak, logout } = useAuth();

  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md items-center gap-4 rounded-lg p-6 text-center ring-border md:p-8">
        <LockKeyhole className="size-10 text-primary" aria-hidden="true" />
        <h1 className="text-xl font-semibold text-primary">{title}</h1>
        <p className="text-sm text-muted-foreground">{message}</p>
        <div className="flex w-full flex-col gap-3 pt-2">
          {isAuthenticated ? (
            <Button onClick={() => logout(true)} className="h-11 text-base font-bold">
              Sign in with another account
            </Button>
          ) : (
            <Button onClick={() => loginWithKeycloak("store_manager")} className="h-11 text-base font-bold">
              Sign in
            </Button>
          )}
          <Button asChild variant="outline" className="h-11 border-2 border-primary text-base font-bold">
            <Link href="/">Back to Waypoint</Link>
          </Button>
        </div>
      </Card>
    </main>
  );
}
