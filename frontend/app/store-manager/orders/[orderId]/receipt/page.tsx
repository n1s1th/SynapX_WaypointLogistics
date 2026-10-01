"use client";

import React, { useEffect, useState, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  Package,
  Weight,
  Layers,
  ThermometerSnowflake,
  Sun,
  Send,
  RefreshCw,
  WifiOff,
  Clock,
  Building2,
  FileCheck2,
  XCircle,
} from "lucide-react";
import {
  submitDeliveryReceipt,
  getDeliveryReceipt,
  DeliveryReceipt,
  ReceiptCreatePayload,
} from "@/services/api";

export default function ReceiptConfirmationPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const resolvedParams = use(params);
  const orderId = resolvedParams.orderId;
  const router = useRouter();

  const [existingReceipt, setExistingReceipt] = useState<DeliveryReceipt | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasIssue, setHasIssue] = useState<boolean>(false);
  const [issueType, setIssueType] = useState<string>("short_delivery");
  const [issueDescription, setIssueDescription] = useState<string>("");
  const [unitsReceived, setUnitsReceived] = useState<number>(40);
  const [weightReceived, setWeightReceived] = useState<number>(120.5);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<{
    success: boolean;
    isOffline?: boolean;
    message?: string;
  } | null>(null);

  // Mock order data for store manager view
  const orderSummary = {
    id: orderId,
    outlet_id: "OUT001",
    outlet_name: "Colombo Fresh - Pettah",
    brand: "Fresh",
    expected_units: 40,
    expected_weight_kg: 120.5,
    temp_requirement: "chilled",
    delivered_at: "Today, 07:15 AM",
  };

  useEffect(() => {
    async function checkExisting() {
      setIsLoading(true);
      try {
        const receipt = await getDeliveryReceipt(orderId);
        if (receipt) {
          setExistingReceipt(receipt);
        }
      } catch {
        // No receipt yet
      } finally {
        setIsLoading(false);
      }
    }
    checkExisting();
  }, [orderId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (hasIssue && issueDescription.trim().length < 10) return;

    setIsSubmitting(true);
    const payload: ReceiptCreatePayload = {
      order_id: orderId,
      outlet_id: orderSummary.outlet_id,
      units_received: unitsReceived,
      weight_received_kg: weightReceived,
      has_issues: hasIssue,
      issue_type: hasIssue ? issueType : undefined,
      issue_description: hasIssue ? issueDescription.trim() : undefined,
      confirmed_at: new Date().toISOString(),
    };

    try {
      const { isOffline } = await submitDeliveryReceipt(payload);
      if (isOffline) {
        setSubmitResult({
          success: true,
          isOffline: true,
          message: "You're offline. Your receipt has been saved and will sync automatically when you reconnect.",
        });
      } else {
        setSubmitResult({
          success: true,
          isOffline: false,
          message: hasIssue
            ? "Receipt and issue report submitted. Central dispatch has been notified."
            : "Receipt confirmed. Thank you!",
        });
      }

      setTimeout(() => {
        router.push("/store");
      }, 2500);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Submission failed";
      setSubmitResult({
        success: false,
        message: msg,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex items-center justify-center p-4">
        <div className="text-center space-y-3">
          <RefreshCw className="size-8 animate-spin mx-auto text-teal-700" />
          <p className="text-sm font-medium text-zinc-500">Checking delivery status...</p>
        </div>
      </div>
    );
  }

  // If already confirmed
  if (existingReceipt) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex items-center justify-center p-4 font-sans antialiased">
        <div className="max-w-md w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 sm:p-8 text-center shadow-lg space-y-5">
          <div className="w-16 h-16 rounded-full bg-teal-100 dark:bg-teal-950/60 text-teal-700 dark:text-teal-400 mx-auto flex items-center justify-center">
            <FileCheck2 className="size-10" />
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
              Receipt Already Confirmed
            </h1>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Delivery for order <strong>{orderId.slice(0, 8)}...</strong> was previously confirmed on{" "}
              {existingReceipt.confirmed_at ? new Date(existingReceipt.confirmed_at).toLocaleDateString() : "today"}.
            </p>
          </div>
          <div className="p-4 rounded-xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700/60 text-xs text-left space-y-1">
            <div><strong>Units Received:</strong> {existingReceipt.units_received ?? "All"}</div>
            <div><strong>Issues Flagged:</strong> {existingReceipt.has_issues ? existingReceipt.issue_type : "None (All Good)"}</div>
          </div>
          <Link
            href="/store"
            className="w-full min-h-[48px] inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-teal-700 hover:bg-teal-800 text-white font-bold text-sm shadow-xs transition-colors cursor-pointer"
          >
            <span>Back to Store Orders</span>
          </Link>
        </div>
      </div>
    );
  }

  // If result submitted
  if (submitResult && submitResult.success) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex items-center justify-center p-4 font-sans antialiased">
        <div className="max-w-md w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 sm:p-8 text-center shadow-lg space-y-6">
          <div
            className={`w-16 h-16 rounded-full mx-auto flex items-center justify-center ${
              submitResult.isOffline
                ? "bg-amber-100 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400"
                : "bg-emerald-100 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400"
            }`}
          >
            {submitResult.isOffline ? <WifiOff className="size-10" /> : <CheckCircle2 className="size-10" />}
          </div>

          <div className="space-y-2">
            <h1 className="text-2xl font-black tracking-tight text-zinc-900 dark:text-zinc-100">
              {submitResult.isOffline ? "Saved Offline" : "Receipt Confirmed"}
            </h1>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              {submitResult.message}
            </p>
          </div>

          <div className="text-xs text-zinc-400 animate-pulse">
            Redirecting to orders dashboard in a moment...
          </div>
        </div>
      </div>
    );
  }

  const isFormValid = !hasIssue || issueDescription.trim().length >= 10;

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 pb-20 font-sans antialiased">
      {/* Top Header */}
      <header className="sticky top-0 z-40 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-md border-b border-zinc-200 dark:border-zinc-800 px-4 sm:px-6 py-3.5 shadow-xs">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-4">
          <Link
            href="/store"
            className="inline-flex items-center gap-2 text-xs sm:text-sm font-semibold text-zinc-600 dark:text-zinc-400 hover:text-teal-700 transition-colors cursor-pointer"
          >
            <ArrowLeft className="size-4" />
            <span>Back to Orders</span>
          </Link>
          <span className="text-xs font-mono font-medium text-zinc-500">
            Order: {orderId.slice(0, 8)}...
          </span>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 pt-6">
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Header */}
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-teal-100 text-teal-800 dark:bg-teal-950/60 dark:text-teal-300 border border-teal-300 dark:border-teal-800">
              <Package className="size-3.5" />
              <span>Store Manager Delivery Confirmation</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-zinc-900 dark:text-zinc-100">
              Confirm Delivery Receipt
            </h1>
            <p className="text-xs sm:text-sm text-zinc-500 dark:text-zinc-400">
              Verify the goods delivered to <strong>{orderSummary.outlet_name}</strong> and report any discrepancies.
            </p>
          </div>

          {/* Ordered vs Delivered Specs Card */}
          <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5 sm:p-6 shadow-xs space-y-4">
            <div className="flex items-center justify-between gap-2 border-b border-zinc-100 dark:border-zinc-800 pb-3">
              <div className="flex items-center gap-2">
                <Building2 className="size-4 text-teal-700" />
                <span className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                  {orderSummary.outlet_name} ({orderSummary.outlet_id})
                </span>
              </div>
              <span className="text-xs font-semibold px-2.5 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800">
                {orderSummary.brand}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="p-3 bg-zinc-50 dark:bg-zinc-800/60 rounded-xl">
                <div className="text-[10px] uppercase font-bold text-zinc-500">Ordered Units</div>
                <div className="text-lg font-black text-zinc-900 dark:text-zinc-100 mt-0.5">
                  {orderSummary.expected_units}
                </div>
              </div>
              <div className="p-3 bg-zinc-50 dark:bg-zinc-800/60 rounded-xl">
                <div className="text-[10px] uppercase font-bold text-zinc-500">Ordered Weight</div>
                <div className="text-lg font-black text-zinc-900 dark:text-zinc-100 mt-0.5">
                  {orderSummary.expected_weight_kg} kg
                </div>
              </div>
              <div className="p-3 bg-zinc-50 dark:bg-zinc-800/60 rounded-xl">
                <div className="text-[10px] uppercase font-bold text-zinc-500">Delivered At</div>
                <div className="text-xs sm:text-sm font-bold text-zinc-900 dark:text-zinc-100 mt-1">
                  {orderSummary.delivered_at}
                </div>
              </div>
            </div>
          </section>

          {/* Primary Selection: All Good vs Report Issue */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <button
              type="button"
              onClick={() => {
                setHasIssue(false);
                setUnitsReceived(orderSummary.expected_units);
              }}
              className={`p-5 rounded-2xl border-2 text-left transition-all cursor-pointer flex flex-col justify-between gap-3 shadow-xs ${
                !hasIssue
                  ? "border-teal-700 bg-teal-50/40 dark:bg-teal-950/30 ring-2 ring-teal-700/20"
                  : "border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-zinc-300"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 flex items-center justify-center">
                  <CheckCircle2 className="size-6" />
                </div>
                {!hasIssue && (
                  <span className="text-xs font-bold text-teal-700 dark:text-teal-400 bg-teal-100 dark:bg-teal-900/40 px-2 py-0.5 rounded-full">
                    Selected
                  </span>
                )}
              </div>
              <div>
                <div className="text-base font-extrabold text-zinc-900 dark:text-zinc-100">
                  All Received Correctly
                </div>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                  Full quantity arrived intact with proper temperature control and zero defects.
                </p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setHasIssue(true)}
              className={`p-5 rounded-2xl border-2 text-left transition-all cursor-pointer flex flex-col justify-between gap-3 shadow-xs ${
                hasIssue
                  ? "border-amber-600 bg-amber-50/40 dark:bg-amber-950/30 ring-2 ring-amber-600/20"
                  : "border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-zinc-300"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400 flex items-center justify-center">
                  <AlertTriangle className="size-6" />
                </div>
                {hasIssue && (
                  <span className="text-xs font-bold text-amber-800 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/40 px-2 py-0.5 rounded-full">
                    Selected
                  </span>
                )}
              </div>
              <div>
                <div className="text-base font-extrabold text-zinc-900 dark:text-zinc-100">
                  Report an Issue
                </div>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                  Missing units, damaged goods, wrong items, or seal tampering identified.
                </p>
              </div>
            </button>
          </div>

          {/* Simple Units Received (If All Received) */}
          {!hasIssue && (
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5 shadow-xs flex items-center justify-between gap-4">
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
                  Confirmed Units Received
                </label>
                <p className="text-xs text-zinc-400">Matches ordered quantity</p>
              </div>
              <input
                type="number"
                min="0"
                value={unitsReceived}
                onChange={(e) => setUnitsReceived(parseInt(e.target.value, 10))}
                className="w-28 text-center text-xl font-bold py-2 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100"
              />
            </div>
          )}

          {/* Detailed Issue Form (If Report an Issue Selected) */}
          {hasIssue && (
            <section className="bg-white dark:bg-zinc-900 border border-amber-300 dark:border-amber-700/60 rounded-2xl p-5 sm:p-6 shadow-xs space-y-5">
              <div className="text-xs font-bold uppercase tracking-wider text-amber-800 dark:text-amber-400">
                Issue Details &amp; Discrepancy Log
              </div>

              {/* Issue Type Radio Cards */}
              <div className="space-y-2">
                <label className="block text-xs font-bold uppercase text-zinc-600 dark:text-zinc-300">
                  Issue Classification <span className="text-rose-500">*</span>
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { id: "short_delivery", label: "Short Delivery" },
                    { id: "damaged", label: "Damaged Goods" },
                    { id: "wrong_items", label: "Wrong Items" },
                    { id: "other", label: "Other" },
                  ].map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setIssueType(t.id)}
                      className={`p-3 rounded-xl border text-xs font-bold text-center transition-all cursor-pointer ${
                        issueType === t.id
                          ? "bg-amber-500 text-zinc-950 border-amber-600 shadow-xs"
                          : "bg-zinc-50 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100"
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Actual Units Received Field */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="block text-xs font-bold uppercase text-zinc-600 dark:text-zinc-300">
                    Actual Units Received <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="number"
                    min="0"
                    required
                    value={unitsReceived}
                    onChange={(e) => setUnitsReceived(parseInt(e.target.value, 10))}
                    className="w-full text-base font-bold p-3 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100"
                  />
                  <span className="text-[11px] text-zinc-400">
                    Expected: {orderSummary.expected_units} units
                  </span>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-bold uppercase text-zinc-600 dark:text-zinc-300">
                    Actual Weight Received (kg)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    value={weightReceived}
                    onChange={(e) => setWeightReceived(parseFloat(e.target.value))}
                    className="w-full text-base font-bold p-3 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100"
                  />
                </div>
              </div>

              {/* Issue Description Field */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold uppercase text-zinc-600 dark:text-zinc-300">
                  Issue Description / Remarks <span className="text-rose-500">*</span>
                </label>
                <textarea
                  rows={4}
                  required
                  value={issueDescription}
                  onChange={(e) => setIssueDescription(e.target.value)}
                  placeholder="Provide details about the damage, missing cartons, or batch mismatches..."
                  className="w-full text-sm p-3.5 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:border-amber-500 focus:outline-none resize-none"
                />
                <div className="flex items-center justify-between text-xs text-zinc-400">
                  <span>Min 10 characters</span>
                  <span className={issueDescription.length < 10 ? "text-amber-600 font-semibold" : "text-emerald-600"}>
                    {issueDescription.length} characters
                  </span>
                </div>
              </div>
            </section>
          )}

          {/* Submit Button */}
          <button
            type="submit"
            disabled={!isFormValid || isSubmitting}
            className={`w-full min-h-[52px] inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-2xl font-bold text-base shadow-sm transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
              hasIssue
                ? "bg-amber-500 hover:bg-amber-600 text-zinc-950 border border-amber-600/30"
                : "bg-teal-700 hover:bg-teal-800 text-white"
            }`}
          >
            {isSubmitting ? (
              <>
                <RefreshCw className="size-5 animate-spin" />
                <span>Submitting Receipt...</span>
              </>
            ) : hasIssue ? (
              <>
                <Send className="size-5" />
                <span>Submit Discrepancy &amp; Confirm Receipt</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="size-5" />
                <span>Confirm Delivery Receipt</span>
              </>
            )}
          </button>
        </form>
      </main>
    </div>
  );
}
