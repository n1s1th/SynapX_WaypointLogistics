"use client";

import React from "react";
import Link from "next/link";
import { Boxes, ArrowLeft, ScanBarcode, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { UserNotificationBell } from "@/components/notifications/user-notification-bell";

export default function WarehouseDashboard() {
  return (
    <div className="min-h-screen bg-background text-foreground font-sans p-6 sm:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <Button asChild variant="outline" size="sm" className="gap-2">
            <Link href="/">
              <ArrowLeft className="size-4" />
              <span>Back to Portal</span>
            </Link>
          </Button>
          <div className="flex items-center gap-2">
            <UserNotificationBell />
            <Badge variant="outline" className="text-accent border-accent/30 bg-accent/5">
              Role: Warehouse Manager &amp; Loader
            </Badge>
          </div>
        </div>

        <div className="border-b border-border pb-4">
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
            <Boxes className="size-6 text-primary" />
            <span>Warehouse &amp; Loading Dock Dashboard</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            SKU localization, loading dock staging, barcode verification, and inventory thresholds.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="border-border">
            <CardHeader>
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Boxes className="size-4 text-primary" />
                <span>Active SKUs</span>
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground">In Stock</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-foreground">14,290</div>
              <div className="text-xs text-muted-foreground mt-1">Across 4 Facilities</div>
            </CardContent>
          </Card>

          <Card className="border-border">
            <CardHeader>
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <ScanBarcode className="size-4 text-accent" />
                <span>Pending Inbound</span>
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground">Dock Staging</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-foreground">1,400 units</div>
              <div className="text-xs text-muted-foreground mt-1">Ready for barcode scan</div>
            </CardContent>
          </Card>

          <Card className="border-border">
            <CardHeader>
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <AlertTriangle className="size-4 text-warning" />
                <span>Low Stock Warnings</span>
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground">Below Reorder Point</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-warning-foreground">2 SKUs</div>
              <div className="text-xs text-muted-foreground mt-1">Reorder triggered</div>
            </CardContent>
          </Card>
        </div>

        <Card className="border-border">
          <CardHeader>
            <CardTitle className="text-sm font-semibold">Staging Lanes &amp; Scan Verification</CardTitle>
            <CardDescription className="text-xs text-muted-foreground">
              Dock staging queue for outgoing fleet dispatches
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-xs">
            <div className="p-3 rounded-lg border border-accent/30 bg-accent/5 flex items-center justify-between">
              <div>
                <span className="font-semibold text-foreground">Bay 3 Staging:</span> Pallet #P-03 (Dairy Chilled) &bull; Target: Trip #TRK-104
                <div className="text-muted-foreground mt-0.5">Cold Chain Spec: +2°C to +8°C (Sensor: +3.8°C Compliant)</div>
              </div>
              <Button size="xs" className="bg-accent text-accent-foreground hover:bg-accent/90">
                Confirm Scan
              </Button>
            </div>
            <div className="p-3 rounded-lg border border-border bg-card flex items-center justify-between">
              <div>
                <span className="font-semibold text-foreground">Bay 1 Staging:</span> Pallet #P-01 (Dry Goods) &bull; Target: Trip #TRK-105
                <div className="text-muted-foreground mt-0.5">Manifest verified and loaded</div>
              </div>
              <Badge variant="outline" className="text-accent border-accent/30">Verified</Badge>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
