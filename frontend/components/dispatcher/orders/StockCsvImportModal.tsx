"use client";

import React, { useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { UploadCloud, FileText, CheckCircle2, AlertTriangle, X, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { fetchWithFallback } from "@/lib/api";

interface StockCsvImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  defaultChain?: string;
}

export function StockCsvImportModal({
  isOpen,
  onClose,
  onSuccess,
  defaultChain = "Fresh",
}: StockCsvImportModalProps) {
  const [selectedChain, setSelectedChain] = useState<string>(defaultChain);
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [previewRows, setPreviewRows] = useState<string[][]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;

    if (!selected.name.endsWith(".csv")) {
      toast.error("Please upload a valid .csv file");
      return;
    }

    setFile(selected);

    // Auto-detect chain from filename
    const lowerName = selected.name.toLowerCase();
    if (lowerName.includes("fresh")) setSelectedChain("Fresh");
    else if (lowerName.includes("style")) setSelectedChain("Style");
    else if (lowerName.includes("tech")) setSelectedChain("Tech");

    // Parse quick preview
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (!text) return;
      const lines = text.split("\n").filter((l) => l.trim().length > 0);
      if (lines.length > 0) {
        const headerCols = lines[0].split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
        setHeaders(headerCols);
        const preview = lines.slice(1, 4).map((l) => l.split(",").map((c) => c.trim().replace(/^"|"$/g, "")));
        setPreviewRows(preview);
      }
    };
    reader.readAsText(selected);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile && droppedFile.name.endsWith(".csv")) {
      const fakeEvent = { target: { files: [droppedFile] } } as unknown as React.ChangeEvent<HTMLInputElement>;
      handleFileChange(fakeEvent);
    } else {
      toast.error("Please drop a valid .csv file");
    }
  };

  const handleUpload = async () => {
    if (!file) {
      toast.error("Please select a CSV file to upload");
      return;
    }

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetchWithFallback(`/api/v1/inventory/upload-csv?chain=${encodeURIComponent(selectedChain)}`, {
        method: "POST",
        body: formData,
      });

      if (res.ok) {
        const data = await res.json();
        toast.success(data.message || `Stock CSV imported successfully for ${selectedChain}!`);
        onSuccess();
        onClose();
        setFile(null);
        setPreviewRows([]);
      } else {
        const err = await res.json();
        toast.error(err.detail || "Failed to upload stock CSV");
      }
    } catch {
      toast.error("Network error while uploading stock CSV");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent showCloseButton={false} className="sm:max-w-[560px] p-6 bg-white rounded-2xl border border-slate-200 shadow-2xl">
        <DialogHeader className="flex flex-row items-start justify-between pb-3 border-b border-slate-100">
          <div>
            <DialogTitle className="text-xl font-bold text-slate-900 flex items-center gap-2">
              <UploadCloud className="size-5 text-[#18385F]" />
              Import Chain Cargo Specifications CSV
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500 mt-1">
              Upload daily product handling specifications for Fresh, Style, or Tech retail chains.
            </DialogDescription>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="size-5" />
          </button>
        </DialogHeader>

        <div className="space-y-4 py-3">
          {/* Target Chain Selection */}
          <div>
            <label className="text-xs font-semibold text-slate-700 block mb-1.5">
              Select Target Chain
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { name: "Fresh", color: "border-emerald-500 text-emerald-800 bg-emerald-50/60" },
                { name: "Style", color: "border-indigo-500 text-indigo-800 bg-indigo-50/60" },
                { name: "Tech", color: "border-blue-500 text-blue-800 bg-blue-50/60" },
              ].map((c) => (
                <button
                  key={c.name}
                  type="button"
                  onClick={() => setSelectedChain(c.name)}
                  className={`py-2 px-3 rounded-lg border text-xs font-semibold text-center transition-all ${
                    selectedChain === c.name
                      ? `${c.color} ring-2 ring-offset-1 ring-slate-400`
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {c.name}
                </button>
              ))}
            </div>
          </div>

          {/* File Dropzone */}
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
              file ? "border-emerald-400 bg-emerald-50/20" : "border-slate-300 hover:border-[#18385F] bg-slate-50/50"
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={handleFileChange}
            />
            {file ? (
              <div className="flex flex-col items-center">
                <FileText className="size-8 text-emerald-600 mb-2" />
                <span className="text-sm font-bold text-slate-900">{file.name}</span>
                <span className="text-xs text-slate-500 mt-0.5">
                  {(file.size / 1024).toFixed(1)} KB · Ready to import
                </span>
                <span className="text-[11px] text-emerald-700 font-semibold mt-2 inline-flex items-center gap-1">
                  <CheckCircle2 className="size-3.5" /> File parsed
                </span>
              </div>
            ) : (
              <div className="flex flex-col items-center">
                <UploadCloud className="size-8 text-slate-400 mb-2" />
                <span className="text-sm font-semibold text-slate-700">Click to upload or drag & drop</span>
                <span className="text-xs text-slate-400 mt-1">
                  Supports UTF-8 CSV with columns: sku, name, unit_weight_kg, unit_volume_m3, temp_requirement, depot_name
                </span>
              </div>
            )}
          </div>

          {/* CSV Preview */}
          {headers.length > 0 && previewRows.length > 0 && (
            <div className="rounded-lg border border-slate-200 overflow-hidden bg-slate-50/50">
              <div className="px-3 py-1.5 bg-slate-100 text-[11px] font-bold text-slate-600 flex items-center justify-between">
                <span>File Preview (First {previewRows.length} rows)</span>
                <span>{headers.length} columns detected</span>
              </div>
              <div className="max-h-28 overflow-x-auto text-[11px] p-2 space-y-1 font-mono">
                {previewRows.map((row, i) => (
                  <div key={i} className="truncate text-slate-700">
                    {row.slice(0, 5).join(" | ")}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Quick Notice */}
          <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-50/70 border border-amber-200/80 text-[11px] text-amber-800">
            <AlertTriangle className="size-4 shrink-0 mt-0.5 text-amber-600" />
            <span>
              Rows matching existing SKUs will update physical handling metrics (unit weight, unit volume, temp class). New SKUs will be added to the {selectedChain} catalog automatically.
            </span>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between pt-3 border-t border-slate-100">
          <Button variant="outline" size="sm" onClick={onClose} disabled={isUploading} className="text-xs">
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleUpload}
            disabled={!file || isUploading}
            className="bg-[#18385F] hover:bg-[#122b49] text-white text-xs font-semibold px-5 gap-1.5"
          >
            {isUploading ? (
              <>
                <RefreshCw className="size-3.5 animate-spin" />
                Importing...
              </>
            ) : (
              "Confirm & Import"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
