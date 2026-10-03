"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, AlertTriangle, HeartPulse, ShieldAlert,
  Car, Flame, MoreHorizontal, MapPin, Camera, Route
} from "lucide-react";
import { apiFetch } from "@/lib/api";

export default function SOSPage() {
  const router = useRouter();
  
  const [selectedType, setSelectedType] = useState("Vehicle Breakdown");
  const [notes, setNotes] = useState("");
  const [activeTrip, setActiveTrip] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const emergencyTypes = [
    { label: "Accident", icon: AlertTriangle },
    { label: "Medical Emergency", icon: HeartPulse },
    { label: "Safety / Security", icon: ShieldAlert },
    { label: "Vehicle Breakdown", icon: Car },
    { label: "Dangerous Road", icon: Route }, 
    { label: "Vehicle Fire", icon: Flame },
    { label: "Other Emergency", icon: MoreHorizontal }
  ];

  useEffect(() => {
    async function loadActiveTrip() {
      try {
        const trips = await apiFetch<any[]>("/driver/trips/today");
        const startedTrip = trips.find(t => t.status === "started");
        
        if (startedTrip) {
          const detail = await apiFetch<any>(`/driver/trips/${startedTrip.id}`);
          setActiveTrip(detail);
        }
      } catch (error) {
        console.error("Failed to load active trip:", error);
      } finally {
        setLoading(false);
      }
    }
    loadActiveTrip();
  }, []);

  async function handleSubmit() {
    setSubmitting(true);
    
    try {
      await apiFetch("/driver/sos", {
        method: "POST",
        body: JSON.stringify({
          trip_id: activeTrip ? activeTrip.id : null,
          location: "6.9271, 79.8612",
          notes: `${selectedType} - ${notes}`
        })
      });
      router.push("/driver/sos/success");
    } catch (error) {
      console.error("Failed to submit SOS:", error);
      setSubmitting(false);
    }
  }

  const currentStop = activeTrip?.stops?.find((s: any) => s.status === 'pending' || s.status === 'arrived');

  return (
    <div className="h-[100dvh] flex flex-col font-sans overflow-hidden relative" style={{ backgroundColor: "#F2F5F8", fontFamily: "Inter, sans-serif" }}>
      
      {/* Header */}
      <div 
        className="flex items-center justify-between px-4 h-[60px] bg-white shrink-0"
        style={{ borderBottom: "1px solid #E5E5E2" }}
      >
        <div className="flex items-center gap-2">
          <Link href="/driver" className="flex justify-center items-center w-5 h-5">
            <ArrowLeft size={20} color="#171A1F" />
          </Link>
          <span className="font-bold text-[18px]" style={{ color: "#171A1F" }}>Emergency</span>
        </div>
        <div className="flex items-center gap-1">
          <AlertTriangle size={18} color="#171A1F" />
        </div>
      </div>

      {/* Scrollable Content */}
      <div className="flex flex-col flex-1 p-4 gap-4 overflow-y-auto">
        
        {/* Emergency Alert Banner */}
        <div 
          className="flex p-3 gap-3 rounded-r-lg"
          style={{ backgroundColor: "#FBEFEF", borderLeft: "4px solid #AD3D3D" }}
        >
          <AlertTriangle size={20} color="#AD3D3D" className="shrink-0 mt-0.5" />
          <div className="flex flex-col gap-1">
            <span className="font-bold text-[14px]" style={{ color: "#AD3D3D" }}>Emergency Assistance</span>
            <span className="font-normal text-[12px] leading-[16px]" style={{ color: "#6B7280" }}>
              For urgent situations only. Your current location will be shared with the dispatcher.
            </span>
          </div>
        </div>

        {/* Emergency Type Section */}
        <div className="flex flex-col gap-2">
          <span className="font-bold text-[14px]" style={{ color: "#171A1F" }}>What's happening?</span>
          
          <div className="grid grid-cols-2 gap-2">
            {emergencyTypes.map((type, idx) => {
              const Icon = type.icon;
              const isSelected = selectedType === type.label;
              const isFullWidth = idx === emergencyTypes.length - 1 && emergencyTypes.length % 2 !== 0;

              return (
                <div 
                  key={type.label}
                  onClick={() => setSelectedType(type.label)}
                  className={`flex items-center p-[10px] gap-2 rounded-md cursor-pointer ${isFullWidth ? 'col-span-2' : ''}`}
                  style={{
                    backgroundColor: isSelected ? "#FBEFEF" : "#FFFFFF",
                    border: `1px solid ${isSelected ? "#AD3D3D" : "#E5E5E2"}`
                  }}
                >
                  <Icon size={16} color={isSelected ? "#AD3D3D" : "#171A1F"} className="shrink-0" />
                  <span 
                    className={`text-[12px] ${isSelected ? 'font-bold' : 'font-semibold'}`}
                    style={{ color: isSelected ? "#AD3D3D" : "#171A1F" }}
                  >
                    {type.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Two Column Details */}
        <div className="flex gap-3 w-full">
          {/* Delivery Info Card */}
          <div 
            className="flex-1 flex flex-col p-3 gap-2 bg-white rounded-lg"
            style={{ border: "1px solid #E5E5E2", boxShadow: "0px 5px 16px 0px rgba(22, 58, 95, 0.08)" }}
          >
            <span className="font-bold text-[12px]" style={{ color: "#171A1F" }}>Current Delivery</span>
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="font-normal text-[11px]" style={{ color: "#6B7280" }}>Order:</span>
                <span className="font-semibold text-[11px]" style={{ color: "#171A1F" }}>{loading ? "..." : (activeTrip ? `TRIP-${activeTrip.id}` : "None")}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-normal text-[11px]" style={{ color: "#6B7280" }}>Trip:</span>
                <span className="font-semibold text-[11px]" style={{ color: "#171A1F" }}>{loading ? "..." : (activeTrip ? `TRIP-${activeTrip.id}` : "None")}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-normal text-[11px]" style={{ color: "#6B7280" }}>Stop:</span>
                <span className="font-semibold text-[11px] truncate" style={{ color: "#171A1F" }}>{loading ? "..." : (currentStop ? currentStop.customer_name : "None")}</span>
              </div>
            </div>
          </div>

          {/* Location Card */}
          <div 
            className="flex-1 flex flex-col p-3 gap-2 bg-white rounded-lg"
            style={{ border: "1px solid #E5E5E2", boxShadow: "0px 5px 16px 0px rgba(22, 58, 95, 0.08)" }}
          >
            <div className="flex flex-col gap-1">
              <span className="font-bold text-[12px]" style={{ color: "#171A1F" }}>Current Location</span>
              <div className="flex items-center px-1.5 py-0.5 rounded" style={{ backgroundColor: "#F0F7F2", width: "fit-content" }}>
                <span className="font-bold text-[9px]" style={{ color: "#3D7954" }}>Location Available</span>
              </div>
            </div>
            <div className="flex justify-center items-center h-[42px] rounded" style={{ backgroundColor: "#DCE3EB" }}>
              <MapPin size={14} color="#171A1F" />
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="font-semibold text-[10px]" style={{ color: "#171A1F" }}>6.9271° N, 79.8612° E</span>
              <span className="font-normal text-[9px]" style={{ color: "#6B7280" }}>Shared with dispatcher</span>
              <span className="font-normal text-[9px]" style={{ color: "#6B7280" }}>Location captured automatically</span>
            </div>
          </div>
        </div>

        {/* Input Section */}
        <div className="flex flex-col gap-2">
          <span className="font-bold text-[13px]" style={{ color: "#171A1F" }}>Tell us what happened</span>
          <textarea 
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full h-[120px] p-4 rounded bg-white outline-none resize-none font-normal text-[16px]"
            style={{ border: "1px solid #E5E5E2", color: "#4F4F4F" }}
            placeholder="Briefly describe the emergency..."
          />
        </div>

        {/* Photo Upload */}
        <div className="flex items-center p-3 gap-2.5 bg-white rounded-md cursor-pointer" style={{ border: "1px dashed #E5E5E2" }}>
          <div className="flex justify-center items-center w-[18px] h-[18px]">
            <Camera size={18} color="#171A1F" />
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="font-semibold text-[12px]" style={{ color: "#171A1F" }}>Add Photo</span>
            <span className="font-normal text-[10px]" style={{ color: "#6B7280" }}>Optional proof of incident</span>
          </div>
        </div>
      </div>

      {/* Sticky Footer */}
      <div 
        className="flex flex-col p-4 gap-3 bg-white shrink-0"
        style={{ borderTop: "1px solid #E5E5E2" }}
      >
        <button 
          onClick={handleSubmit}
          disabled={submitting || loading}
          className="w-full flex justify-center items-center py-3.5 rounded-md text-white font-bold text-[15px] disabled:opacity-50"
          style={{ backgroundColor: "#AD3D3D" }}
        >
          {submitting ? "SENDING..." : "SEND EMERGENCY ALERT"}
        </button>
        <Link href="/driver" className="w-full">
          <button className="w-full flex justify-center items-center py-1">
            <span className="font-semibold text-[14px]" style={{ color: "#6B7280" }}>Cancel</span>
          </button>
        </Link>
      </div>
    </div>
  );
}
