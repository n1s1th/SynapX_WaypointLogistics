"use client";

import React, { useEffect, useState, useCallback } from "react";
import { CloudUpload, WifiOff, X, RefreshCw, CheckCircle2, AlertCircle } from "lucide-react";
import { getOfflineReceipts, syncOfflineReceipts, clearOfflineReceipts, ReceiptCreatePayload } from "@/services/api";

export function OfflineSyncBanner() {
  const [offlineReceipts, setOfflineReceipts] = useState<ReceiptCreatePayload[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);

  const checkQueue = useCallback(() => {
    const receipts = getOfflineReceipts();
    setOfflineReceipts(receipts);
    if (receipts.length === 0) {
      setIsDismissed(false);
    }
  }, []);

  useEffect(() => {
    const initial = setTimeout(checkQueue, 0);

    const handleOnline = () => {
      checkQueue();
    };

    const handleStorageChange = () => {
      checkQueue();
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("storage", handleStorageChange);
    // Poll queue occasionally in case receipts are saved within the same session
    const interval = setInterval(checkQueue, 3000);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("storage", handleStorageChange);
      clearTimeout(initial);
      clearInterval(interval);
    };
  }, [checkQueue]);

  const handleSync = async () => {
    if (offlineReceipts.length === 0) return;
    setIsSyncing(true);
    setSyncStatus(null);
    try {
      const res = await syncOfflineReceipts(offlineReceipts);
      clearOfflineReceipts();
      setOfflineReceipts([]);
      setSyncStatus(`Successfully synced ${res.synced} receipt(s)!`);
      setTimeout(() => {
        setSyncStatus(null);
      }, 4000);
    } catch {
      setSyncStatus("Sync failed. Check your network and try again.");
    } finally {
      setIsSyncing(false);
    }
  };

  if (syncStatus) {
    return (
      <div className="bg-emerald-600 text-white px-4 py-2 text-sm font-medium flex items-center justify-between shadow-md transition-all sticky top-0 z-50">
        <div className="flex items-center gap-2 max-w-7xl mx-auto w-full">
          <CheckCircle2 className="size-4 shrink-0" />
          <span>{syncStatus}</span>
        </div>
      </div>
    );
  }

  if (offlineReceipts.length === 0 || isDismissed) {
    return null;
  }

  const count = offlineReceipts.length;

  return (
    <div
      role="region"
      aria-label="Offline Receipts Sync Notification"
      className="bg-amber-500/95 dark:bg-amber-600/95 text-zinc-950 dark:text-white px-4 py-2.5 shadow-md sticky top-0 z-50 transition-all border-b border-amber-600/30 backdrop-blur-xs"
    >
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5 text-sm font-medium">
          <WifiOff className="size-4 text-amber-950 dark:text-amber-100 shrink-0" />
          <span>
            You have <strong className="underline">{count}</strong> unsynced offline receipt{count > 1 ? "s" : ""}. Sync when you are ready.
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleSync}
            disabled={isSyncing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 hover:opacity-90 transition-opacity disabled:opacity-50 cursor-pointer shadow-xs"
          >
            {isSyncing ? (
              <>
                <RefreshCw className="size-3.5 animate-spin" />
                <span>Syncing...</span>
              </>
            ) : (
              <>
                <CloudUpload className="size-3.5" />
                <span>Sync Now</span>
              </>
            )}
          </button>
          <button
            type="button"
            onClick={() => setIsDismissed(true)}
            aria-label="Dismiss banner"
            className="p-1 rounded-md hover:bg-black/10 dark:hover:bg-white/10 transition-colors text-zinc-800 dark:text-zinc-200 cursor-pointer"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
