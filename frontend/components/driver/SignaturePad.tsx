"use client";

/**
 * Finger/mouse signature capture. Emits a PNG data URL on every finished
 * stroke, or null when cleared.
 */
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Eraser } from "lucide-react";

const HEIGHT = 140;

export default function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [signedAt, setSignedAt] = useState<string | null>(null);

  // Size the canvas backing store to the device pixel ratio for crisp strokes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvas.offsetWidth * dpr;
    canvas.height = HEIGHT * dpr;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2.4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#163A5F";
  }, []);

  function point(e: ReactPointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function start(e: ReactPointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    last.current = point(e);
  }

  function move(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawing.current || !last.current) return;
    const ctx = e.currentTarget.getContext("2d")!;
    const p = point(e);
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
  }

  function end() {
    if (!drawing.current) return;
    drawing.current = false;
    last.current = null;
    setSignedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
    onChange(canvasRef.current!.toDataURL("image/png"));
  }

  function clear() {
    const canvas = canvasRef.current!;
    canvas.getContext("2d")!.clearRect(0, 0, canvas.width, canvas.height);
    setSignedAt(null);
    onChange(null);
  }

  return (
    <div className="relative w-full rounded-lg bg-white overflow-hidden" style={{ height: HEIGHT, border: "1px solid #D9E1E8" }}>
      {/* Baseline */}
      <div className="absolute left-[18px] right-[18px] bottom-[26px] h-px pointer-events-none" style={{ backgroundColor: "#D9E1E8" }} />

      {!signedAt && (
        <span className="absolute inset-0 flex items-center justify-center text-[13px] pointer-events-none" style={{ color: "#8793A0" }}>
          Ask the recipient to sign here
        </span>
      )}

      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full"
        style={{ height: HEIGHT, touchAction: "none", cursor: "crosshair" }}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        onPointerCancel={end}
      />

      <div className="absolute left-[18px] bottom-[8px] pointer-events-none">
        <span className="font-normal text-[10px]" style={{ color: "#8793A0" }}>
          {signedAt ? `Signed at ${signedAt}` : "Not signed"}
        </span>
      </div>

      {signedAt && (
        <button
          type="button"
          onClick={clear}
          className="absolute right-2 top-2 flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold"
          style={{ backgroundColor: "#F2F5F8", color: "#5D6A78" }}
        >
          <Eraser size={12} />
          Clear
        </button>
      )}
    </div>
  );
}
