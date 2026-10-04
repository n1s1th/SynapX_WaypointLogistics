"use client";

import React, { useState, useEffect, useMemo } from "react";
import { type InventoryItem, type ChainCargoSummary } from "@/types/order";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  UploadCloud,
  Download,
  Search,
  RefreshCw,
  Layers,
  Weight,
  Box,
  Snowflake,
  Sun,
} from "lucide-react";
import { fetchWithFallback } from "@/lib/api";
import { toast } from "sonner";
import { StockCsvImportModal } from "./StockCsvImportModal";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5001";

export function StocksView() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [summary, setSummary] = useState<ChainCargoSummary[]>([]);
  const [selectedChain, setSelectedChain] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [tempFilter, setTempFilter] = useState<string>("all");
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [refreshCount, setRefreshCount] = useState<number>(0);
  const [isImportModalOpen, setIsImportModalOpen] = useState<boolean>(false);

  // Fetch items and summaries
  useEffect(() => {
    let ignore = false;

    async function loadCatalogData() {
      setIsLoading(true);
      try {
        // Fetch summary
        const summaryRes = await fetchWithFallback("/api/v1/inventory/summary");
        if (summaryRes.ok && !ignore) {
          const sData = await summaryRes.json();
          setSummary(sData.chains || []);
        }

        // Fetch items
        const queryParams = new URLSearchParams();
        if (selectedChain !== "all") queryParams.append("chain", selectedChain);
        if (tempFilter !== "all") queryParams.append("temp_requirement", tempFilter);
        if (searchQuery.trim()) queryParams.append("search", searchQuery.trim());

        const itemsRes = await fetchWithFallback(`/api/v1/inventory/items?${queryParams.toString()}`);
        if (itemsRes.ok && !ignore) {
          const iData: InventoryItem[] = await itemsRes.json();
          setItems(iData);
        }
      } catch (err) {
        console.error("Failed to load chain cargo catalog:", err);
        toast.error("Failed to load chain cargo specifications");
      } finally {
        if (!ignore) setIsLoading(false);
      }
    }

    loadCatalogData();

    return () => {
      ignore = true;
    };
  }, [selectedChain, tempFilter, searchQuery, refreshCount]);

  // Aggregate current metrics
  const activeMetrics = useMemo(() => {
    if (selectedChain === "all") {
      const totalSkus = summary.reduce((acc, c) => acc + c.total_skus, 0);
      const chilledSkus = summary.reduce((acc, c) => acc + c.chilled_skus, 0);
      const ambientSkus = summary.reduce((acc, c) => acc + c.ambient_skus, 0);
      const totalWeightSum = summary.reduce((acc, c) => acc + c.avg_weight_kg * c.total_skus, 0);
      const totalVolSum = summary.reduce((acc, c) => acc + c.avg_volume_m3 * c.total_skus, 0);
      return {
        totalSkus,
        chilledSkus,
        ambientSkus,
        avgWeight: totalSkus > 0 ? (totalWeightSum / totalSkus).toFixed(2) : "0.00",
        avgVolume: totalSkus > 0 ? (totalVolSum / totalSkus).toFixed(3) : "0.000",
      };
    }
    const current = summary.find((c) => c.chain.toLowerCase() === selectedChain.toLowerCase());
    return {
      totalSkus: current?.total_skus || 0,
      chilledSkus: current?.chilled_skus || 0,
      ambientSkus: current?.ambient_skus || 0,
      avgWeight: current?.avg_weight_kg?.toFixed(2) || "0.00",
      avgVolume: current?.avg_volume_m3?.toFixed(3) || "0.000",
    };
  }, [summary, selectedChain]);

  // Export CSV handler
  const handleExportCsv = () => {
    const chainParam = selectedChain !== "all" ? `?chain=${encodeURIComponent(selectedChain)}` : "";
    window.open(`${API_BASE}/api/v1/inventory/export-csv${chainParam}`, "_blank");
    toast.success(`Exporting cargo specifications for ${selectedChain === "all" ? "all chains" : selectedChain}...`);
  };

  return (
    <div className="space-y-6">
      {/* ── Subheader & Chain Selector ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        {/* Chain Navigation Tabs */}
        <div className="flex items-center gap-1.5 p-1 rounded-xl bg-slate-100 border border-slate-200/80 w-fit">
          <button
            onClick={() => setSelectedChain("all")}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              selectedChain === "all"
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            All Chains
          </button>
          <button
            onClick={() => setSelectedChain("Fresh")}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
              selectedChain === "Fresh"
                ? "bg-emerald-600 text-white shadow-sm"
                : "text-slate-600 hover:text-emerald-700"
            }`}
          >
            <span className="size-2 rounded-full bg-emerald-300" />
            Fresh Chain
          </button>
          <button
            onClick={() => setSelectedChain("Style")}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
              selectedChain === "Style"
                ? "bg-indigo-600 text-white shadow-sm"
                : "text-slate-600 hover:text-indigo-700"
            }`}
          >
            <span className="size-2 rounded-full bg-indigo-300" />
            Style Chain
          </button>
          <button
            onClick={() => setSelectedChain("Tech")}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
              selectedChain === "Tech"
                ? "bg-blue-600 text-white shadow-sm"
                : "text-slate-600 hover:text-blue-700"
            }`}
          >
            <span className="size-2 rounded-full bg-blue-300" />
            Tech Chain
          </button>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2.5">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setRefreshCount((c) => c + 1)}
            disabled={isLoading}
            className="h-9 text-xs border-slate-200 text-slate-700 hover:bg-slate-50 gap-1.5"
          >
            <RefreshCw className={`size-3.5 ${isLoading ? "animate-spin" : ""}`} />
            Refresh
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={handleExportCsv}
            className="h-9 text-xs border-slate-200 text-slate-700 hover:bg-slate-50 gap-1.5"
          >
            <Download className="size-3.5 text-[#18385F]" />
            Export Specs CSV
          </Button>

          <Button
            size="sm"
            onClick={() => setIsImportModalOpen(true)}
            className="h-9 text-xs bg-[#18385F] hover:bg-[#122b49] text-white font-semibold gap-1.5 shadow-sm"
          >
            <UploadCloud className="size-3.5" />
            Import Chain CSV
          </Button>
        </div>
      </div>

      {/* ── Logistics Cargo Metric Cards ── */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3.5">
        <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-xs">
          <div className="flex items-center gap-2 text-slate-500 text-xs font-medium mb-1">
            <Layers className="size-4 text-[#18385F]" />
            <span>Total SKUs</span>
          </div>
          <div className="text-2xl font-bold text-slate-900">{activeMetrics.totalSkus}</div>
          <p className="text-[11px] text-slate-400 mt-0.5">Catalogued products</p>
        </div>

        <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-xs">
          <div className="flex items-center gap-2 text-cyan-700 text-xs font-medium mb-1">
            <Snowflake className="size-4 text-cyan-600" />
            <span>Chilled Items</span>
          </div>
          <div className="text-2xl font-bold text-cyan-800">{activeMetrics.chilledSkus}</div>
          <p className="text-[11px] text-slate-400 mt-0.5">Reefer transport required</p>
        </div>

        <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-xs">
          <div className="flex items-center gap-2 text-slate-600 text-xs font-medium mb-1">
            <Sun className="size-4 text-amber-500" />
            <span>Ambient Items</span>
          </div>
          <div className="text-2xl font-bold text-slate-900">{activeMetrics.ambientSkus}</div>
          <p className="text-[11px] text-slate-400 mt-0.5">Standard transport</p>
        </div>

        <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-xs">
          <div className="flex items-center gap-2 text-indigo-600 text-xs font-medium mb-1">
            <Weight className="size-4" />
            <span>Avg Unit Weight</span>
          </div>
          <div className="text-2xl font-bold text-slate-900">
            {activeMetrics.avgWeight} <span className="text-sm font-semibold text-slate-500">kg</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-0.5">Payload per unit</p>
        </div>

        <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-xs">
          <div className="flex items-center gap-2 text-blue-600 text-xs font-medium mb-1">
            <Box className="size-4" />
            <span>Avg Unit Volume</span>
          </div>
          <div className="text-2xl font-bold text-slate-900">
            {activeMetrics.avgVolume} <span className="text-sm font-semibold text-slate-500">m³</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-0.5">Cubage per unit</p>
        </div>
      </div>

      {/* ── Search & Filter Controls ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center gap-3 flex-1 min-w-[260px]">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-slate-400" />
            <Input
              placeholder="Search by SKU, product name, or depot..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-9 text-xs border-slate-200"
            />
          </div>

          <div className="flex items-center gap-1 bg-slate-50 p-1 rounded-lg border border-slate-200">
            <button
              onClick={() => setTempFilter("all")}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                tempFilter === "all" ? "bg-white font-semibold text-slate-900 shadow-xs" : "text-slate-600"
              }`}
            >
              All Temps
            </button>
            <button
              onClick={() => setTempFilter("Chilled")}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors flex items-center gap-1 ${
                tempFilter === "Chilled" ? "bg-cyan-50 font-semibold text-cyan-800 border border-cyan-200 shadow-xs" : "text-slate-600"
              }`}
            >
              <Snowflake className="size-3 text-cyan-600" />
              Chilled
            </button>
            <button
              onClick={() => setTempFilter("Ambient")}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors flex items-center gap-1 ${
                tempFilter === "Ambient" ? "bg-amber-50 font-semibold text-amber-800 border border-amber-200 shadow-xs" : "text-slate-600"
              }`}
            >
              <Sun className="size-3 text-amber-600" />
              Ambient
            </button>
          </div>
        </div>

        <div className="text-xs text-slate-500 font-medium">
          Showing <span className="font-bold text-slate-900">{items.length}</span> catalogued products
        </div>
      </div>

      {/* ── Main Cargo Specifications Table ── */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
              <tr>
                <th className="py-3 px-4">SKU</th>
                <th className="py-3 px-4">Product Name</th>
                <th className="py-3 px-4">Chain</th>
                <th className="py-3 px-4">Temp Requirement</th>
                <th className="py-3 px-4 text-right">Unit Weight</th>
                <th className="py-3 px-4 text-right">Unit Volume</th>
                <th className="py-3 px-4">Origin Depot</th>
                <th className="py-3 px-4 text-right">Last Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    <RefreshCw className="size-6 animate-spin mx-auto mb-2 text-slate-300" />
                    Loading product specifications...
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    No product specifications match the selected filters.
                  </td>
                </tr>
              ) : (
                items.map((item) => {
                  const isChilled = item.temp_requirement?.toLowerCase() === "chilled";

                  let chainColor = "bg-slate-100 text-slate-700 border-slate-200";
                  if (item.chain?.toLowerCase() === "fresh") chainColor = "bg-emerald-50 text-emerald-800 border-emerald-200";
                  else if (item.chain?.toLowerCase() === "style") chainColor = "bg-indigo-50 text-indigo-800 border-indigo-200";
                  else if (item.chain?.toLowerCase() === "tech") chainColor = "bg-blue-50 text-blue-800 border-blue-200";

                  return (
                    <tr key={item.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3 px-4 font-mono font-bold text-slate-900">{item.sku}</td>
                      <td className="py-3 px-4 font-medium text-slate-900 max-w-[280px] truncate">
                        {item.name}
                      </td>
                      <td className="py-3 px-4">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold border ${chainColor}`}>
                          {item.chain || "General"}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <Badge
                          variant="outline"
                          className={`text-[10px] font-semibold flex items-center gap-1 w-fit ${
                            isChilled
                              ? "bg-cyan-50 text-cyan-800 border-cyan-200"
                              : "bg-slate-50 text-slate-700 border-slate-200"
                          }`}
                        >
                          {isChilled ? <Snowflake className="size-3 text-cyan-600" /> : <Sun className="size-3 text-amber-500" />}
                          {item.temp_requirement}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 text-right font-semibold text-slate-900">
                        {item.unit_weight_kg.toFixed(2)} kg
                      </td>
                      <td className="py-3 px-4 text-right font-medium text-slate-700">
                        {item.unit_volume_m3.toFixed(3)} m³
                      </td>
                      <td className="py-3 px-4 text-slate-600 truncate max-w-[160px]">
                        {item.depot_name || "Peliyagoda Central"}
                      </td>
                      <td className="py-3 px-4 text-right text-slate-400 font-mono text-[11px]">
                        {item.updated_at ? new Date(item.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "—"}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* CSV Import Modal */}
      <StockCsvImportModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        onSuccess={() => setRefreshCount((c) => c + 1)}
        defaultChain={selectedChain !== "all" ? selectedChain : "Fresh"}
      />
    </div>
  );
}
