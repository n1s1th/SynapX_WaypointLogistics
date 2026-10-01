/**
 * Resilient API client for Waypoint Logistics
 * Automatically resolves between port 8000 (uvicorn default) and port 5000 (custom port)
 */

const CANDIDATE_API_URLS = [
  process.env.NEXT_PUBLIC_API_URL,
  "http://localhost:8000",
  "http://localhost:5000",
].filter(Boolean) as string[];

let cachedApiUrl: string | null = null;

export async function getActiveApiUrl(): Promise<string> {
  if (cachedApiUrl) return cachedApiUrl;

  for (const url of Array.from(new Set(CANDIDATE_API_URLS))) {
    try {
      const res = await fetch(`${url}/api/v1/health`, {
        signal: AbortSignal.timeout(1200),
        cache: "no-store",
      });
      if (res.ok) {
        cachedApiUrl = url;
        return url;
      }
    } catch {
      // Try next candidate
    }
  }

  // Fallback to configured or default
  return process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
}

export async function fetchWithFallback(
  endpoint: string,
  init?: RequestInit
): Promise<Response> {
  const urlsToTry = Array.from(
    new Set([
      cachedApiUrl,
      process.env.NEXT_PUBLIC_API_URL,
      "http://localhost:8000",
      "http://localhost:5000",
    ].filter(Boolean) as string[])
  );

  const cleanEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;

  let lastError: unknown = null;

  for (const baseUrl of urlsToTry) {
    try {
      const res = await fetch(`${baseUrl}${cleanEndpoint}`, init);
      // If we got any response (even 4xx/5xx), the server is alive on this port
      cachedApiUrl = baseUrl;
      return res;
    } catch (err) {
      lastError = err;
      // Network/connection error: continue to next port candidate
    }
  }

  throw lastError || new Error("Failed to connect to backend on either port 8000 or 5000");
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = "ApiError";
  }

  get isNetworkError() {
    return this.status === 0;
  }
}

function messageFrom(detail: unknown, fallback: string) {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    const first = detail[0] as { msg?: string } | undefined;
    return first?.msg ?? fallback;
  }
  if (detail && typeof detail === "object" && "message" in detail) {
    return String((detail as { message: unknown }).message);
  }
  return fallback;
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  const fullEndpoint = cleanPath.startsWith("/api/v1") ? cleanPath : `/api/v1${cleanPath}`;

  let response: Response;
  try {
    response = await fetchWithFallback(fullEndpoint, {
      ...init,
      headers: { ...init.headers },
      cache: "no-store",
    });
  } catch (err: any) {
    throw new ApiError(err?.message || "Couldn't reach the Waypoint server.", 0);
  }

  if (!response.ok) {
    let detail: unknown;
    try {
      detail = (await response.json()).detail;
    } catch {
      detail = undefined;
    }
    const code = detail && typeof detail === "object" && "code" in detail ? String((detail as { code: unknown }).code) : undefined;
    const details = detail && typeof detail === "object" && !Array.isArray(detail) ? (detail as Record<string, unknown>) : {};
    throw new ApiError(messageFrom(detail, `Request failed (${response.status})`), response.status, code, details);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
