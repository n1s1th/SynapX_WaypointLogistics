"use client";

import { useEffect, useState } from "react";
import { fetchOrders, type OrderRecord } from "./data";

export function useOrders() {
  const [data, setData] = useState<OrderRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updated, setUpdated] = useState<string | null>(null);
  const [request, setRequest] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]);
    fetchOrders(signal).then((orders) => {
      if (!controller.signal.aborted) { setData(orders); setUpdated(new Date().toISOString()); }
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Orders could not be loaded.");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [request]);
  function refresh() { setLoading(true); setError(null); setRequest((n) => n + 1); }
  return { data, loading, error, updated, refresh };
}
