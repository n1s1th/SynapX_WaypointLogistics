"use client";

// Recipient signature, drawn with a finger. Produces a PNG data URL, small
// enough to queue offline. The page doesn't scroll while signing.

import * as React from "react";
import { Eraser } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SignaturePadProps {
  id: string;
  onChange: (dataUrl: string | null) => void;
  disabled?: boolean;
}

export function SignaturePad({ id, onChange, disabled }: SignaturePadProps) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const drawing = React.useRef(false);
  const [hasInk, setHasInk] = React.useState(false);

  // Match the canvas to its on-screen size and the screen's pixel density.
  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    const { width, height } = canvas.getBoundingClientRect();
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const context = canvas.getContext("2d");
    if (!context) return;
    context.scale(ratio, ratio);
    context.lineWidth = 2.5;
    context.lineCap = "round";
    context.lineJoin = "round";
    // The theme's text colour (text-foreground on the canvas).
    context.strokeStyle = getComputedStyle(canvas).color;
  }, []);

  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const start = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    const context = event.currentTarget.getContext("2d");
    if (!context) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drawing.current = true;
    const { x, y } = point(event);
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x + 0.1, y + 0.1);
    context.stroke();
  };

  const move = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const context = event.currentTarget.getContext("2d");
    if (!context) return;
    const { x, y } = point(event);
    context.lineTo(x, y);
    context.stroke();
  };

  const end = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    drawing.current = false;
    setHasInk(true);
    onChange(event.currentTarget.toDataURL("image/png"));
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    setHasInk(false);
    onChange(null);
  };

  return (
    <div className="flex flex-col gap-2">
      {/* select-none: a stroke that slips off the pad mustn't highlight text instead. */}
      <div className="relative overflow-hidden rounded-lg border border-input bg-card select-none">
        <canvas
          id={id}
          ref={canvasRef}
          className="block h-36 w-full touch-none text-foreground"
          aria-label="Signature area: the recipient signs here with a finger"
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
        />
        <div className="pointer-events-none absolute inset-x-4 bottom-7 border-b border-dashed border-border" />
        {!hasInk && (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            Recipient signs here
          </span>
        )}
      </div>
      <Button type="button" variant="outline" size="lg" className="h-11 self-start" onClick={clear} disabled={!hasInk || disabled}>
        <Eraser aria-hidden />
        Clear signature
      </Button>
    </div>
  );
}
