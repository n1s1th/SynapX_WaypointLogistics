"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { format, parseISO } from "date-fns";
import { CircleAlert, Download, Plus, Search, Upload } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableRow } from "@/components/ui/table";
import { StoreTableCell, StoreTableHeader } from "@/components/store/store-table";
import { downloadCsv } from "@/components/store/csv";
import { useStoreOutlet } from "@/components/store/outlet-context";
import { ApiError } from "@/components/store/api/client";
import { importStoreStock } from "@/components/store/api/store-data";
import type { CatalogueItem, StoreStock } from "@/components/store/mock-data";

type ImportResult = Awaited<ReturnType<typeof importStoreStock>>;

export function StoreStockView({ stock, catalogue }: { stock: StoreStock; catalogue: CatalogueItem[] }) {
  const router = useRouter();
  const outlet = useStoreOutlet();
  const fileRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState<{ message: string; skipped: ImportResult["skipped"] } | null>(null);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return stock.items.filter(
      (item) =>
        !query || item.sku.toLowerCase().includes(query) || (item.itemName ?? "").toLowerCase().includes(query)
    );
  }, [stock.items, search]);

  // Every item the store can order, with today's counts filled in, so the template is ready to edit.
  const downloadTemplate = () => {
    const counted = Object.fromEntries(stock.items.map((item) => [item.sku, item.quantityOnHand]));
    downloadCsv(
      `stock-count-${outlet?.code ?? "outlet"}.csv`,
      ["sku", "name", "quantity_on_hand"],
      catalogue.map((item) => [item.sku, item.itemName, counted[item.sku] ?? ""])
    );
  };

  const importFile = async (file: File) => {
    setImporting(true);
    setResult(null);
    setImportError(null);
    try {
      const imported = await importStoreStock(file);
      setResult(imported);
      toast.success(`Stock updated: ${imported.imported} ${imported.imported === 1 ? "item" : "items"}.`);
      router.refresh();
    } catch (error) {
      const skipped =
        error instanceof ApiError && Array.isArray(error.details.skipped)
          ? (error.details.skipped as ImportResult["skipped"])
          : [];
      setImportError({
        message: error instanceof Error ? error.message : "The stock list couldn't be imported.",
        skipped,
      });
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const skippedRows = result?.skipped ?? importError?.skipped ?? [];

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex min-w-0 flex-col gap-2">
          <h1 className="text-xl font-semibold text-primary md:text-3xl md:font-bold">Store Stock</h1>
          <p className="text-sm text-muted-foreground">
            {stock.importedAt
              ? `What's on your shelves, from the count imported ${format(parseISO(stock.importedAt), "d MMM yyyy, HH:mm")}. New Request shows these numbers when you add items.`
              : "Import a stock count to see what's on your shelves while you order."}
          </p>
        </div>
        <div className="flex shrink-0 flex-col gap-3 md:flex-row md:gap-4">
          <Button
            variant="outline"
            onClick={downloadTemplate}
            disabled={catalogue.length === 0}
            className="h-11 border-2 border-primary px-4 text-base font-bold md:h-10"
          >
            <Download aria-hidden="true" />
            Download template
          </Button>
          <input
            ref={fileRef}
            id="stock-file"
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importFile(file);
            }}
          />
          <Button
            onClick={() => fileRef.current?.click()}
            disabled={importing}
            className="h-11 px-4 text-base font-bold md:h-10"
          >
            <Upload aria-hidden="true" />
            {importing ? "Importing…" : "Import CSV"}
          </Button>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        The CSV needs a <code className="font-mono">sku</code> column and a{" "}
        <code className="font-mono">quantity_on_hand</code> column. Each import replaces the whole list.
      </p>

      {importError && (
        <Alert variant="destructive" role="alert">
          <CircleAlert aria-hidden="true" />
          <AlertTitle className="font-bold">Import failed</AlertTitle>
          <AlertDescription>{importError.message}</AlertDescription>
        </Alert>
      )}
      {skippedRows.length > 0 && (
        <Alert className="border-warning/30 bg-warning-muted" role="status">
          <CircleAlert className="text-warning" aria-hidden="true" />
          <AlertTitle className="font-bold text-warning-muted-foreground">
            {skippedRows.length} {skippedRows.length === 1 ? "row was" : "rows were"} skipped
          </AlertTitle>
          <AlertDescription className="text-foreground/80">
            <ul className="flex flex-col gap-1">
              {skippedRows.slice(0, 8).map((row, index) => (
                <li key={`${row.line}-${row.sku}-${index}`}>
                  {row.line ? `Line ${row.line}` : "—"}
                  {row.sku ? ` · ${row.sku}` : ""}: {row.reason}
                </li>
              ))}
              {skippedRows.length > 8 && <li>…and {skippedRows.length - 8} more.</li>}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <Card className="gap-4 rounded-lg p-4 ring-border md:p-6">
        <div className="relative md:w-80">
          <Label htmlFor="stock-search" className="sr-only">
            Search item or SKU
          </Label>
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            id="stock-search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search item or SKU"
            className="h-11 bg-card pl-10"
          />
        </div>

        {stock.items.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No stock count yet. Download the template, fill in your counts and import it.
          </p>
        ) : visible.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No items match your search.</p>
        ) : (
          <>
            <Table className="hidden md:table">
              <StoreTableHeader columns={[{ label: "Item" }, { label: "SKU" }, { label: "On hand" }]} />
              <TableBody>
                {visible.map((item) => (
                  <TableRow key={item.sku} className="hover:bg-transparent">
                    <StoreTableCell className="whitespace-normal">
                      <span className="block font-medium">{item.itemName ?? "No longer in your catalogue"}</span>
                      {item.packLabel && <span className="mt-2 block text-muted-foreground">{item.packLabel}</span>}
                    </StoreTableCell>
                    <StoreTableCell>{item.sku}</StoreTableCell>
                    <StoreTableCell className="font-bold">{item.quantityOnHand}</StoreTableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <ul className="flex flex-col divide-y divide-border md:hidden">
              {visible.map((item) => (
                <li key={item.sku} className="flex items-center justify-between gap-3 py-3 text-sm">
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="font-medium text-foreground">{item.itemName ?? item.sku}</span>
                    <span className="text-muted-foreground">
                      {item.sku}
                      {item.packLabel ? ` · ${item.packLabel}` : ""}
                    </span>
                  </span>
                  <span className="shrink-0 text-base font-bold">{item.quantityOnHand}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      <Button asChild variant="outline" className="h-11 w-fit border-2 border-primary px-4 text-base font-bold md:h-10">
        <Link href="/store/requests/new">
          <Plus aria-hidden="true" />
          New Goods Request
        </Link>
      </Button>
    </div>
  );
}
