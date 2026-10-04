import { RefreshCw } from "lucide-react";

export function TableLoading({ label }: { label: string }) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
      <RefreshCw aria-hidden="true" className="size-5 text-primary motion-safe:animate-spin" />
      <span>{label}</span>
    </div>
  );
}
