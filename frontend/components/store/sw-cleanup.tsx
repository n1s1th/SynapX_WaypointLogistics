"use client";

import { useEffect } from "react";

/**
 * Automatically unregisters rogue/stale root service workers (like `sw.js`) that intercept
 * cross-origin API fetch calls and trigger synthetic CORS / network errors.
 */
export function ServiceWorkerCleanup() {
  useEffect(() => {
    if (typeof window !== "undefined" && "serviceWorker" in navigator) {
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        for (const reg of registrations) {
          // Keep loader-scoped service workers intact if needed, unregister root / other workers
          if (reg.active?.scriptURL.endsWith("/sw.js") || (!reg.scope.includes("/loader") && reg.scope.endsWith("/"))) {
            reg.unregister().then((success) => {
              if (success) {
                console.info("[ServiceWorkerCleanup] Unregistered stale service worker:", reg.active?.scriptURL || reg.scope);
              }
            });
          }
        }
      });
    }
  }, []);

  return null;
}
