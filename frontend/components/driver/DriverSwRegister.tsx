"use client";

import * as React from "react";

const ENABLED =
  process.env.NODE_ENV === "production" || process.env.NEXT_PUBLIC_DRIVER_SW === "1";

/**
 * Registers the driver service worker (app shell offline). Off in `next dev`
 * (it would cache hot-reload chunks) unless NEXT_PUBLIC_DRIVER_SW=1.
 * Same pattern as components/loader/loader-sw-register.tsx.
 */
export function DriverSwRegister() {
  React.useEffect(() => {
    if (!ENABLED || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/driver-sw.js", { scope: "/driver" }).catch((err) => {
      console.warn("Driver service worker registration failed", err);
    });
  }, []);
  return null;
}
