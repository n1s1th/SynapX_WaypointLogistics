"use client";

import React, { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Package, Camera, CheckCircle2, ChevronDown, ChevronUp } from "lucide-react";
import DeviceClock from "@/components/driver/DeviceClock";

const items = [
  { id: 1, name: "Beverage Case 600ml x24", qty: 2, checked: true },
  { id: 2, name: "Snack Pack Assorted", qty: 3, checked: true },
  { id: 3, name: "Dairy Fresh Milk 1L", qty: 1, checked: false },
];

export default function ProofOfDeliveryPage() {
  const [checkedItems, setCheckedItems] = useState(items.map((i) => i.checked));
  const [recipientName, setRecipientName] = useState("");
  const [note, setNote] = useState("");
  const [photoTaken, setPhotoTaken] = useState(false);
  const [showItems, setShowItems] = useState(true);

  const toggleItem = (idx: number) => {
    setCheckedItems((prev) => prev.map((c, i) => (i === idx ? !c : c)));
  };

  const allChecked = checkedItems.every(Boolean);

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: "#F2F5F8", fontFamily: "Inter, sans-serif" }}>
      {/* Status Bar */}
      <div className="flex justify-between items-center px-5" style={{ height: 34, backgroundColor: "#FFFFFF" }}>
        <DeviceClock className="text-xs font-semibold" style={{ color: "#12202E" }} />
      </div>

      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3" style={{ backgroundColor: "#FFFFFF", borderBottom: "1px solid #D9E1E8" }}>
        <Link href="/driver/trip">
          <button className="flex items-center justify-center rounded-full" style={{ width: 36, height: 36, backgroundColor: "#F2F5F8" }}>
            <ArrowLeft size={18} color="#163A5F" />
          </button>
        </Link>
        <div>
          <span className="text-base font-bold" style={{ color: "#163A5F" }}>Proof of Delivery</span>
          <p className="text-xs" style={{ color: "#8793A0" }}>Stop 3 · Waypoint Express #42</p>
        </div>
      </div>

      <div className="flex-1 px-4 py-4 flex flex-col gap-4 pb-32">

        {/* Delivery Info Banner */}
        <div
          className="rounded-2xl p-4 flex items-center gap-3"
          style={{ backgroundColor: "#FFFFFF", border: "1px solid #D9E1E8", boxShadow: "0px 5px 16px 0px rgba(22,58,95,0.08)" }}
        >
          <div
            className="flex items-center justify-center rounded-full shrink-0"
            style={{ width: 44, height: 44, backgroundColor: "#EAF2FF" }}
          >
            <Package size={20} color="#163A5F" />
          </div>
          <div>
            <p className="text-sm font-bold" style={{ color: "#12202E" }}>Waypoint Express #42</p>
            <p className="text-xs" style={{ color: "#8793A0" }}>78 Orchard Blvd, Colombo 07</p>
            <p className="text-xs font-semibold mt-0.5" style={{ color: "#5D6A78" }}>Order #ORD-7821 · 3 items</p>
          </div>
        </div>

        {/* Item Checklist */}
        <div
          className="rounded-2xl overflow-hidden"
          style={{ backgroundColor: "#FFFFFF", border: "1px solid #D9E1E8", boxShadow: "0px 5px 16px 0px rgba(22,58,95,0.08)" }}
        >
          <button
            className="w-full flex items-center justify-between px-4 py-3"
            onClick={() => setShowItems(!showItems)}
          >
            <span className="text-xs font-bold uppercase tracking-wide" style={{ color: "#5D6A78" }}>
              DELIVERY ITEMS ({checkedItems.filter(Boolean).length}/{items.length})
            </span>
            {showItems ? <ChevronUp size={16} color="#8793A0" /> : <ChevronDown size={16} color="#8793A0" />}
          </button>
          {showItems && (
            <div className="px-4 pb-4 flex flex-col gap-3">
              {items.map((item, idx) => (
                <button
                  key={item.id}
                  className="flex items-center gap-3 w-full text-left"
                  onClick={() => toggleItem(idx)}
                >
                  <div
                    className="flex items-center justify-center rounded-full shrink-0"
                    style={{
                      width: 24, height: 24,
                      backgroundColor: checkedItems[idx] ? "#E8F6EF" : "#F2F5F8",
                      border: `1.5px solid ${checkedItems[idx] ? "#18794E" : "#D9E1E8"}`,
                    }}
                  >
                    {checkedItems[idx] && <span style={{ color: "#18794E", fontSize: 13 }}>✓</span>}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold" style={{ color: "#12202E" }}>{item.name}</p>
                    <p className="text-xs" style={{ color: "#8793A0" }}>Qty: {item.qty}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Photo Capture */}
        <div
          className="rounded-2xl overflow-hidden"
          style={{ backgroundColor: "#FFFFFF", border: "1px solid #D9E1E8", boxShadow: "0px 5px 16px 0px rgba(22,58,95,0.08)" }}
        >
          <div className="px-4 pt-3 pb-2">
            <span className="text-xs font-bold uppercase tracking-wide" style={{ color: "#5D6A78" }}>PHOTO PROOF</span>
          </div>
          {!photoTaken ? (
            <button
              className="mx-4 mb-4 w-full flex flex-col items-center justify-center gap-2 rounded-xl py-8"
              style={{ backgroundColor: "#F2F5F8", border: "2px dashed #D9E1E8" }}
              onClick={() => setPhotoTaken(true)}
            >
              <Camera size={28} color="#8793A0" />
              <span className="text-sm font-semibold" style={{ color: "#5D6A78" }}>Tap to take photo</span>
              <span className="text-xs" style={{ color: "#8793A0" }}>Photo of delivered goods required</span>
            </button>
          ) : (
            <div className="mx-4 mb-4 relative">
              <div
                className="w-full rounded-xl flex items-center justify-center"
                style={{ height: 140, backgroundColor: "#D9E1E8" }}
              >
                <div className="flex flex-col items-center gap-2">
                  <CheckCircle2 size={32} color="#18794E" />
                  <span className="text-sm font-semibold" style={{ color: "#18794E" }}>Photo captured</span>
                </div>
              </div>
              <button
                className="absolute top-2 right-2 text-xs font-semibold px-2 py-1 rounded-full"
                style={{ backgroundColor: "#FFFFFF", color: "#163A5F" }}
                onClick={() => setPhotoTaken(false)}
              >
                Retake
              </button>
            </div>
          )}
        </div>

        {/* Recipient Info */}
        <div
          className="rounded-2xl p-4 flex flex-col gap-3"
          style={{ backgroundColor: "#FFFFFF", border: "1px solid #D9E1E8", boxShadow: "0px 5px 16px 0px rgba(22,58,95,0.08)" }}
        >
          <span className="text-xs font-bold uppercase tracking-wide" style={{ color: "#5D6A78" }}>RECIPIENT</span>
          <input
            type="text"
            placeholder="Recipient's full name"
            value={recipientName}
            onChange={(e) => setRecipientName(e.target.value)}
            className="rounded-xl px-4 outline-none text-sm"
            style={{
              height: 48, border: "1px solid #D9E1E8",
              backgroundColor: "#F2F5F8", color: "#12202E",
            }}
          />
          <textarea
            placeholder="Add a note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            className="rounded-xl px-4 py-3 outline-none text-sm resize-none"
            style={{ border: "1px solid #D9E1E8", backgroundColor: "#F2F5F8", color: "#12202E" }}
          />
        </div>
      </div>

      {/* Submit Button */}
      <div
        className="fixed bottom-0 left-0 right-0 px-4 py-4"
        style={{ backgroundColor: "#FFFFFF", boxShadow: "0px -8px 28px 0px rgba(11,39,67,0.16)" }}
      >
        <button
          className="w-full flex items-center justify-center gap-2 rounded-full font-semibold text-base"
          style={{
            height: 52,
            backgroundColor: allChecked && photoTaken && recipientName ? "#18794E" : "#D9E1E8",
            color: allChecked && photoTaken && recipientName ? "#FFFFFF" : "#8793A0",
          }}
        >
          <CheckCircle2 size={20} />
          Confirm Delivery
        </button>
        <p className="text-center text-xs mt-2" style={{ color: "#8793A0" }}>
          {!allChecked ? "Check all items · " : ""}{!photoTaken ? "Take photo · " : ""}{!recipientName ? "Enter recipient name" : ""}
        </p>
      </div>
    </div>
  );
}
