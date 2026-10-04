"use client";

/**
 * What the driver is handing over at this stop: each order, its goods,
 * delivery window and temperature, plus unloading instructions. Styled to
 * match the driver bottom-sheet screens.
 */
import type { ReactNode } from "react";
import { Clock, Package, Phone, Snowflake, Info } from "lucide-react";
import type { StopDetail, StopOrderInfo } from "@/lib/driverStop";

export default function StopDeliveryDetails({ stop }: { stop: StopDetail }) {
  const orders = stop.orders?.length ? stop.orders : stop.order ? [stop.order] : [];
  const notes = stop.notes || orders.find((order) => order.notes)?.notes;
  const stopLabel = `Stop ${stop.sequence} of ${stop.total_stops}`;

  return (
    <div className="flex flex-col w-full rounded-xl bg-white overflow-hidden shrink-0" style={{ border: "1px solid #D9E1E8" }}>
      {orders.length === 0 && (
        <div className="flex flex-col gap-0.5 px-3.5 py-3" style={{ backgroundColor: "#F2F5F8" }}>
          <span className="font-bold text-[10px] uppercase" style={{ color: "#5D6A78" }}>{stopLabel}</span>
          <span className="font-bold text-[14px]" style={{ color: "#12202E" }}>No order linked</span>
        </div>
      )}

      {orders.map((order, index) => (
        <OrderSection
          key={order.order_number}
          order={order}
          label={
            index === 0
              ? orders.length > 1 ? `${stopLabel} · ${orders.length} orders` : stopLabel
              : `Order ${index + 1} of ${orders.length}`
          }
          divider={index > 0}
        />
      ))}

      {/* Unloading instructions */}
      {notes && (
        <div className="flex items-start gap-2 mx-3.5 mb-3 p-2.5 rounded-lg" style={{ backgroundColor: "#FFF4D6" }}>
          <Info size={15} color="#A85D00" className="shrink-0 mt-px" />
          <span className="text-[12px] leading-[1.45em]" style={{ color: "#A85D00" }}>
            {notes}
          </span>
        </div>
      )}

      {/* Outlet contact */}
      {stop.customer_phone && (
        <a
          href={`tel:${stop.customer_phone}`}
          className="flex items-center gap-2 px-3.5 py-2.5"
          style={{ borderTop: "1px solid #D9E1E8" }}
        >
          <Phone size={14} color="#2167D5" />
          <span className="font-semibold text-[12px]" style={{ color: "#2167D5" }}>Call outlet · {stop.customer_phone}</span>
        </a>
      )}
    </div>
  );
}

function OrderSection({ order, label, divider }: { order: StopOrderInfo; label: string; divider: boolean }) {
  const chilled = order.temperature_zone?.toLowerCase().includes("chill") ||
    order.temperature_zone?.toLowerCase().includes("frozen");
  const notLoaded = order.on_truck === false;

  return (
    <>
      {/* Order header */}
      <div
        className="flex justify-between items-center px-3.5 py-3"
        style={{ backgroundColor: "#F2F5F8", ...(divider ? { borderTop: "1px solid #D9E1E8" } : {}) }}
      >
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="font-bold text-[10px] uppercase" style={{ color: "#5D6A78" }}>
            {label}
          </span>
          <span className="font-bold text-[14px] truncate" style={{ color: "#12202E" }}>
            {order.order_number}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {notLoaded && (
            <span className="px-2 py-0.5 rounded-full font-bold text-[10px]" style={{ backgroundColor: "#FBEAEA", color: "#AD3D3D" }}>
              Not loaded
            </span>
          )}
          {order.brand && (
            <span className="px-2 py-0.5 rounded-full font-bold text-[10px]" style={{ backgroundColor: "#FFFFFF", color: "#163A5F", border: "1px solid #D9E1E8" }}>
              {order.brand}
            </span>
          )}
          {order.temperature_zone && (
            <span
              className="flex items-center gap-1 px-2 py-0.5 rounded-full font-bold text-[10px]"
              style={chilled ? { backgroundColor: "#EAF2FF", color: "#2167D5" } : { backgroundColor: "#FFFFFF", color: "#5D6A78", border: "1px solid #D9E1E8" }}
            >
              {chilled && <Snowflake size={11} />}
              {order.temperature_zone}
            </span>
          )}
        </div>
      </div>

      {notLoaded && (
        <span className="px-3.5 pt-2.5 text-[12px]" style={{ color: "#AD3D3D" }}>
          The loader flagged this order at the depot. It is not on the truck, so don&apos;t hand it over.
        </span>
      )}

      {/* Key figures */}
      <div className="flex w-full" style={{ borderBottom: "1px solid #D9E1E8" }}>
        <Figure icon={<Clock size={13} color="#5D6A78" />} label="WINDOW" value={order.delivery_window ?? "--"} />
        <Figure label="UNITS" value={order.units != null ? String(order.units) : "--"} divider />
        <Figure label="WEIGHT" value={order.weight_kg ? `${Math.round(order.weight_kg)} kg` : "--"} divider />
      </div>

      {/* Goods list */}
      <div className="flex flex-col px-3.5 py-2.5">
        <span className="font-bold text-[10px] pb-1" style={{ color: "#5D6A78" }}>GOODS TO HAND OVER</span>
        {order.items.length === 0 && (
          <span className="text-[12px] py-1" style={{ color: "#8793A0" }}>No item lines on this order.</span>
        )}
        {order.items.map((item) => (
          <div key={item.sku} className="flex items-center gap-2.5 py-1.5" style={{ borderTop: "1px solid #F2F5F8" }}>
            <Package size={15} color="#163A5F" className="shrink-0" />
            <div className="flex flex-col flex-1 min-w-0">
              <span className="font-semibold text-[13px] truncate" style={{ color: "#12202E" }}>{item.item_name}</span>
              <span className="text-[10px]" style={{ color: "#8793A0" }}>{item.sku}</span>
            </div>
            <span className="font-bold text-[14px] shrink-0" style={{ color: "#12202E" }}>× {item.quantity}</span>
          </div>
        ))}
      </div>
    </>
  );
}

function Figure({ label, value, icon, divider }: { label: string; value: string; icon?: ReactNode; divider?: boolean }) {
  return (
    <div className="flex-1 flex flex-col gap-0.5 px-3.5 py-2.5" style={divider ? { borderLeft: "1px solid #D9E1E8" } : undefined}>
      <span className="flex items-center gap-1 font-bold text-[10px]" style={{ color: "#5D6A78" }}>
        {icon}
        {label}
      </span>
      <span className="font-bold text-[14px]" style={{ color: "#12202E" }}>{value}</span>
    </div>
  );
}
