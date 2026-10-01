// Mock data for the Store Manager portal until the backend (orders, notifications)
// and Keycloak login are wired up. Shapes follow docs/store-manager-contract.md.

export type Brand = "fresh" | "style" | "tech";

export interface StoreOutlet {
  code: string;
  name: string;
  brand: Brand;
  district: string;
  windowStart: string;
  windowEnd: string;
}

export interface StoreManager {
  fullName: string;
  firstName: string;
  initials: string;
}

export const currentOutlet: StoreOutlet = {
  code: "OUT005",
  name: "Fresh Colombo",
  brand: "fresh",
  district: "Colombo",
  windowStart: "04:00",
  windowEnd: "07:45",
};

export const currentManager: StoreManager = {
  fullName: "Sarah Jenkins",
  firstName: "Sarah",
  initials: "SJ",
};

export interface OutletSettings {
  outletId: number;
  outletCode: string;
  outletName: string;
  brand: string;
  district: string;
  servingDepot: string;
  storeManager: string;
  contactPhone: string;
  emergencyContact: string;
  windowStart: string;
  windowEnd: string;
  dockType: string;
  vehicleAccess: string;
  parking: string;
  driverCheckInCall: boolean;
  shareDockGateCode: boolean;
  emailAlertsIssues: boolean;
  smsAlertsPriority: boolean;
  isVerified: boolean;
  lastSyncedAt?: string;
}

export const mockOutletSettings: OutletSettings = {
  outletId: 5,
  outletCode: "OUT005",
  outletName: "Fresh Colombo",
  brand: "Fresh",
  district: "Colombo",
  servingDepot: "Peliyagoda",
  storeManager: "Sarah Jenkins · MGR-88",
  contactPhone: "+94 11 234 5678",
  emergencyContact: "Kamal S. (Backroom Lead) · ext 8802",
  windowStart: "04:00",
  windowEnd: "07:45",
  dockType: "Rear dock",
  vehicleAccess: "Trucks and vans",
  parking: "No restrictions",
  driverCheckInCall: true,
  shareDockGateCode: true,
  emailAlertsIssues: true,
  smsAlertsPriority: false,
  isVerified: true,
  lastSyncedAt: "today at 14:31",
};

// The mock data is written around this moment (the day shown in the Figma screens).
// Replace with the real current time once orders come from the API.
export const MOCK_NOW = new Date("2026-09-26T06:00:00");

// ── Orders (docs/store-manager-contract.md §1–2) ──────────────────────────────

export type OrderStatus =
  | "draft"
  | "submitted"
  | "confirmed"
  | "allocated"
  | "processing"
  | "ready_for_dispatch"
  | "dispatched"
  | "delivered"
  | "completed"
  | "deferred"
  | "cancelled";

export type TemperatureClass = "chilled" | "ambient";

// Delivery problems reported by the Dispatcher team that override the normal status pill.
export type DeliveryAlert = "vehicle_unavailable";

export interface DispatcherNote {
  reason: string;
  message: string;
  author: string;
  authorRole: string;
  location: string;
  at: string;
}

export interface StoreOrderItem {
  sku: string;
  itemName: string;
  category: string;
  temperatureClass: TemperatureClass;
  /** Requested quantity. */
  quantity: number;
  unitLabel: string;
  /** What the depot loaded (order_items.quantity_sent, written by Dev B). Undefined until picked. */
  quantitySent?: number;
  /** order_items.dispatcher_note (Figma 04b). */
  dispatcherNote?: DispatcherNote;
}

export interface OrderVehicle {
  code: string;
  description: string;
  driverName: string;
  driverCode: string;
  origin: string;
  manifestNumber: string;
}

/** When each progress step was reached (Figma 04 Request Progress). */
export type OrderStatusTimes = Partial<
  Record<"submitted" | "processing" | "ready_for_dispatch" | "dispatched" | "delivered" | "completed", string>
>;

export interface StoreOrder {
  id: number;
  orderNumber: string;
  status: OrderStatus;
  isHighPriority: boolean;
  temperatureClass: TemperatureClass;
  /** Requested delivery date (YYYY-MM-DD). */
  orderDate: string;
  submittedAt: string;
  items: StoreOrderItem[];
  eta?: string;
  arrivedAt?: string;
  vehicleCode?: string;
  deliveryAlert?: DeliveryAlert;
  vehicle?: OrderVehicle;
  statusTimes?: OrderStatusTimes;
  /** Manager note shared with the depot and driver. */
  notes?: string;
  activity?: { at: string; text: string }[];
  deferralReason?: string;
}

const item = (
  sku: string,
  itemName: string,
  category: string,
  temperatureClass: TemperatureClass,
  quantity: number,
): StoreOrderItem => ({ sku, itemName, category, temperatureClass, quantity, unitLabel: "Cases" });

export const mockOrders: StoreOrder[] = [
  {
    id: 1,
    orderNumber: "ORD0000001",
    status: "dispatched",
    isHighPriority: true,
    temperatureClass: "chilled",
    orderDate: "2026-09-26",
    submittedAt: "2026-09-24T09:15:00",
    eta: "2026-09-26T06:10:00",
    vehicleCode: "VEH001",
    vehicle: {
      code: "VEH001",
      description: "Truck · Reefer",
      driverName: "Marcus Vance",
      driverCode: "DRV-309",
      origin: "Peliyagoda Depot",
      manifestNumber: "009384",
    },
    statusTimes: {
      submitted: "2026-09-24T09:15:00",
      processing: "2026-09-24T14:30:00",
      ready_for_dispatch: "2026-09-25T16:00:00",
      dispatched: "2026-09-26T05:15:00",
    },
    notes:
      "Urgent stock for the weekend promotion. Driver instructed to use the rear dock. Staff ready with an electric pallet jack.",
    activity: [
      { at: "2026-09-24T09:15:00", text: "Request submitted by Sarah Jenkins" },
      { at: "2026-09-24T14:30:00", text: "Dispatcher sent 3 items · Soft Drinks short by 2 cases" },
      { at: "2026-09-25T16:00:00", text: "Staged at Depot Bay 4" },
      { at: "2026-09-26T05:15:00", text: "Dispatched from Peliyagoda Depot on VEH001" },
    ],
    items: [
      {
        ...item("SKU-014", "Soft Drinks 1L (12pk)", "Beverages · Carbonated", "chilled", 10),
        quantitySent: 8,
        dispatcherNote: {
          reason: "Depot stock shortage",
          message:
            "Only 8 of the 10 cases of SKU-014 were in stock at Peliyagoda Depot when ORD0000001 was picked. The remaining 2 cases are back-ordered and will come with your next delivery on Mon 28 Sep (04:00 – 07:45).",
          author: "Nimal Perera",
          authorRole: "Dispatcher",
          location: "Peliyagoda Depot",
          at: "2026-09-25T16:05:00",
        },
      },
      { ...item("SKU-063", "Greek Yogurt 500g", "Dairy", "chilled", 15), quantitySent: 15 },
      { ...item("SKU-022", "Oat Milk 1L (6pk)", "Beverages · Dairy-free", "chilled", 10), quantitySent: 10 },
    ],
  },
  {
    id: 2,
    orderNumber: "ORD0000002",
    status: "ready_for_dispatch",
    isHighPriority: false,
    temperatureClass: "ambient",
    orderDate: "2026-09-28",
    submittedAt: "2026-09-25T11:30:00",
    deliveryAlert: "vehicle_unavailable",
    statusTimes: {
      submitted: "2026-09-25T11:30:00",
      processing: "2026-09-26T02:10:00",
      ready_for_dispatch: "2026-09-26T04:40:00",
    },
    items: [
      { ...item("SKU-001", "Bottled Water 500ml", "Beverages · Packaged liquids", "ambient", 6), quantitySent: 6 },
      { ...item("SKU-048", "Espresso Roast Beans 1kg", "Beverages · Coffee", "ambient", 4), quantitySent: 4 },
      { ...item("SKU-032", "Paper Cups 8oz (500ct)", "Consumables · Disposables", "ambient", 5), quantitySent: 5 },
      { ...item("SKU-035", "Paper Napkins (1000ct)", "Consumables · Disposables", "ambient", 3), quantitySent: 3 },
    ],
  },
  {
    id: 3,
    orderNumber: "ORD0000003",
    status: "processing",
    isHighPriority: false,
    temperatureClass: "ambient",
    orderDate: "2026-09-29",
    submittedAt: "2026-09-25T14:20:00",
    items: Array.from({ length: 12 }, (_, i) =>
      item(`SKU-1${String(i).padStart(2, "0")}`, `Dry goods line ${i + 1}`, "Grocery", "ambient", 5),
    ),
  },
  {
    id: 4,
    orderNumber: "ORD0000004",
    status: "delivered",
    isHighPriority: true,
    temperatureClass: "chilled",
    orderDate: "2026-09-26",
    submittedAt: "2026-09-25T10:45:00",
    arrivedAt: "2026-09-26T04:35:00",
    vehicleCode: "VEH035",
    vehicle: {
      code: "VEH035",
      description: "Truck · Reefer",
      driverName: "Carlos Mendes",
      driverCode: "DRV-221",
      origin: "Peliyagoda Depot",
      manifestNumber: "009377",
    },
    statusTimes: {
      submitted: "2026-09-25T10:45:00",
      processing: "2026-09-25T15:10:00",
      ready_for_dispatch: "2026-09-25T20:30:00",
      dispatched: "2026-09-26T03:40:00",
      delivered: "2026-09-26T04:35:00",
    },
    items: [
      { ...item("SKU-063", "Greek Yogurt 500g", "Dairy", "chilled", 5), quantitySent: 5 },
      { ...item("SKU-070", "Cheddar Block 250g", "Dairy", "chilled", 5), quantitySent: 5 },
      { ...item("SKU-014", "Soft Drinks 1L (12pk)", "Beverages · Carbonated", "chilled", 5), quantitySent: 5 },
    ],
  },
  {
    id: 5,
    orderNumber: "ORD0000005",
    status: "completed",
    isHighPriority: false,
    temperatureClass: "ambient",
    orderDate: "2026-09-23",
    submittedAt: "2026-09-21T14:00:00",
    items: Array.from({ length: 6 }, (_, i) =>
      item(`SKU-2${String(i).padStart(2, "0")}`, `Ambient line ${i + 1}`, "Grocery", "ambient", 4),
    ),
  },
];

// Older requests so the Goods Requests list has history to page through
// (Figma: 22 requests, 18 completed in the last 30 days, 1 cancelled).
const historyOrders: StoreOrder[] = Array.from({ length: 17 }, (_, i) => {
  const id = i + 6;
  const day = 20 - i; // 20 Sep back to 4 Sep
  const orderDate = `2026-09-${String(day + 2).padStart(2, "0")}`;
  const temperatureClass: TemperatureClass = i % 3 === 0 ? "chilled" : "ambient";
  return {
    id,
    orderNumber: `ORD${String(id).padStart(7, "0")}`,
    status: id === 20 ? "cancelled" : "completed",
    isHighPriority: i % 5 === 0,
    temperatureClass,
    orderDate,
    submittedAt: `2026-09-${String(day).padStart(2, "0")}T${String(9 + (i % 7)).padStart(2, "0")}:00:00`,
    items: Array.from({ length: 2 + (i % 5) }, (_, j) =>
      item(`SKU-3${String(j).padStart(2, "0")}`, `Restock line ${j + 1}`, "Grocery", temperatureClass, 3 + j),
    ),
  };
});

mockOrders.push(...historyOrders);

// ── Shortfalls (Figma 02b) — items the depot couldn't send in full or that arrived short ──

export type ShortfallStatus = "back_ordered" | "out_of_stock" | "under_review" | "resolved";

export interface StoreShortfall {
  orderNumber: string;
  sku: string;
  itemName: string;
  requested: number;
  sent: number;
  status: ShortfallStatus;
}

export const mockShortfalls: StoreShortfall[] = [
  { orderNumber: "ORD0000001", sku: "SKU-014", itemName: "Soft Drinks 1L (12pk)", requested: 10, sent: 8, status: "back_ordered" },
  { orderNumber: "ORD0000003", sku: "SKU-022", itemName: "Oat Milk 1L (6pk)", requested: 6, sent: 0, status: "out_of_stock" },
  { orderNumber: "ORD0000006", sku: "SKU-014", itemName: "Soft Drinks 1L (12pk)", requested: 10, sent: 8, status: "under_review" },
];

// ── Delivery issues (owned by Dev B; read-only here for the dashboard) ────────

export interface StoreIssue {
  code: string;
  orderNumber: string;
  summary: string;
  isOpen: boolean;
}

export const mockIssues: StoreIssue[] = [
  {
    code: "ISS0000001",
    orderNumber: "ORD0000001",
    summary: "Damaged goods reported (2 boxes of paper cups). Depot review in progress.",
    isOpen: true,
  },
];

export const brandLabels: Record<Brand, string> = {
  fresh: "Fresh",
  style: "Style",
  tech: "Tech",
};

// ── Depot catalogue (Figma 03b Add Item) — inventory_items + the catalogue columns in contract §2 ──

export type StockLevel = "in_stock" | "low" | "out";

export interface CatalogueItem {
  sku: string;
  itemName: string;
  category: string;
  temperatureClass: TemperatureClass;
  unitLabel: string;
  stock: StockLevel;
  /** Units left when stock is low. */
  stockLeft?: number;
  /** YYYY-MM-DD, when an out-of-stock item is expected back. */
  restockEta?: string;
}

export const mockCatalogue: CatalogueItem[] = [
  { sku: "SKU-014", itemName: "Soft Drinks 1L (12pk)", category: "Beverages · Carbonated", temperatureClass: "chilled", unitLabel: "Cases", stock: "low", stockLeft: 8 },
  { sku: "SKU-063", itemName: "Greek Yogurt 500g", category: "Dairy", temperatureClass: "chilled", unitLabel: "Cases", stock: "in_stock" },
  { sku: "SKU-022", itemName: "Oat Milk 1L (6pk)", category: "Beverages · Dairy-free", temperatureClass: "chilled", unitLabel: "Cases", stock: "out", restockEta: "2026-09-30" },
  { sku: "SKU-070", itemName: "Cheddar Block 250g", category: "Dairy", temperatureClass: "chilled", unitLabel: "Cases", stock: "in_stock" },
  { sku: "SKU-081", itemName: "Fresh Chicken Breast 1kg", category: "Meat · Poultry", temperatureClass: "chilled", unitLabel: "Crates", stock: "in_stock" },
  { sku: "SKU-001", itemName: "Bottled Water 500ml", category: "Beverages · Packaged liquids", temperatureClass: "ambient", unitLabel: "Cases", stock: "in_stock" },
  { sku: "SKU-048", itemName: "Espresso Roast Beans 1kg", category: "Beverages · Coffee", temperatureClass: "ambient", unitLabel: "Bags", stock: "in_stock" },
  { sku: "SKU-032", itemName: "Paper Cups 8oz (500ct)", category: "Consumables · Disposables", temperatureClass: "ambient", unitLabel: "Boxes", stock: "in_stock" },
  { sku: "SKU-035", itemName: "Paper Napkins (1000ct)", category: "Consumables · Disposables", temperatureClass: "ambient", unitLabel: "Boxes", stock: "low", stockLeft: 12 },
  { sku: "SKU-090", itemName: "Basmati Rice 5kg", category: "Grocery · Staples", temperatureClass: "ambient", unitLabel: "Bags", stock: "in_stock" },
];

export const CATALOGUE_DEPOT = "Peliyagoda Depot";
export const CATALOGUE_UPDATED_AT = "05:00";

// ── Operating calendar (calendar_days) — Sundays and these dates have no deliveries ──

export const mockHolidays: { date: string; name: string }[] = [
  { date: "2026-10-01", name: "Poya Day" },
  { date: "2026-10-26", name: "Poya Day" },
];

export const OUTLET_UNLOADING = "Rear dock";

// ── Notifications (contract §2 notifications table, §4 types) ──────────────────

export type NotificationType =
  | "order_submitted"
  | "order_confirmed"
  | "dispatcher_note"
  | "shortfall_warning"
  | "deferred"
  | "ready_for_dispatch"
  | "eta_updated"
  | "delivered"
  | "issue_logged"
  | "order_closed";

export type NotificationCategory = "request" | "delivery" | "issue";

export interface StoreNotification {
  id: string;
  type: NotificationType;
  category: NotificationCategory;
  title: string;
  message: string;
  createdAt: string;
  isRead: boolean;
  orderNumber?: string;
  links: { label: string; href: string }[];
}

export const mockNotifications: StoreNotification[] = [
  {
    id: "ntf-7",
    type: "issue_logged",
    category: "issue",
    title: "Delivery issue logged: ISS0000001",
    message:
      "Damaged goods reported for 2 boxes of Paper Cups (SKU-032) on ORD0000001. Sent to the Peliyagoda depot supervisor.",
    createdAt: "2026-09-26T05:59:00",
    isRead: false,
    orderNumber: "ORD0000001",
    links: [
      { label: "View Issue", href: "/store/issues/ISS0000001" },
      { label: "View Order", href: "/store/requests/ORD0000001" },
    ],
  },
  {
    id: "ntf-6",
    type: "eta_updated",
    category: "delivery",
    title: "ORD0000001 is approaching — ETA 06:10",
    message: "VEH001 (Marcus Vance) left Peliyagoda Depot at 05:15 with 3 items (33 units).",
    createdAt: "2026-09-26T05:45:00",
    isRead: false,
    orderNumber: "ORD0000001",
    links: [{ label: "Open Delivery", href: "/store/deliveries/ORD0000001" }],
  },
  {
    id: "ntf-5",
    type: "dispatcher_note",
    category: "request",
    title: "Dispatcher note on ORD0000001",
    message: "Soft Drinks 1L: 8 of 10 cases sent due to a depot stock shortage. The rest follows on Mon 28 Sep.",
    createdAt: "2026-09-26T05:10:00",
    isRead: false,
    orderNumber: "ORD0000001",
    links: [{ label: "View Note", href: "/store/requests/ORD0000001?note=SKU-014" }],
  },
  {
    id: "ntf-4",
    type: "delivered",
    category: "delivery",
    title: "ORD0000004 arrived at the rear dock",
    message: "VEH035 (Carlos Mendes) is waiting at the rear dock. Count the items to confirm.",
    createdAt: "2026-09-26T04:35:00",
    isRead: false,
    orderNumber: "ORD0000004",
    links: [{ label: "Receive Delivery", href: "/store/deliveries/ORD0000004" }],
  },
  {
    id: "ntf-3",
    type: "order_closed",
    category: "request",
    title: "ORD0000005 closed",
    message: "Order closed after ISS0000003 was resolved.",
    createdAt: "2026-09-25T18:02:00",
    isRead: true,
    orderNumber: "ORD0000005",
    links: [],
  },
  {
    id: "ntf-2",
    type: "ready_for_dispatch",
    category: "request",
    title: "ORD0000002 is ready for dispatch",
    message: "The depot packed 4 items (18 units). Scheduled for Mon 28 Sep, 04:00 – 07:45.",
    createdAt: "2026-09-25T16:30:00",
    isRead: true,
    orderNumber: "ORD0000002",
    links: [{ label: "View Order", href: "/store/requests/ORD0000002" }],
  },
  {
    id: "ntf-1",
    type: "deferred",
    category: "request",
    title: "ORD0000009 deferred to Fri 18 Sep",
    message:
      "No reefer vehicle had space on Thu 17 Sep after a breakdown at Peliyagoda Depot, so dispatch moved this request to the next operating day. Nothing to do on your side.",
    createdAt: "2026-09-16T17:20:00",
    isRead: true,
    orderNumber: "ORD0000009",
    links: [{ label: "View Order", href: "/store/requests/ORD0000009" }],
  },
];
