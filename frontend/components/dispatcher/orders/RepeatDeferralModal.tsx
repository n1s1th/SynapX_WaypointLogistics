"use client";

import React, { useState } from "react";
import { type Order } from "@/types/order";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

interface RepeatDeferralModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  order: Order | null;
  isSubmitting?: boolean;
}

export function RepeatDeferralModal({
  isOpen,
  onClose,
  onConfirm,
  order,
  isSubmitting,
}: RepeatDeferralModalProps) {
  const [selectedReason, setSelectedReason] = useState<string>("Capacity limitation · no available reefer");

  if (!order) return null;

  const outletCode = order.destination_address?.split(",")[0] || `OUT-${order.id.toString().padStart(3, "0")}`;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-[480px] w-full p-6 rounded-[14px] bg-white border border-[#E5E5E2] shadow-2xl text-[#171A1F] overflow-hidden"
      >
        {/* Header */}
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h2 className="text-[20px] font-semibold tracking-tight text-[#171A1F]">
              Repeat Deferral Warning
            </h2>
          </div>
          <p className="text-[12px] text-[#6B7280]">
            This outlet was already deferred on the previous operating run.
          </p>
        </div>

        <div className="w-full h-px bg-[#E5E5E2] my-2" />

        {/* Badges */}
        <div className="flex items-center gap-2.5">
          <span className="inline-flex items-center px-3 py-1 rounded-full text-[11px] font-semibold bg-[#F6F6F3] text-[#18385F] border border-[#E5E5E2]">
            {outletCode}
          </span>
          <span className="inline-flex items-center px-3 py-1 rounded-full text-[10px] font-bold tracking-wide bg-[#FEF3C7] text-[#92400E] border border-[#FDE68A]">
            PREVIOUSLY DEFERRED
          </span>
        </div>

        <div className="text-[12px] font-semibold text-[#171A1F] mt-2">
          Avoid consecutive skips unless there is a defensible reason.
        </div>

        {/* Comparison Boxes */}
        <div className="space-y-2.5 mt-1">
          {/* Previous deferral */}
          <div className="p-3 rounded-[7px] bg-[#FBF6EC] border border-[#EBE3D3]">
            <div className="text-[11px] font-semibold text-[#A37A3B]">Previous deferral</div>
            <div className="text-[11px] text-[#6B7280] mt-0.5">
              Capacity shortfall · previous operating day
            </div>
          </div>

          {/* Current conflict */}
          <div className="p-3 rounded-[7px] bg-[#FDF2F2] border border-[#FEE2E2]">
            <div className="text-[11px] font-semibold text-[#DC2626]">Current conflict</div>
            <div className="text-[11px] text-[#6B7280] mt-0.5">
              {order.temperature_zone?.toLowerCase() === "chilled"
                ? "No reefer capacity remains for this chilled order"
                : "Vehicle fuel quota & trip limits prevent same-day dispatch"}
            </div>
          </div>
        </div>

        {/* Reason Selection */}
        <div className="space-y-1.5 mt-2">
          <label className="text-[12px] font-semibold text-[#171A1F]">
            Audit Deferral Reason
          </label>
          <select
            value={selectedReason}
            onChange={(e) => setSelectedReason(e.target.value)}
            className="w-full text-xs h-9 px-3 rounded-md border border-[#E5E5E2] bg-white text-[#171A1F] focus:outline-none focus:ring-1 focus:ring-[#18385F]"
          >
            <option value="Capacity limitation · no available reefer">Capacity limitation · no available reefer</option>
            <option value="Depot stock shortage · low inventory on ordered items">Depot stock shortage · low inventory on ordered items</option>
            <option value="Outlet dock access restriction">Outlet dock access restriction</option>
            <option value="Weekly fuel quota limit reached">Weekly fuel quota limit reached</option>
            <option value="Customer requested reschedule">Customer requested reschedule</option>
          </select>
        </div>

        {/* Audit notice */}
        <div className="p-2.5 rounded-md bg-[#F9FAFB] border border-[#E5E5E2] text-[10px] text-[#6B7280] leading-normal">
          Continuing the deferral will create a consecutive-deferral record. The reason is captured for management review and SLA audit.
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-between gap-3 pt-3 mt-1 border-t border-[#E5E5E2]">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={isSubmitting}
            className="h-10 px-4 text-xs font-semibold text-[#171A1F] border-[#E5E5E2] hover:bg-slate-50"
          >
            <ArrowLeft className="size-3.5 mr-1.5" />
            Back
          </Button>

          <Button
            type="button"
            onClick={() => onConfirm(selectedReason)}
            disabled={isSubmitting}
            className="h-10 px-6 text-xs font-semibold bg-[#18385F] hover:bg-[#122b49] text-white shadow-sm"
          >
            {isSubmitting ? "Deferring..." : "Continue Deferral"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
