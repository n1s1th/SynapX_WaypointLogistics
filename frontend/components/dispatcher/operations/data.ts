export interface OrderRecord {
  id: number;
  order_number: string;
  client_name: string;
  destination_address: string;
  status: string;
  created_at: string;
  items: { quantity: number }[];
}

const clean = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();
export const isOpen = (order: OrderRecord) => !["delivered", "cancelled"].includes(order.status);

// The current backend uses naive DateTime columns populated with UTC values.
export function orderDay(timestamp: string): string {
  const utc = /(?:Z|[+-]\d{2}:\d{2})$/i.test(timestamp) ? timestamp : `${timestamp}Z`;
  const date = new Date(utc);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Colombo", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export function shiftDay(day: string, amount: number) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

export function destinationKey(order: OrderRecord) {
  return JSON.stringify([clean(order.client_name), clean(order.destination_address)]);
}

export function groupDestinations(orders: OrderRecord[]) {
  const groups = new Map<string, { key: string; name: string; address: string; orders: OrderRecord[] }>();
  for (const order of orders) {
    const key = destinationKey(order);
    if (!groups.has(key)) groups.set(key, { key, name: order.client_name, address: order.destination_address, orders: [] });
    groups.get(key)!.orders.push(order);
  }
  return [...groups.values()].map((group) => ({
    ...group,
    orders: [...group.orders].sort((a, b) => b.created_at.localeCompare(a.created_at)),
    open: group.orders.filter(isOpen).length,
    delivered: group.orders.filter((o) => o.status === "delivered").length,
    lastOrder: group.orders.map((o) => orderDay(o.created_at)).sort().at(-1) || "",
  })).sort((a, b) => a.name.localeCompare(b.name) || a.address.localeCompare(b.address));
}

export function dailyCounts(orders: OrderRecord[], start: string, end: string) {
  const counts = new Map<string, number>();
  for (const order of orders) {
    const day = orderDay(order.created_at);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  const days: { day: string; count: number }[] = [];
  for (let day = start; day <= end; day = shiftDay(day, 1)) days.push({ day, count: counts.get(day) ?? 0 });
  return days;
}

export function forecastOrders(orders: OrderRecord[], today: string, windowDays: number, horizon: number) {
  const start = shiftDay(today, -windowDays);
  const end = shiftDay(today, -1);
  const valid = orders.filter((o) => orderDay(o.created_at) && orderDay(o.created_at) < today);
  const first = valid.map((o) => orderDay(o.created_at)).sort()[0];
  const days = dailyCounts(valid, start, end);
  const total = days.reduce((sum, d) => sum + d.count, 0);
  // Date span is only a minimum eligibility gate, never proof of complete history.
  const eligible = Boolean(first && first <= start && total > 0);
  const mean = total / windowDays;
  return {
    start, end, days, total, eligible, mean,
    predictions: eligible ? Array.from({ length: horizon }, (_, i) => ({ day: shiftDay(today, i + 1), count: mean })) : [],
  };
}

export async function fetchOrders(signal: AbortSignal): Promise<OrderRecord[]> {
  const base = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000").replace(/\/$/, "");
  const records = new Map<number, OrderRecord>();
  for (let skip = 0; ; skip += 100) {
    const response = await fetch(`${base}/api/v1/orders/?skip=${skip}&limit=100`, { signal, cache: "no-store" });
    if (!response.ok) throw new Error(`Orders could not be loaded (${response.status}).`);
    const page: unknown = await response.json();
    if (!Array.isArray(page) || !page.every((item) => item && typeof item.id === "number" &&
      typeof item.order_number === "string" && typeof item.client_name === "string" &&
      typeof item.destination_address === "string" && typeof item.status === "string" &&
      typeof item.created_at === "string" && orderDay(item.created_at) && Array.isArray(item.items))) {
      throw new Error("The orders response contains invalid records.");
    }
    const before = records.size;
    for (const item of page as OrderRecord[]) records.set(item.id, item);
    if (page.length < 100) break;
    if (records.size === before) throw new Error("Orders pagination did not advance. Please retry.");
  }
  return [...records.values()];
}

export function csvText(rows: (string | number)[][]) {
  return rows.map((row) => row.map((cell) => {
    let text = String(cell);
    // Treat exported user-entered values as text, including leading whitespace.
    if (/^\s*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  }).join(",")).join("\r\n");
}

export function downloadCsv(name: string, rows: (string | number)[][]) {
  const url = URL.createObjectURL(new Blob(["\uFEFF", csvText(rows)], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = name;
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
