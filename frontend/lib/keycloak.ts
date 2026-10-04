/**
 * Keycloak OIDC Configuration & Utilities for Waypoint Logistics
 * Supports Keycloak Realm: waypointlogistics
 * Roles: admin, dispatcher, driver, loader, store_manager
 */

export type KeycloakAppRole = "admin" | "dispatcher" | "driver" | "loader" | "store_manager";

export const APP_ROLES: KeycloakAppRole[] = [
  "admin",
  "dispatcher",
  "driver",
  "loader",
  "store_manager",
];

export interface RoleConfig {
  id: KeycloakAppRole;
  label: string;
  route: string;
  description: string;
  badgeStyle: string;
  iconName: string;
}

export const ROLE_CONFIGS: Record<KeycloakAppRole, RoleConfig> = {
  admin: {
    id: "admin",
    label: "System Admin",
    route: "/admin",
    description: "Keycloak IAM, RBAC permissions, audit logs, and fleet settings",
    badgeStyle: "bg-purple-100 text-purple-900 border-purple-300 font-semibold",
    iconName: "ShieldCheck",
  },
  dispatcher: {
    id: "dispatcher",
    label: "Dispatcher",
    route: "/dispatcher",
    description: "Fleet dispatch console, trip allocations, and route sequencing",
    badgeStyle: "bg-blue-100 text-blue-900 border-blue-300 font-semibold",
    iconName: "Truck",
  },
  driver: {
    id: "driver",
    label: "Delivery Driver",
    route: "/driver",
    description: "Turn-by-turn mobile trip execution, GPS navigation, and digital POD",
    badgeStyle: "bg-indigo-100 text-indigo-900 border-indigo-300 font-semibold",
    iconName: "Navigation",
  },
  loader: {
    id: "loader",
    label: "Dock Loader",
    route: "/loader",
    description: "Bay staging queue, barcode scanning, and load plan verification",
    badgeStyle: "bg-teal-100 text-teal-900 border-teal-300 font-semibold",
    iconName: "ScanBarcode",
  },
  store_manager: {
    id: "store_manager",
    label: "Store Manager",
    route: "/store",
    description: "Inbound delivery intake, replenishment orders, and proof of receipt",
    badgeStyle: "bg-emerald-100 text-emerald-900 border-emerald-300 font-semibold",
    iconName: "Building2",
  },
};

export interface KeycloakTokenPayload {
  exp?: number;
  iat?: number;
  auth_time?: number;
  jti?: string;
  iss?: string;
  aud?: string | string[];
  sub?: string;
  typ?: string;
  azp?: string;
  preferred_username?: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  email?: string;
  email_verified?: boolean;
  realm_access?: {
    roles?: string[];
  };
  resource_access?: Record<string, { roles?: string[] }>;
  outlet_id?: number | string;
}

export interface AuthUser {
  id: string;
  username: string;
  name: string;
  email: string;
  roles: KeycloakAppRole[];
  primaryRole: KeycloakAppRole | null;
  outletId?: number;
}

export function getKeycloakConfig() {
  const url = (process.env.NEXT_PUBLIC_KEYCLOAK_URL || "https://auth.tenderease.me").replace(/\/$/, "");
  const realm = process.env.NEXT_PUBLIC_KEYCLOAK_REALM || "waypointlogistics";
  const clientId = process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID || "waypoint-frontend";

  return {
    url,
    realm,
    clientId,
    issuer: `${url}/realms/${realm}`,
    authEndpoint: `${url}/realms/${realm}/protocol/openid-connect/auth`,
    tokenEndpoint: `${url}/realms/${realm}/protocol/openid-connect/token`,
    logoutEndpoint: `${url}/realms/${realm}/protocol/openid-connect/logout`,
    userInfoEndpoint: `${url}/realms/${realm}/protocol/openid-connect/userinfo`,
  };
}

/**
 * Safely parse a JWT without external libraries
 */
export function decodeJwt<T = Record<string, unknown>>(token: string): T | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const base64Url = parts[1];
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    );
    return JSON.parse(jsonPayload) as T;
  } catch {
    return null;
  }
}

/**
 * Extract active Keycloak application roles from a token payload
 */
export function extractRoles(payload: KeycloakTokenPayload | null): KeycloakAppRole[] {
  if (!payload) return [];

  const foundRoles = new Set<KeycloakAppRole>();

  // 1. Check realm_access.roles
  const realmRoles = payload.realm_access?.roles || [];
  for (const role of realmRoles) {
    const normalized = role.toLowerCase() as KeycloakAppRole;
    if (APP_ROLES.includes(normalized)) {
      foundRoles.add(normalized);
    }
  }

  // 2. Check resource_access (client-level roles)
  const config = getKeycloakConfig();
  const clientRoles = payload.resource_access?.[config.clientId]?.roles || [];
  for (const role of clientRoles) {
    const normalized = role.toLowerCase() as KeycloakAppRole;
    if (APP_ROLES.includes(normalized)) {
      foundRoles.add(normalized);
    }
  }

  return Array.from(foundRoles);
}

/**
 * Determine default destination portal based on role hierarchy
 */
export function getDefaultPortalForRoles(roles: KeycloakAppRole[]): string {
  if (roles.includes("admin")) return "/admin";
  if (roles.includes("dispatcher")) return "/dispatcher";
  if (roles.includes("store_manager")) return "/store";
  if (roles.includes("loader")) return "/loader";
  if (roles.includes("driver")) return "/driver";
  return "/";
}

/**
 * Build Keycloak Authorization URL for PKCE / Auth Code Flow
 */
export async function buildAuthorizeUrl(redirectUri: string, targetRole?: string): Promise<{ url: string; state: string; verifier: string }> {
  const config = getKeycloakConfig();
  const state = Math.random().toString(36).substring(2) + Date.now().toString(36);
  
  // Create PKCE Code Verifier
  const array = new Uint8Array(32);
  if (typeof window !== "undefined" && window.crypto) {
    window.crypto.getRandomValues(array);
  } else {
    for (let i = 0; i < 32; i++) array[i] = Math.floor(Math.random() * 256);
  }
  const verifier = Array.from(array, (dec) => ("0" + dec.toString(16)).slice(-2)).join("");

  // Calculate Code Challenge
  let codeChallenge = verifier;
  if (typeof window !== "undefined" && window.crypto?.subtle) {
    const encoder = new TextEncoder();
    const data = encoder.encode(verifier);
    const hash = await window.crypto.subtle.digest("SHA-256", data);
    codeChallenge = btoa(String.fromCharCode(...new Uint8Array(hash)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  }

  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: "code",
    scope: "openid profile email",
    redirect_uri: redirectUri,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  if (targetRole) {
    params.set("role_hint", targetRole);
  }

  return {
    url: `${config.authEndpoint}?${params.toString()}`,
    state,
    verifier,
  };
}

/**
 * Build Keycloak End Session (Logout) URL
 */
export function buildLogoutUrl(redirectUri: string, idToken?: string): string {
  const config = getKeycloakConfig();
  const params = new URLSearchParams({
    client_id: config.clientId,
    post_logout_redirect_uri: redirectUri,
  });
  if (idToken) {
    params.set("id_token_hint", idToken);
  }
  return `${config.logoutEndpoint}?${params.toString()}`;
}
