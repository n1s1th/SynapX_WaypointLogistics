"use client";
import React from "react";
import type { LiveRun } from "@/app/dispatcher/live-tracking/page";

interface LiveRouteMapProps {
  run: LiveRun | null;
}

export function LiveRouteMap({ run }: LiveRouteMapProps) {
  if (!run) {
    return (
      <div className="h-full w-full bg-[#f8f9fa] rounded-lg border border-slate-100 flex items-center justify-center text-slate-400">
        <p>Select a run to focus the map.</p>
      </div>
    );
  }

  // Derive points from stop_sequence
  const deliveryStops = run.stop_sequence && run.stop_sequence.length > 0
    ? run.stop_sequence
    : Array.from({ length: Math.max(run.stop_count, 1) }, (_, i) => `Stop ${i + 1}`);

  // Logically, a run starts at the Depot. If stops_completed is 0, it is at the Depot.
  const stops = [{ name: `${(run.depot_name || "Depot").toUpperCase()} DEPOT` }, ...deliveryStops];

  const N = stops.length;
  // Fallback to 2 points if N < 2 to avoid division by zero or weird paths
  const pointCount = Math.max(N, 2); 
  const currentStopIndex = run.status === "en_route" || run.status === "completed" 
    ? Math.min(run.stops_completed, N - 1) 
    : 0; // If scheduled or ready, it is at the Depot (index 0)

  // Distribute X from 80 to 720
  const startX = 80;
  const endX = 720;
  const stepX = (endX - startX) / (pointCount - 1);

  // Use a sine-wave based distribution for Y to create a smooth, natural-looking route
  const points = stops.map((stop, i) => {
    const x = startX + i * stepX;
    // Base frequency so that a typical run has 1 or 1.5 waves across the width
    const normalized = i / (pointCount - 1 || 1);
    const y = 150 + Math.sin(normalized * Math.PI * 2.5) * 45;
    return { x, y, name: typeof stop === 'string' ? stop : (stop as any).name || `Stop ${i}` };
  });

  // Helper to generate a smooth bezier path through points
  const generateSmoothPath = (pts: {x: number, y: number}[]) => {
    if (pts.length === 0) return "";
    let d = `M ${pts[0].x},${pts[0].y} `;
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1];
      const curr = pts[i];
      // Control points for a horizontal-flowing smooth curve
      const cpX = prev.x + (curr.x - prev.x) * 0.5;
      d += `C ${cpX},${prev.y} ${cpX},${curr.y} ${curr.x},${curr.y} `;
    }
    return d;
  };

  const fullPath = generateSmoothPath(points);
  
  // Create partial path up to the current vehicle location
  const completedPoints = points.slice(0, currentStopIndex + 1);
  const compPath = generateSmoothPath(completedPoints);

  return (
    <div className="relative h-full w-full rounded-lg overflow-hidden bg-[#f8f9fa] border border-slate-100">
      <svg width="100%" height="100%" viewBox="0 0 800 300" preserveAspectRatio="xMidYMid slice" className="absolute inset-0">
        
        {/* Decorative background grid blocks */}
        <defs>
          <pattern id="grid" width="120" height="80" patternUnits="userSpaceOnUse">
            <rect width="110" height="70" x="5" y="5" fill="#e2e8f0" rx="12" opacity="0.2" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />
        
        {/* Decorative background curvy lines (like map contours) */}
        <path d="M 0,220 Q 200,300 400,200 T 800,250" fill="none" stroke="#e2e8f0" strokeWidth="2" opacity="0.6" />
        <path d="M 0,100 Q 300,0 500,100 T 800,50" fill="none" stroke="#e2e8f0" strokeWidth="2" opacity="0.6" />
        <path d="M -50,150 Q 200,250 400,150 T 850,200" fill="none" stroke="#e2e8f0" strokeWidth="1" opacity="0.4" />

        {/* Draw the full base path (Remaining segment) */}
        <path d={fullPath} fill="none" stroke="#CBD5E1" strokeWidth="4" strokeLinecap="round" />
        
        {/* Draw the completed segment */}
        {completedPoints.length > 1 && (
          <path d={compPath} fill="none" stroke="#18385F" strokeWidth="6" strokeLinecap="round" />
        )}

        {/* Draw the stops */}
        {points.map((p, i) => {
          const isDone = i <= run.stops_completed;
          const isCurrent = i === currentStopIndex;
          return (
            <g key={i}>
              <circle 
                cx={p.x} cy={p.y} 
                r="14" 
                fill={isDone ? "#18385F" : "white"} 
                stroke="#18385F" 
                strokeWidth="2" 
              />
              <text 
                x={p.x} y={p.y} 
                textAnchor="middle" dy="4" 
                fontSize="12" 
                fontWeight="600" 
                fill={isDone ? "white" : "#18385F"}
              >
                {i + 1}
              </text>
              
              {/* Stop Label (alternating above/below to prevent overlap) */}
              <text 
                x={p.x} 
                y={i % 2 === 0 ? p.y - 24 : p.y + 32} 
                textAnchor="middle" 
                fontSize="11" 
                fontWeight="500"
                fill="#64748b"
              >
                {p.name.length > 15 ? p.name.substring(0, 12) + "..." : p.name}
              </text>
            </g>
          );
        })}

        {/* Draw the Vehicle */}
        {points[currentStopIndex] && (
          <g transform={`translate(${points[currentStopIndex].x}, ${points[currentStopIndex].y})`}>
            {/* Vehicle Indicator Group */}
            <circle cx="0" cy="0" r="22" fill="#18385F" className="drop-shadow-md" />
            <circle cx="0" cy="0" r="28" fill="#18385F" opacity="0.15" className="animate-pulse" />
            
            {/* Navigation Arrow */}
            <polygon points="0,-8 7,5 0,3 -7,5" fill="white" transform="rotate(90)" />
            
            {/* Vehicle ID label badge */}
            <rect x="-30" y="30" width="60" height="20" rx="4" fill="white" stroke="#e2e8f0" strokeWidth="1" className="drop-shadow-sm" />
            <text x="0" y="44" textAnchor="middle" fontSize="10" fontWeight="bold" fill="#18385F">
              {run.vehicle_number}
            </text>
          </g>
        )}
      </svg>
      
      {/* Legend */}
      <div className="absolute bottom-4 right-6 bg-white/95 backdrop-blur-md border border-slate-200 px-4 py-2.5 rounded-full flex items-center gap-5 text-xs font-medium text-slate-600 shadow-sm">
        <div className="flex items-center gap-1.5">
          <div className="size-3.5 rounded-full border-2 border-[#18385F] bg-white"></div>
          Stop
        </div>
        <div className="flex items-center gap-1.5">
          <div className="size-3.5 rounded-full bg-[#18385F] flex items-center justify-center">
            <div className="size-1 rounded-full bg-white"></div>
          </div>
          Vehicle
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-5 h-1 bg-[#18385F] rounded-full"></div>
          Route
        </div>
      </div>
    </div>
  );
}
