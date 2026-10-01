"use client";

// Photo evidence from the phone camera, shrunk to a JPEG of at most 1280 px
// (about 100-200 KB) so it fits in the offline queue and syncs over a weak signal.

import * as React from "react";
import Image from "next/image";
import { Camera, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

const MAX_SIDE = 1280;
const QUALITY = 0.7;

async function shrink(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not read the photo.");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", QUALITY);
}

interface PhotoCaptureProps {
  value: string | null;
  onChange: (dataUrl: string | null) => void;
  label?: string;
  hint?: string;
}

export function PhotoCapture({ value, onChange, label = "Add photo", hint }: PhotoCaptureProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const pick = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      onChange(await shrink(file));
    } catch {
      setError("That photo couldn't be read. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <input ref={inputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={pick} />
      {value ? (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-2">
          <Image
            src={value}
            alt="Photo evidence"
            width={96}
            height={72}
            unoptimized
            className="h-18 w-24 rounded-md object-cover"
          />
          <div className="flex flex-1 flex-col gap-1">
            <span className="text-sm font-semibold">Photo added</span>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="lg" className="h-11" onClick={() => inputRef.current?.click()}>
                <Camera aria-hidden />
                Retake
              </Button>
              <Button type="button" variant="ghost" size="lg" className="h-11" onClick={() => onChange(null)} aria-label="Remove photo">
                <Trash2 aria-hidden />
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="flex min-h-24 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-info bg-accent px-4 py-3 text-center focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-60"
        >
          <Camera className="size-6 text-foreground" aria-hidden />
          <span className="text-sm font-bold">{busy ? "Preparing photo…" : label}</span>
          {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
        </button>
      )}
      {error && (
        <p className="text-xs font-medium text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
