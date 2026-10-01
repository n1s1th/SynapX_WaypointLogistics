"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  Truck,
  Package,
  ThermometerSnowflake,
  Sun,
  Clock,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Search,
  Filter,
  User,
  Radio,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StorePill } from "@/components/store/status-pill";
import { StoreMetricCard } from "@/components/store/store-cards";

interface DeliveryItem {
  id: string;
  orderNumber: string;
  brand: string;
  tempRequirement: "chilled" | "ambient";
  driverName: string;
  driverPhone: string;
  vehicleId: string;
  vehiclePlate: string;
  currentLocation: string;
  estimatedArrival: string;
  window: string;
  status: "in_transit" | "arriving_soon" | "at_dock" | "delivered" | "delayed";
  totalUnits: number;
  totalWeightKg: number;
  coldChainTemp?: string;
  sealNumber: string;
}

const mockDeliveries: DeliveryItem[] = [
  {
    id: "del-001",
    orderNumber: "ORD0000001",
    brand: "Fresh",
    tempRequirement: "chilled",
    driverName: "Kamal Perera",
    driverPhone: "+94 77 123 4567",
    vehicleId: "VEH001",
    vehiclePlate: "WP-GA-4892",
    currentLocation: "1.2 km away (Maradana Junction)",
    estimatedArrival: "06:45 AM (in 15 mins)",
    window: "04:00 – 07:45",
    status: "arriving_soon",
    totalUnits: 40,
    totalWeightKg: 120.5,
    coldChainTemp: "+3.8°C (Normal)",
    sealNumber: "SL-994021",
  },
  {
    id: "del-002",
    orderNumber: "ORD0000002",
    brand: "Fresh",
    tempRequirement: "ambient",
    driverName: "Saman Kumara",
    driverPhone: "+94 71 987 6543",
    vehicleId: "VEH004",
    vehiclePlate: "WP-ND-3310",
    currentLocation: "Loading Dock 2",
    estimatedArrival: "Arrived",
    window: "04:00 – 07:45",
    status: "at_dock",
    totalUnits: 25,
    totalWeightKg: 80.0,
    sealNumber: "SL-884019",
  },
  {
    id: "del-003",
    orderNumber: "ORD0000004",
    brand: "Fresh",
    tempRequirement: "chilled",
    driverName: "Carlos Mendes",
    driverPhone: "+94 76 555 1212",
    vehicleId: "VEH035",
    vehiclePlate: "WP-LY-7721",
    currentLocation: "Departed Peliyagoda Hub",
    estimatedArrival: "07:30 AM",
    window: "04:00 – 07:45",
    status: "in_transit",
    totalUnits: 15,
    totalWeightKg: 45.0,
    coldChainTemp: "+3.6°C (Cold Chain OK)",
    sealNumber: "SL-772014",
  },
];

export default function IncomingDeliveriesPage() {
  const [filter, setFilter] = useState<string>("ALL");
  const [search, setSearch] = useState("");

  const filtered = mockDeliveries.filter((d) => {
    if (filter !== "ALL" && d.status !== filter) return false;
    if (
      search &&
      !d.orderNumber.toLowerCase().includes(search.toLowerCase()) &&
      !d.driverName.toLowerCase().includes(search.toLowerCase())
    ) {
      return false;
    }
    return true;
  });

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Page Header */}
      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold text-primary md:text-3xl md:font-bold">
          Incoming Deliveries
        </h1>
        <p className="text-xs sm:text-sm text-muted-foreground">
          Real-time tracking of dispatch vehicles, cold-chain integrity, and active receiving dock status for Fresh Colombo.
        </p>
      </div>

      {/* Metrics Row */}
      <section aria-label="Deliveries Summary" className="grid grid-cols-2 gap-3.5 xl:grid-cols-3">
        <StoreMetricCard
          label="Active Vehicles En Route"
          value="2"
          caption="1 arriving within 15 mins"
          mobileCaption="2 en route"
        />
        <StoreMetricCard
          label="At Loading Dock"
          value="1"
          caption="ORD0000002 ready to receive"
          mobileCaption="1 at dock"
        />
        <StoreMetricCard
          label="Cold-Chain Verified"
          value="100%"
          caption="All chilled containers in spec"
          mobileCaption="100% compliant"
          className="col-span-2 xl:col-span-1"
        />
      </section>

      {/* Filter & Search Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-card p-3.5 rounded-lg border border-border shadow-xs">
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Filter className="size-4 text-muted-foreground shrink-0" />
          <div className="flex items-center gap-1.5 overflow-x-auto w-full">
            {[
              { key: "ALL", label: "All Deliveries" },
              { key: "at_dock", label: "At Dock (Ready)" },
              { key: "arriving_soon", label: "Arriving Soon" },
              { key: "in_transit", label: "In Transit" },
            ].map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                  filter === f.key
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search order or driver..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 text-xs h-9 bg-background"
          />
        </div>
      </div>

      {/* Deliveries List */}
      <div className="space-y-4">
        {filtered.map((del) => {
          const isAtDock = del.status === "at_dock";

          return (
            <div
              key={del.id}
              className={`bg-card border rounded-xl p-5 sm:p-6 shadow-xs transition-all hover:shadow-md ${
                isAtDock
                  ? "border-warning/60 bg-warning-muted/20 ring-1 ring-warning/30"
                  : "border-border"
              }`}
            >
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                {/* Left: Order Info & Status */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-base font-bold text-foreground">
                      {del.orderNumber}
                    </span>
                    <span className="text-xs font-mono font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded">
                      {del.vehicleId} ({del.vehiclePlate})
                    </span>
                    <StorePill tone="brand">
                      {del.brand}
                    </StorePill>
                    {del.tempRequirement === "chilled" ? (
                      <StorePill tone="info" className="gap-1">
                        <ThermometerSnowflake className="size-3" />
                        Chilled
                      </StorePill>
                    ) : (
                      <StorePill tone="warning" className="gap-1">
                        <Sun className="size-3" />
                        Ambient
                      </StorePill>
                    )}
                    {isAtDock ? (
                      <StorePill tone="warning">At Dock (Ready)</StorePill>
                    ) : del.status === "arriving_soon" ? (
                      <StorePill tone="brand">Arriving Soon</StorePill>
                    ) : (
                      <StorePill tone="neutral">In Transit</StorePill>
                    )}
                  </div>

                  <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                    <span className="flex items-center gap-1">
                      <Clock className="size-3.5" />
                      Window: <strong className="text-foreground">{del.window}</strong>
                    </span>
                    <span className="flex items-center gap-1">
                      <Radio className="size-3.5 text-primary animate-pulse" />
                      Location: <strong className="text-foreground">{del.currentLocation}</strong>
                    </span>
                    <span className="flex items-center gap-1">
                      <User className="size-3.5" />
                      Driver: <strong className="text-foreground">{del.driverName}</strong> ({del.driverPhone})
                    </span>
                  </div>
                </div>

                {/* Right: ETA & Action Button */}
                <div className="flex items-center gap-3 self-start lg:self-auto shrink-0">
                  <div className="text-right hidden sm:block">
                    <div className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">
                      Estimated Arrival
                    </div>
                    <div className="text-sm font-bold text-foreground">
                      {del.estimatedArrival}
                    </div>
                  </div>

                  <Button asChild size="default" className="h-9 px-4 text-xs font-bold bg-primary text-primary-foreground hover:bg-primary/90">
                    <Link href={`/store/deliveries/${del.orderNumber}`}>
                      <span>{isAtDock ? "Receive & Verify Goods" : "View Tracking"}</span>
                      <ArrowRight className="size-3.5 ml-1" />
                    </Link>
                  </Button>
                </div>
              </div>

              {/* Specs & Cold Chain Integrity footer */}
              <div className="mt-4 pt-3.5 border-t border-border/60 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div>
                  <span className="text-muted-foreground">Units:</span>{" "}
                  <strong className="text-foreground">{del.totalUnits} cartons</strong>
                </div>
                <div>
                  <span className="text-muted-foreground">Weight:</span>{" "}
                  <strong className="text-foreground">{del.totalWeightKg} kg</strong>
                </div>
                <div>
                  <span className="text-muted-foreground">Container Seal:</span>{" "}
                  <strong className="text-foreground font-mono">{del.sealNumber}</strong>
                </div>
                <div>
                  <span className="text-muted-foreground">Temp Telemetry:</span>{" "}
                  <strong className={del.coldChainTemp ? "text-success font-semibold" : "text-foreground"}>
                    {del.coldChainTemp || "Ambient"}
                  </strong>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
