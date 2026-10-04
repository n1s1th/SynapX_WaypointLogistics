"use client";

/**
 * One optional photo for a driver report or SOS. Opens the camera on a phone
 * and a file picker on a laptop. Only picks the photo: the page uploads it
 * when the form is sent, so an offline report can keep the file for later.
 */
import { useEffect, useRef } from "react";
import { Camera, RefreshCw, X } from "lucide-react";

export interface PhotoDraft {
  file: File;
  preview: string;
}

const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

interface PhotoAttachProps {
  photo: PhotoDraft | null;
  onChange: (photo: PhotoDraft | null) => void;
  title?: string;
  hint?: string;
  onError?: (message: string | null) => void;
}

export default function PhotoAttach({ photo, onChange, title = "Add photo", hint, onError }: PhotoAttachProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  // Free the preview when the photo is replaced, removed or the page closes.
  useEffect(() => {
    if (!photo) return;
    return () => URL.revokeObjectURL(photo.preview);
  }, [photo]);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > MAX_PHOTO_BYTES) {
      onError?.("Photo must be under 10 MB.");
      return;
    }
    onError?.(null);
    onChange({ file, preview: URL.createObjectURL(file) });
  }

  return (
    <div className="flex flex-col w-full">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleFile}
      />

      {photo ? (
        <div className="flex items-center p-2 gap-3 bg-white rounded-md" style={{ border: "1px solid #E5E5E2" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photo.preview} alt="Attached photo" className="w-16 h-16 rounded object-cover shrink-0" />
          <div className="flex flex-col gap-0.5 flex-1 min-w-0">
            <span className="font-semibold text-[12px]" style={{ color: "#171A1F" }}>Photo attached</span>
            <span className="text-[10px] truncate" style={{ color: "#6B7280" }}>{photo.file.name}</span>
          </div>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            aria-label="Change photo"
            className="flex items-center justify-center w-11 h-11 rounded-md shrink-0"
            style={{ backgroundColor: "#F2F5F8" }}
          >
            <RefreshCw size={16} color="#171A1F" />
          </button>
          <button
            type="button"
            onClick={() => onChange(null)}
            aria-label="Remove photo"
            className="flex items-center justify-center w-11 h-11 rounded-md shrink-0"
            style={{ backgroundColor: "#FBEFEF" }}
          >
            <X size={16} color="#AD3D3D" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex items-center w-full min-h-[44px] p-3 gap-2.5 bg-white rounded-md text-left"
          style={{ border: "1px dashed #AEBCCF" }}
        >
          <Camera size={18} color="#171A1F" className="shrink-0" />
          <span className="flex flex-col gap-0.5">
            <span className="font-semibold text-[12px]" style={{ color: "#171A1F" }}>{title}</span>
            {hint && <span className="text-[10px]" style={{ color: "#6B7280" }}>{hint}</span>}
          </span>
        </button>
      )}
    </div>
  );
}
