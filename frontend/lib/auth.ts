import {
  AuthUser,
  decodeJwt,
  extractRoles,
  KeycloakAppRole,
  KeycloakTokenPayload,
} from "./keycloak";

// Local storage keys
export const ACCESS_TOKEN_KEY = "waypoint_access_token";
export const REFRESH_TOKEN_KEY = "waypoint_refresh_token";
export const ID_TOKEN_KEY = "waypoint_id_token";
export const USER_INFO_KEY = "waypoint_user_info";
export const PKCE_VERIFIER_KEY = "waypoint_pkce_verifier";
export const PKCE_STATE_KEY = "waypoint_pkce_state";
export const TARGET_ROLE_KEY = "waypoint_target_role";

// Legacy key for driver compatibility
const LEGACY_DRIVER_KEY = "driver_token";

// The access token is also kept in a cookie so server-rendered pages (the Store Manager screens) can
// send it to the API. Same name as the localStorage key.
export const ACCESS_TOKEN_COOKIE = ACCESS_TOKEN_KEY;

export function setAuthCookie(accessToken: string): void {
  if (typeof document === "undefined") return;
  const exp = decodeJwt<KeycloakTokenPayload>(accessToken)?.exp;
  const maxAge = exp ? Math.max(0, exp - Math.floor(Date.now() / 1000)) : 3600;
  document.cookie = `${ACCESS_TOKEN_COOKIE}=${accessToken}; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
}

function clearAuthCookie(): void {
  if (typeof document === "undefined") return;
  document.cookie = `${ACCESS_TOKEN_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
}

export function getAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(ACCESS_TOKEN_KEY) || localStorage.getItem(LEGACY_DRIVER_KEY);
}

export function getRefreshToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function getIdToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(ID_TOKEN_KEY);
}

export function getStoredUser(): AuthUser | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(USER_INFO_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

/**
 * Parses user and roles from a JWT token
 */
export function parseUserFromToken(accessToken: string, idToken?: string): AuthUser {
  const accessPayload = decodeJwt<KeycloakTokenPayload>(accessToken);
  const idPayload = idToken ? decodeJwt<KeycloakTokenPayload>(idToken) : null;
  const payload = { ...accessPayload, ...idPayload };

  const roles = extractRoles(accessPayload);
  const primaryRole = roles[0] || null;

  return {
    id: payload.sub || "user-unknown",
    username: payload.preferred_username || payload.email || "user",
    name: payload.name || payload.preferred_username || "Waypoint Operator",
    email: payload.email || "",
    roles,
    primaryRole,
    outletId: payload.outlet_id ? Number(payload.outlet_id) : undefined,
  };
}

export function saveAuthSession(tokens: {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
}): AuthUser {
  if (typeof window === "undefined") {
    return parseUserFromToken(tokens.access_token, tokens.id_token);
  }

  localStorage.setItem(ACCESS_TOKEN_KEY, tokens.access_token);
  localStorage.setItem(LEGACY_DRIVER_KEY, tokens.access_token);
  setAuthCookie(tokens.access_token);

  if (tokens.refresh_token) {
    localStorage.setItem(REFRESH_TOKEN_KEY, tokens.refresh_token);
  }
  if (tokens.id_token) {
    localStorage.setItem(ID_TOKEN_KEY, tokens.id_token);
  }

  const user = parseUserFromToken(tokens.access_token, tokens.id_token);
  localStorage.setItem(USER_INFO_KEY, JSON.stringify(user));
  return user;
}

export function clearAuthSession(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  localStorage.removeItem(ID_TOKEN_KEY);
  localStorage.removeItem(USER_INFO_KEY);
  localStorage.removeItem(LEGACY_DRIVER_KEY);
  clearAuthCookie();
  sessionStorage.removeItem(PKCE_VERIFIER_KEY);
  sessionStorage.removeItem(PKCE_STATE_KEY);
  sessionStorage.removeItem(TARGET_ROLE_KEY);
}

export function isAuthenticated(): boolean {
  return !!getAccessToken();
}

export function hasRole(role: KeycloakAppRole): boolean {
  const user = getStoredUser();
  if (!user) return false;
  return user.roles.includes(role);
}

// Backwards-compatible aliases for legacy imports
export const getToken = getAccessToken;
export const setToken = (token: string) => {
  saveAuthSession({ access_token: token });
};
export const clearToken = clearAuthSession;
