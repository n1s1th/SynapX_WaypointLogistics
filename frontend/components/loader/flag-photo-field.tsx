"use client";

import * as React from "react";
import { Camera, X } from "lucide-react";
import { PHOTO_MAX_BYTES, PHOTO_TYPES, shrinkPhoto } from "@/lib/loader/photo";
import { LoaderButton } from "./loader-button";

interface FlagPhotoFieldProps {
  value: Blob | null;
  onChange: (photo: Blob | null) => void;
}

/**
 * "Photo (optional)" on the flag sheet: take or choose one photo, shrunk on
 * the tablet before it is queued. The flag never waits on it.
 */
export function FlagPhotoField({ value, onChange }: FlagPhotoFieldProps) {
  const input = React.useRef<HTMLInputElement>(null);
  const [error, setError] = React.useState<string>();
  const [busy, setBusy] = React.useState(false);
  const preview = React.useMemo(() => (value ? URL.createObjectURL(value) : undefined), [value]);
  React.useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError(undefined);
    setBusy(true);
    const photo = await shrinkPhoto(file);
    setBusy(false);
    if (!PHOTO_TYPES.includes(photo.type)) return setError("Use a JPEG, PNG or WebP photo.");
    if (photo.size > PHOTO_MAX_BYTES) return setError("That photo is over 5 MB. Take it again.");
    onChange(photo);
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-foreground">Photo (optional)</span>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        className="sr-only"
        aria-label="Take or choose a photo"
        onChange={(e) => {
          void pick(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {preview ? (
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- a local blob preview */}
          <img src={preview} alt="Photo for this flag" className="size-20 rounded-lg border border-border object-cover" />
          <LoaderButton variant="secondary" onClick={() => input.current?.click()}>
            <Camera aria-hidden /> Retake
          </LoaderButton>
          <LoaderButton variant="ghost" onClick={() => onChange(null)} aria-label="Remove the photo">
            <X aria-hidden />
          </LoaderButton>
        </div>
      ) : (
        <LoaderButton variant="secondary" className="self-start" disabled={busy} onClick={() => input.current?.click()}>
          <Camera aria-hidden /> {busy ? "Preparing photo…" : "Add photo"}
        </LoaderButton>
      )}
      {error && (
        <p role="alert" className="text-xs leading-[17px] text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
