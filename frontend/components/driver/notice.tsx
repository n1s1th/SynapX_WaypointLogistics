// A persistent operational notice (frontend/AGENTS.md: Alert for persistent
// problems), in the semantic status tones.

import * as React from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

const TONES = {
  info: "border-info/25 bg-info-muted text-info",
  success: "border-success/25 bg-success-muted text-success",
  warning: "border-warning/30 bg-warning-muted text-warning",
  destructive: "border-destructive/30 bg-destructive-muted text-destructive",
} as const;

export function Notice({
  tone,
  icon: Icon,
  title,
  children,
  className,
}: {
  tone: keyof typeof TONES;
  icon: React.ComponentType<{ className?: string }>;
  title: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <Alert className={cn("px-3 py-2.5", TONES[tone], className)}>
      <Icon aria-hidden />
      <AlertTitle className="font-semibold">{title}</AlertTitle>
      {children && <AlertDescription className="text-current/90">{children}</AlertDescription>}
    </Alert>
  );
}
