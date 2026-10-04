import { apiFetch, ApiError } from "@/components/store/api/client";
import { STORE_DATA_SOURCE } from "@/components/store/api/config";
import { getStoreOrder, getStoreSession } from "@/components/store/api/store-data";

export interface StoreIssue {
  id: string;
  orderId: string;
  type: "Damaged Goods" | "Missing Items" | "Quantity Mismatch" | "Temperature Breach" | "Wrong Consignment" | "Other";
  title: string;
  affectedItem: string;
  sku: string;
  expectedUnits: number;
  receivedUnits: number;
  description: string;
  photoUrl?: string;
  photoName?: string;
  photoSize?: string;
  reportedAt: string;
  reportedBy: string;
  status: "open" | "under_review" | "resolved" | "credit_issued";
  resolutionNotes?: string;
  claimedAmount?: string;
  driverName?: string;
  vehicleId?: string;
}

export interface ApiDeliveryIssue {
  id: number;
  order_id: number | null;
  order_number: string | null;
  outlet_id: number | null;
  issue_type: string;
  title: string;
  affected_item: string | null;
  sku: string | null;
  expected_units: number | null;
  received_units: number | null;
  description: string;
  photo_url: string | null;
  photo_name: string | null;
  photo_size: string | null;
  reported_by: string;
  status: "open" | "under_review" | "resolved" | "credit_issued";
  resolution_notes: string | null;
  claimed_amount: string | null;
  driver_name: string | null;
  vehicle_id: string | null;
  reported_at: string;
  created_at: string;
  updated_at: string;
}

export function fromApiIssue(api: ApiDeliveryIssue): StoreIssue {
  return {
    id: `ISS${String(api.id).padStart(7, "0")}`,
    orderId: api.order_number ?? "",
    type: (api.issue_type as StoreIssue["type"]) || "Damaged Goods",
    title: api.title,
    affectedItem: api.affected_item || "Whole delivery",
    sku: api.sku || "",
    expectedUnits: api.expected_units ?? 0,
    receivedUnits: api.received_units ?? 0,
    description: api.description,
    photoUrl: api.photo_url || undefined,
    photoName: api.photo_name || undefined,
    photoSize: api.photo_size || undefined,
    reportedAt: new Date(api.reported_at).toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }),
    reportedBy: api.reported_by || "Store Manager",
    status: api.status,
    resolutionNotes: api.resolution_notes || undefined,
    claimedAmount: api.claimed_amount || undefined,
    driverName: api.driver_name || undefined,
    vehicleId: api.vehicle_id || undefined,
  };
}

export const initialMockIssues: StoreIssue[] = [
  {
    id: "ISS0000001",
    orderId: "ORD0000001",
    type: "Damaged Goods",
    title: "Crushed Packaging on Paper Cups",
    affectedItem: "Paper Cups 8oz (500ct)",
    sku: "SKU-032",
    expectedUnits: 5,
    receivedUnits: 5,
    description: "Two boxes of paper cups were damaged during transit with crushed outer cartons and broken inner sleeves.",
    photoUrl: "/images/damaged_cups_evidence.jpg",
    photoName: "damaged_paper_cups.jpg",
    photoSize: "2.4 MB • Captured today",
    reportedAt: "26 Sep 2026, 06:25",
    reportedBy: "Sarah Jenkins (Store Manager)",
    status: "under_review",
    driverName: "Marcus Vance",
    vehicleId: "VEH001",
    claimedAmount: "LKR 4,200.00",
  },
  {
    id: "ISS0000002",
    orderId: "ORD0000006",
    type: "Missing Items",
    title: "2 Cases Short Delivery",
    affectedItem: "Soft Drinks 1L (12pk)",
    sku: "SKU-014",
    expectedUnits: 8,
    receivedUnits: 6,
    description: "Vehicle manifest indicated 8 cases loaded, but dock count only identified 6 intact cases. Loader shortage at depot.",
    photoUrl: "/images/missing_items_manifest.jpg",
    photoName: "shortage_manifest_dock.jpg",
    photoSize: "1.8 MB • Captured 19 Sep",
    reportedAt: "19 Sep 2026, 11:20",
    reportedBy: "Sarah Jenkins (Store Manager)",
    status: "open",
    driverName: "Kamal Perera",
    vehicleId: "VEH009",
    claimedAmount: "LKR 3,600.00",
  },
  {
    id: "ISS0000003",
    orderId: "ORD0000005",
    type: "Quantity Mismatch",
    title: "1 Case Over-Delivery (Bottled Water)",
    affectedItem: "Bottled Water 500ml (24pk)",
    sku: "SKU-001",
    expectedUnits: 20,
    receivedUnits: 21,
    description: "Received 21 cases instead of 20 ordered. Extra case retained at dock awaiting dispatch reconciliation.",
    photoName: "excess_stock_pallet.jpg",
    photoSize: "1.1 MB • Captured 23 Sep",
    reportedAt: "23 Sep 2026, 05:40",
    reportedBy: "Sarah Jenkins (Store Manager)",
    status: "resolved",
    driverName: "Elena Ramos",
    vehicleId: "VEH037",
    resolutionNotes: "Discrepancy reconciled with Peliyagoda inventory ledger.",
  },
];

// ── Reading and logging issues ──────────────────────────────────────────────────────────────────────────
// Live data only: the backend scopes issues to the signed-in manager's outlet. Nothing is kept in the
// browser, so every device and the Dispatcher see the same list. initialMockIssues is for mock mode only.

/** The outlet's delivery issues, newest first. */
export async function fetchStoreIssues(): Promise<StoreIssue[]> {
  if (STORE_DATA_SOURCE !== "api") return initialMockIssues;
  const { outlet } = await getStoreSession();
  const issues = await apiFetch<ApiDeliveryIssue[]>(`/issues?outlet_id=${outlet.id}`);
  return issues.map(fromApiIssue);
}

export type NewStoreIssue = Omit<StoreIssue, "id" | "reportedAt" | "reportedBy" | "status">;

/** Logs an issue against one of the outlet's orders. Throws (ApiError) if the server doesn't accept it. */
export async function createStoreIssue(issue: NewStoreIssue): Promise<StoreIssue> {
  if (STORE_DATA_SOURCE !== "api") {
    throw new ApiError("Issue reporting needs the Waypoint server. Switch to live data.", 400);
  }
  const [{ outlet }, order] = await Promise.all([
    getStoreSession(),
    issue.orderId ? getStoreOrder(issue.orderId) : Promise.resolve(null),
  ]);
  if (issue.orderId && !order) {
    throw new ApiError(`${issue.orderId} isn't one of your orders.`, 404);
  }
  const created = await apiFetch<ApiDeliveryIssue>("/issues", {
    method: "POST",
    body: JSON.stringify({
      // The real order id, not the digits of the order number.
      order_id: order?.id ?? null,
      order_number: order?.orderNumber ?? null,
      outlet_id: outlet.id,
      issue_type: issue.type,
      title: issue.title,
      affected_item: issue.affectedItem || null,
      sku: issue.sku || null,
      expected_units: issue.expectedUnits,
      received_units: issue.receivedUnits,
      description: issue.description,
      photo_url: issue.photoUrl || null,
      photo_name: issue.photoName || null,
      photo_size: issue.photoSize || null,
      claimed_amount: issue.claimedAmount || null,
    }),
  });
  return fromApiIssue(created);
}

/** Updates an existing issue complaint. */
export async function updateStoreIssue(
  issueId: string | number,
  updates: Partial<StoreIssue>
): Promise<StoreIssue> {
  if (STORE_DATA_SOURCE !== "api") {
    throw new ApiError("Issue reporting needs the Waypoint server. Switch to live data.", 400);
  }
  const numericId = typeof issueId === "string" ? parseInt(issueId.replace(/^ISS/i, ""), 10) : issueId;
  const payload: Record<string, unknown> = {};
  if (updates.type !== undefined) payload.issue_type = updates.type;
  if (updates.title !== undefined) payload.title = updates.title;
  if (updates.affectedItem !== undefined) payload.affected_item = updates.affectedItem;
  if (updates.sku !== undefined) payload.sku = updates.sku;
  if (updates.expectedUnits !== undefined) payload.expected_units = updates.expectedUnits;
  if (updates.receivedUnits !== undefined) payload.received_units = updates.receivedUnits;
  if (updates.description !== undefined) payload.description = updates.description;
  if (updates.photoUrl !== undefined) payload.photo_url = updates.photoUrl;
  if (updates.photoName !== undefined) payload.photo_name = updates.photoName;
  if (updates.photoSize !== undefined) payload.photo_size = updates.photoSize;
  if (updates.status !== undefined) payload.status = updates.status;
  if (updates.claimedAmount !== undefined) payload.claimed_amount = updates.claimedAmount;
  if (updates.resolutionNotes !== undefined) payload.resolution_notes = updates.resolutionNotes;

  const updated = await apiFetch<ApiDeliveryIssue>(`/issues/${numericId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  return fromApiIssue(updated);
}

/** Deletes/withdraws a logged issue complaint. */
export async function deleteStoreIssue(issueId: string | number): Promise<void> {
  if (STORE_DATA_SOURCE !== "api") {
    throw new ApiError("Issue reporting needs the Waypoint server. Switch to live data.", 400);
  }
  const numericId = typeof issueId === "string" ? parseInt(issueId.replace(/^ISS/i, ""), 10) : issueId;
  await apiFetch<void>(`/issues/${numericId}`, {
    method: "DELETE",
  });
}

