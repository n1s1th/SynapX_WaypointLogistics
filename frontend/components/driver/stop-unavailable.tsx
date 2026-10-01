// What a stop screen shows while the trip loads, or when the stop isn't on the phone.

import Link from "next/link";
import { CloudOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DriverShell } from "./driver-shell";
import { Notice } from "./notice";

export function StopUnavailable({ loading, error, backHref }: { loading: boolean; error: string | null; backHref: string }) {
  return (
    <DriverShell title={loading ? "Loading stop…" : "Stop not found"} backHref={backHref}>
      {loading ? (
        <div className="flex flex-col gap-3" aria-busy="true">
          <Skeleton className="h-32 rounded-xl" />
          <Skeleton className="h-48 rounded-xl" />
        </div>
      ) : (
        <>
          <Notice tone={error ? "destructive" : "warning"} icon={CloudOff} title="This stop isn't on the phone">
            {error ?? "Open the trip once with signal and its stops stay available offline."}
          </Notice>
          <Button asChild variant="outline" size="lg" className="h-12">
            <Link href={backHref}>Back to the route</Link>
          </Button>
        </>
      )}
    </DriverShell>
  );
}
