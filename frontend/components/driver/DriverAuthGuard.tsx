"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Navigation } from "lucide-react";
import { getToken } from "@/lib/auth";
import { useAuth } from "@/lib/auth-context";
import { readCache } from "@/lib/driverCache";
import { checkSession, forgetScreens, SIGN_OUT_MESSAGES, signOut, type SignOutReason } from "@/lib/driverSession";

const LOGIN = "/login"; // the shared Waypoint (Keycloak) sign-in for every role
const PROFILE = "/driver/profile";
const RELOGIN_KEY = "driver-relogin-at"; // when the app last sent the driver to sign in again
const RELOGIN_WINDOW_MS = 2 * 60_000;

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange); // logged out in another tab
  return () => window.removeEventListener("storage", onChange);
}

/** First login not finished: phone and licence not saved yet (last server answer). */
function profileMissing() {
  return readCache<{ complete: boolean }>(PROFILE)?.complete === false;
}

/**
 * Driver pages open only with a saved login from the shared sign-in, so no
 * screen calls the server without one, and only after the first login's phone
 * and licence are saved. Once per visit the login is also checked with the
 * server (expired, account turned off, not a driver). With no signal the saved
 * login is trusted, so the app still opens offline.
 */
export function DriverAuthGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { logout } = useAuth();
  const loggedIn = useSyncExternalStore(subscribe, () => getToken() !== null, () => false);
  const setupNeeded = useSyncExternalStore(subscribe, profileMissing, () => false);
  // Signed in, but the server won't let this account work: say why here. The
  // sign-in page would bring the same Keycloak account straight back, round and round.
  const [refused, setRefused] = useState<SignOutReason | null>(null);
  const onProfile = pathname === PROFILE;

  useEffect(() => {
    // Read storage itself: on the first render after a page load `loggedIn` and
    // `setupNeeded` are still the server's answers (false).
    // In-app move: a page load here would cut off Log out's trip to Keycloak.
    if (getToken() === null) router.replace(LOGIN);
    else if (!onProfile && profileMissing()) router.replace(PROFILE);
  }, [onProfile, loggedIn, router]);

  useEffect(() => {
    if (!loggedIn) return;
    let cancelled = false;
    checkSession().then((reason) => {
      if (cancelled) return;
      const lastRelogin = Number(sessionStorage.getItem(RELOGIN_KEY) ?? 0);
      if (reason === "expired" && Date.now() - lastRelogin > RELOGIN_WINDOW_MS) {
        // Old login: sign in again once. A full page load, so the shared sign-in
        // doesn't still see the login just removed (the auth context holds it).
        sessionStorage.setItem(RELOGIN_KEY, String(Date.now()));
        signOut();
        window.location.replace(LOGIN);
      } else if (reason) {
        // Turned off, not a driver, or a fresh sign-in still refused.
        forgetScreens();
        setRefused(reason);
      } else {
        sessionStorage.removeItem(RELOGIN_KEY);
        if (window.location.pathname !== PROFILE && profileMissing()) router.replace(PROFILE);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [loggedIn, router]);

  if (refused) {
    return (
      <div className="min-h-screen bg-[#F6F7F9] text-slate-900 flex flex-col items-center justify-center p-4 font-sans antialiased">
        <div className="flex flex-col items-center gap-4 text-center max-w-sm">
          <div className="h-12 w-12 rounded-xl bg-[#092C4C] flex items-center justify-center text-white shadow-sm">
            <Navigation className="h-6 w-6 text-white" />
          </div>
          <p role="alert" className="text-sm font-medium text-slate-900">{SIGN_OUT_MESSAGES[refused]}</p>
          <button
            type="button"
            onClick={() => void logout(true)} // ends the Keycloak session, so another account can sign in
            className="h-11 px-5 rounded-lg bg-[#092C4C] text-white text-sm font-semibold"
          >
            {refused === "expired" ? "Sign in again" : "Sign in with another account"}
          </button>
        </div>
      </div>
    );
  }

  return loggedIn && (onProfile || !setupNeeded) ? <>{children}</> : null;
}
