import { cache } from "react";
import { addDays, eachDayOfInterval, format } from "date-fns";
import {
  currentManager,
  currentOutlet,
  mockCatalogue,
  mockHolidays,
  mockNotifications,
  mockOrders,
  mockOutletSettings,
  mockStoreStock,
  type CatalogueItem,
  type OutletSettings,
  type StoreManager,
  type StoreNotification,
  type StoreOutlet,
  type StoreOrder,
  type StoreStock,
  type TemperatureClass,
} from "@/components/store/mock-data";
import { ApiError, apiFetch } from "@/components/store/api/client";
import { STORE_DATA_SOURCE, STORE_OUTLET_ID } from "@/components/store/api/config";
import {
  toCatalogueItem,
  toOutletSettings,
  toStoreSession,
  toStoreStock,
  toStoreNotification,
  toStoreOrder,
  toTemperatureZone,
  type ApiCatalogueItem,
  type ApiNotification,
  type ApiOperatingDays,
  type ApiOutletSettings,
  type ApiStockImportResult,
  type ApiStoreMe,
  type ApiStoreOrder,
  type ApiStoreStock,
} from "@/components/store/api/mappers";

// One place for every Store Manager read and write. Screens call these and don't care whether the data
// is mock or live (see api/config.ts). Works from server components and from the browser.

const live = () => STORE_DATA_SOURCE === "api";

export interface StoreSession {
  manager: StoreManager;
  outlet: StoreOutlet;
}

async function fetchStoreSession(): Promise<StoreSession> {
  if (!live()) return { manager: currentManager, outlet: currentOutlet };
  try {
    // A signed-in store manager: the backend knows their outlet from the login token.
    return toStoreSession(await apiFetch<ApiStoreMe>("/store/me"));
  } catch (error) {
    // No store manager login (an admin, or local dev without Keycloak): the backend asks which outlet,
    // so open the one set in NEXT_PUBLIC_STORE_OUTLET_ID.
    if (error instanceof ApiError && error.status === 422) {
      return toStoreSession(await apiFetch<ApiStoreMe>(`/store/me?outlet_id=${STORE_OUTLET_ID}`));
    }
    throw error;
  }
}

// One lookup per server request (React cache), and one per page load in the browser.
const storeSessionForRequest = cache(fetchStoreSession);
let browserStoreSession: Promise<StoreSession> | null = null;

/**
 * Who is signed in and which outlet they run. Every Store Manager read and write is scoped to this outlet.
 * Throws ApiError 401/403 when the user isn't a store manager or isn't assigned to an outlet yet.
 */
export function getStoreSession(): Promise<StoreSession> {
  if (typeof window === "undefined") return storeSessionForRequest();
  browserStoreSession ??= fetchStoreSession().catch((error) => {
    browserStoreSession = null;
    throw error;
  });
  return browserStoreSession;
}

/** The signed-in manager's outlet. Its brand decides the catalogue and the ordering rules. */
export async function getCurrentOutlet(): Promise<StoreOutlet> {
  return (await getStoreSession()).outlet;
}

async function outletId(): Promise<number> {
  return (await getStoreSession()).outlet.id ?? STORE_OUTLET_ID;
}

/** Only the items the outlet's brand can order (fresh_items, style_items or tech_items). */
export async function getCatalogue(): Promise<CatalogueItem[]> {
  if (!live()) return mockCatalogue;
  const items = await apiFetch<ApiCatalogueItem[]>(`/catalogue/?outlet_id=${await outletId()}`);
  return items.map(toCatalogueItem);
}

/** The store's on-hand list from its last CSV import. */
export async function getStoreStock(): Promise<StoreStock> {
  if (!live()) return mockStoreStock;
  return toStoreStock(await apiFetch<ApiStoreStock>(`/outlets/${await outletId()}/stock`));
}

/** Replaces the store's on-hand list with the CSV (sku + quantity_on_hand). Rejected rows come back in `skipped`. */
export async function importStoreStock(file: File): Promise<ApiStockImportResult> {
  if (!live()) {
    throw new ApiError("Stock import needs the Waypoint server. Switch to live data to import.", 400);
  }
  const body = new FormData();
  body.append("file", file);
  return apiFetch<ApiStockImportResult>(`/outlets/${await outletId()}/stock/import`, { method: "POST", body });
}

// Live data never falls back to the demo data: an outlet with no orders shows none, and a server error
// surfaces (the store error page offers a retry) instead of showing another store's demo orders.
export async function getStoreOrders(): Promise<StoreOrder[]> {
  if (!live()) return mockOrders;
  const orders = await apiFetch<ApiStoreOrder[]>(`/orders/store?outlet_id=${await outletId()}&limit=200`);
  return orders.map(toStoreOrder);
}

/** null when the order doesn't exist. */
export async function getStoreOrder(orderNumber: string): Promise<StoreOrder | null> {
  if (!live()) {
    return mockOrders.find((order) => order.orderNumber.toLowerCase() === orderNumber.toLowerCase()) ?? null;
  }
  try {
    return toStoreOrder(await apiFetch<ApiStoreOrder>(`/orders/store/${encodeURIComponent(orderNumber)}`));
  } catch (error) {
    // Unknown, or another outlet's order: both read as "not found" to this store.
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) return null;
    throw error;
  }
}

export interface StoreReceipt {
  unitsReceived: number | null;
  hasIssues: boolean;
  issueType: string | null;
  issueDescription: string | null;
  confirmedAt: string | null;
}

/** The receipt the store confirmed for an order; null before it's received. */
export async function getOrderReceipt(orderId: number): Promise<StoreReceipt | null> {
  if (!live()) return null;
  try {
    const receipt = await apiFetch<{
      units_received: number | null;
      has_issues: boolean;
      issue_type: string | null;
      issue_description: string | null;
      confirmed_at: string | null;
    }>(`/receipts/${orderId}`);
    return {
      unitsReceived: receipt.units_received,
      hasIssues: receipt.has_issues,
      issueType: receipt.issue_type,
      issueDescription: receipt.issue_description,
      confirmedAt: receipt.confirmed_at,
    };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export interface GoodsRequestInput {
  deliveryDate: string;
  isHighPriority: boolean;
  notes: string;
  /** A narrower delivery window inside the outlet's hours ("HH:MM"). Leave out for the full window. */
  window?: { start: string; end: string };
  items: { sku: string; itemName: string; quantity: number; temperatureClass: TemperatureClass }[];
}

/** Returns the created order numbers (one per temperature zone). Mock mode just simulates the numbers. */
export async function placeGoodsRequest(input: GoodsRequestInput, mockNumbers: string[]): Promise<string[]> {
  if (!live()) {
    await new Promise((resolve) => setTimeout(resolve, 900));
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      throw new ApiError("The connection dropped while sending.", 0);
    }
    return mockNumbers;
  }
  const orders = await apiFetch<ApiStoreOrder[]>("/orders/store", {
    method: "POST",
    body: JSON.stringify({
      outlet_id: await outletId(),
      delivery_date: input.deliveryDate,
      is_priority: input.isHighPriority,
      notes: input.notes || null,
      window_start: input.window?.start ?? null,
      window_end: input.window?.end ?? null,
      items: input.items.map((item) => ({
        sku: item.sku,
        item_name: item.itemName,
        quantity: item.quantity,
        temperature_zone: toTemperatureZone(item.temperatureClass),
      })),
    }),
  });
  return orders.map((order) => order.order_number);
}

export async function cancelStoreOrder(orderId: number): Promise<void> {
  if (!live()) return;
  await apiFetch(`/orders/${orderId}/cancel`, { method: "POST" });
}

export async function getNotifications(): Promise<StoreNotification[]> {
  if (!live()) return mockNotifications;
  const notifications = await apiFetch<ApiNotification[]>(`/notifications/?outlet_id=${await outletId()}`);
  return notifications.map(toStoreNotification);
}

export async function markNotificationRead(id: string): Promise<void> {
  await apiFetch(`/notifications/${id}/read`, { method: "PATCH" });
}

export async function markAllNotificationsRead(): Promise<void> {
  await apiFetch(`/notifications/read-all?outlet_id=${await outletId()}`, { method: "POST" });
}

/**
 * Non-operating days (holidays) for the date picker. In API mode they come from the backend calendar:
 * any Mon–Sat missing from the operating days is treated as a holiday.
 */
export async function getHolidays(from: Date, days = 90): Promise<{ date: string; name: string }[]> {
  if (live()) {
    try {
      const to = addDays(from, days);
      const calendar = await apiFetch<ApiOperatingDays>(
        `/calendar/operating-days?date_from=${format(from, "yyyy-MM-dd")}&date_to=${format(to, "yyyy-MM-dd")}`
      );
      const operating = new Set(calendar.operating_days);
      return eachDayOfInterval({ start: from, end: to })
        .filter((day) => day.getDay() !== 0 && !operating.has(format(day, "yyyy-MM-dd")))
        .map((day) => ({ date: format(day, "yyyy-MM-dd"), name: "Holiday" }));
    } catch {
      // Without the calendar the picker only blocks Sundays; the server still rejects holidays on submit.
      return [];
    }
  }
  return mockHolidays;
}

export async function getOutletSettings(): Promise<OutletSettings> {
  if (!live()) return mockOutletSettings;
  return toOutletSettings(await apiFetch<ApiOutletSettings>(`/outlets/${await outletId()}/settings`));
}

export async function updateOutletSettings(payload: Partial<OutletSettings>): Promise<OutletSettings> {
  if (live()) {
    // A failed save throws, so the Settings page shows the error instead of pretending it saved.
    const res = await apiFetch<ApiOutletSettings>(`/outlets/${await outletId()}/settings`, {
      method: "PATCH",
      body: JSON.stringify({
        contact_phone: payload.contactPhone,
        emergency_contact: payload.emergencyContact,
        driver_check_in_call: payload.driverCheckInCall,
        share_dock_gate_code: payload.shareDockGateCode,
        email_alerts_issues: payload.emailAlertsIssues,
        sms_alerts_priority: payload.smsAlertsPriority,
      }),
    });
    return toOutletSettings(res);
  }
  return {
    ...mockOutletSettings,
    ...payload,
    lastSyncedAt: `today at ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
  };
}

export async function resetOutletSettings(): Promise<OutletSettings> {
  if (!live()) return mockOutletSettings;
  return toOutletSettings(
    await apiFetch<ApiOutletSettings>(`/outlets/${await outletId()}/settings/reset`, { method: "POST" })
  );
}

