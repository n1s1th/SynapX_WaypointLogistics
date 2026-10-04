export type OrderStatus =
  | "DRAFT"
  | "SUBMITTED"
  | "CONFIRMED"
  | "PROCESSING"
  | "ALLOCATED"
  | "READY_FOR_DISPATCH"
  | "DEFERRED"
  | "DISPATCHED"
  | "DELIVERED"
  | "COMPLETED"
  | "CANCELLED";

export interface OrderItem {
  id: number;
  order_id: number;
  sku: string;
  item_name: string;
  quantity: number;
  unit_price: number;
  quantity_sent?: number | null;
  dispatcher_note?: string | null;
}

export interface Order {
  id: number;
  order_number: string;
  client_name: string;
  destination_address: string;
  status: OrderStatus;
  total_amount: number;
  brand?: string | null;
  district?: string | null;
  temperature_zone: "Chilled" | "Ambient" | string;
  delivery_window?: string | null;
  weight_kg: number;
  units?: number | null;
  volume_m3?: number | null;
  order_units?: number;
  order_weight_kg?: number;
  order_volume_m3?: number;
  temp_requirement?: string;
  is_priority: boolean;
  is_late: boolean;
  operating_date?: string | null;
  deferral_reason?: string | null;
  notes?: string | null;
  allocation_id?: number | null;
  requires_van?: boolean;
  created_at: string;
  updated_at: string;
  items?: OrderItem[];
}

export interface OrderMetrics {
  total_orders: number;
  confirmed: number;
  unallocated: number;
  allocated: number;
  deferred: number;
  priority: number;
  late: number;
}

export interface InventoryItem {
  id: number;
  sku: string;
  name: string;
  chain?: string | null;
  unit_weight_kg: number;
  unit_volume_m3: number;
  temp_requirement: string;
  depot_name?: string | null;
  updated_at: string;
}

export interface ChainCargoSummary {
  chain: string;
  total_skus: number;
  chilled_skus: number;
  ambient_skus: number;
  avg_weight_kg: number;
  avg_volume_m3: number;
  last_updated?: string | null;
}

export type ChainStockSummary = ChainCargoSummary;


