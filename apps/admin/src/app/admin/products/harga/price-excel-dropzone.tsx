"use client";

import { useRef, useState, type DragEvent } from "react";
import { FileSpreadsheet, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export interface PriceExcelDropzoneProps {
  id: string;
  name: string;
  testId: string;
  file: File | null;
  onFileChange: (file: File | null) => void;
  disabled?: boolean;
  compact?: boolean;
  describedBy?: string;
  label?: string;
}

/**
 * Dropzone file `.xlsx` accessible untuk unggah harga Excel dan file koreksi.
 * Membungkus `<input type="file" className="sr-only" />` agar tetap kompatibel
 * dengan keyboard, screen reader, dan automation.
 */
export function PriceExcelDropzone({
  id,
  name,
  testId,
  file,
  onFileChange,
  disabled = false,
  compact = false,
  describedBy,
  label = "Pilih file Excel (.xlsx)",
}: PriceExcelDropzoneProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);

  function pickFile(next: File | null) {
    onFileChange(next);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (disabled) return;
    const dropped = event.dataTransfer.files?.[0] ?? null;
    if (dropped) {
      if (inputRef.current) {
        const transfer = new DataTransfer();
        transfer.items.add(dropped);
        inputRef.current.files = transfer.files;
      }
      pickFile(dropped);
    }
  }

  function clearFile() {
    if (inputRef.current) inputRef.current.value = "";
    pickFile(null);
  }

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      className={cn(
        "relative rounded-lg border-2 border-dashed transition-colors",
        dragging
          ? "border-primary bg-primary/5"
          : "border-input bg-muted/20 hover:bg-muted/30",
        compact ? "p-3" : "p-6",
        disabled && "pointer-events-none opacity-60",
      )}
    >
      <input
        ref={inputRef}
        id={id}
        name={name}
        data-testid={testId}
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        aria-label={label}
        aria-describedby={describedBy}
        disabled={disabled}
        onChange={(event) => pickFile(event.target.files?.[0] ?? null)}
        className="sr-only"
      />

      {file ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <FileSpreadsheet className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">
                {file.name}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatBytes(file.size)}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() => inputRef.current?.click()}
            >
              Ganti file
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Hapus file terpilih"
              disabled={disabled}
              onClick={clearFile}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      ) : (
        <label
          htmlFor={id}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center text-center",
            compact ? "gap-1.5" : "gap-2",
          )}
        >
          <div
            className={cn(
              "flex items-center justify-center rounded-full bg-muted text-muted-foreground",
              compact ? "h-8 w-8" : "h-10 w-10",
            )}
          >
            <Upload className={compact ? "h-4 w-4" : "h-5 w-5"} aria-hidden="true" />
          </div>
          <div className="space-y-0.5">
            <p className="text-sm font-medium text-foreground">
              Tarik file .xlsx ke sini, atau{" "}
              <span className="text-primary underline underline-offset-4">
                pilih file
              </span>
            </p>
            {!compact && (
              <p className="text-xs text-muted-foreground">
                Format .xlsx · Maks 1.000 baris · Harga belum berubah sebelum diterapkan
              </p>
            )}
          </div>
        </label>
      )}
    </div>
  );
}
