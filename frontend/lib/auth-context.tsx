"use client";

import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  AuthUser,
  buildAuthorizeUrl,
  buildLogoutUrl,
  decodeJwt,
  KeycloakAppRole,
  KeycloakTokenPayload,
  ROLE_CONFIGS,
} from "./keycloak";
import {
  clearAuthSession,
  getAccessToken,
  getIdToken,
  getRefreshToken,
  getStoredUser,
  setAuthCookie,
  PKCE_STATE_KEY,
  PKCE_VERIFIER_KEY,
  saveAuthSession,
  TARGET_ROLE_KEY,
} from "./auth";

interface AuthContextType {
  user: AuthUser | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  loginWithKeycloak: (targetRole?: KeycloakAppRole) => Promise<void>;
  logout: (ssoLogout?: boolean) => Promise<void>;
  hasRole: (role: KeycloakAppRole) => boolean;
  switchRole: (role: KeycloakAppRole) => void;
  refreshSession: () => Promise<boolean>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setTokenState] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Initialize session on mount
  useEffect(() => {
    try {
      const storedToken = getAccessToken();
      const storedUser = getStoredUser();

      if (storedToken && storedUser) {
        const payload = decodeJwt<KeycloakTokenPayload>(storedToken);
        const nowSec = Math.floor(Date.now() / 1000);

        if (payload?.exp && payload.exp < nowSec) {
          void refreshSession();
        } else {
          // Sessions started before the cookie existed get it now.
          setAuthCookie(storedToken);
          setTokenState(storedToken);
          setUser(storedUser);
        }
      }
    } catch {
      clearAuthSession();
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Refreshes access token using refresh_token against Keycloak
   */
  const refreshSession = useCallback(async (): Promise<boolean> => {
    const refreshToken = getRefreshToken();
    if (!refreshToken) {
      clearAuthSession();
      setUser(null);
      setTokenState(null);
      return false;
    }

    try {
      const res = await fetch("/api/auth/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          refresh_token: refreshToken,
          grant_type: "refresh_token",
        }),
      });

      if (!res.ok) {
        clearAuthSession();
        setUser(null);
        setTokenState(null);
        return false;
      }

      const data = await res.json();
      const updatedUser = saveAuthSession({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        id_token: data.id_token,
      });

      setTokenState(data.access_token);
      setUser(updatedUser);
      return true;
    } catch {
      clearAuthSession();
      setUser(null);
      setTokenState(null);
      return false;
    }
  }, []);

  // Initialize session after hydration, with the refresh callback defined.
  useEffect(() => {
    const initial = setTimeout(() => {
      try {
        const storedToken = getAccessToken();
        const storedUser = getStoredUser();
        if (storedToken && storedUser) {
          const payload = decodeJwt<KeycloakTokenPayload>(storedToken);
          if (payload?.exp && payload.exp < Math.floor(Date.now() / 1000)) {
            void refreshSession();
          } else {
            setTokenState(storedToken);
            setUser(storedUser);
          }
        }
      } catch {
        clearAuthSession();
      } finally {
        setIsLoading(false);
      }
    }, 0);
    return () => clearTimeout(initial);
  }, [refreshSession]);

  /**
   * Initiates OIDC PKCE redirect to Keycloak login screen
   */
  const loginWithKeycloak = useCallback(async (targetRole?: KeycloakAppRole) => {
    if (typeof window === "undefined") return;

    const redirectUri = `${window.location.origin}/auth/callback`;
    const { url, state, verifier } = await buildAuthorizeUrl(redirectUri, targetRole);

    sessionStorage.setItem(PKCE_STATE_KEY, state);
    sessionStorage.setItem(PKCE_VERIFIER_KEY, verifier);
    if (targetRole) {
      sessionStorage.setItem(TARGET_ROLE_KEY, targetRole);
    }

    window.location.href = url;
  }, []);

  /**
   * Signs out the user locally and triggers Keycloak SSO logout
   */
  const logout = useCallback(async (ssoLogout = true) => {
    const idToken = getIdToken() || undefined;
    clearAuthSession();
    setUser(null);
    setTokenState(null);

    if (ssoLogout && typeof window !== "undefined") {
      const redirectUri = window.location.origin;
      window.location.href = buildLogoutUrl(redirectUri, idToken);
    } else {
      router.push("/");
    }
  }, [router]);

  /**
   * Check if current user possesses given Keycloak role
   */
  const hasRole = useCallback((role: KeycloakAppRole): boolean => {
    if (!user) return false;
    return user.roles.includes(role);
  }, [user]);

  /**
   * Switch the active workspace / portal view for users with multiple roles
   */
  const switchRole = useCallback((role: KeycloakAppRole) => {
    if (!user) return;
    setUser({ ...user, primaryRole: role });
    const targetRoute = ROLE_CONFIGS[role]?.route || "/";
    router.push(targetRoute);
  }, [user, router]);

  const value = {
    user,
    token,
    isAuthenticated: !!user && !!token,
    isLoading,
    loginWithKeycloak,
    logout,
    hasRole,
    switchRole,
    refreshSession,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
