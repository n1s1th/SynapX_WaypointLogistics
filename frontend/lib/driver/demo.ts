// Demo tools for rehearsing offline work on a real phone, where DevTools'
// "Offline" switch isn't available. Shown on the profile screen only when
// NEXT_PUBLIC_DRIVER_DEMO_TOOLS=1 (or in `next dev`).

const KEY = "driver_simulated_offline";
const EVENT = "driver-simulated-offline";

export const DEMO_TOOLS_ENABLED =
  process.env.NEXT_PUBLIC_DRIVER_DEMO_TOOLS === "1" || process.env.NODE_ENV !== "production";

export function isSimulatedOffline(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setSimulatedOffline(on: boolean): void {
  try {
    if (on) window.localStorage.setItem(KEY, "1");
    else window.localStorage.removeItem(KEY);
  } catch {
    // Storage blocked: the switch just doesn't stick.
  }
  window.dispatchEvent(new Event(EVENT));
  // Same signal the app gets when real coverage returns or drops.
  window.dispatchEvent(new Event(on ? "offline" : "online"));
}

export function subscribeSimulatedOffline(callback: () => void): () => void {
  window.addEventListener(EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}
