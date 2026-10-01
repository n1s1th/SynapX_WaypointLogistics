export interface StoreIssue {
  id: string;
  orderId: string;
  type: "Damaged Goods" | "Missing Items" | "Quantity Mismatch" | "Temperature Breach" | "Wrong Consignment";
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

const STORAGE_KEY = "waypoint_store_issues";

export function getStoredIssues(): StoreIssue[] {
  if (typeof window === "undefined") return initialMockIssues;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(initialMockIssues));
      return initialMockIssues;
    }
    return JSON.parse(raw);
  } catch {
    return initialMockIssues;
  }
}

export function saveIssue(issue: Omit<StoreIssue, "id" | "reportedAt" | "reportedBy" | "status">): StoreIssue {
  const current = getStoredIssues();
  const nextNum = current.length + 1;
  const newIssue: StoreIssue = {
    ...issue,
    id: `ISS${String(nextNum).padStart(7, "0")}`,
    reportedAt: new Date().toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }),
    reportedBy: "Sarah Jenkins (Store Manager)",
    status: "open",
  };

  const updated = [newIssue, ...current];
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      window.dispatchEvent(new Event("waypoint_issues_updated"));
    } catch (e) {
      console.error("Failed to save issue to localStorage", e);
    }
  }
  return newIssue;
}
