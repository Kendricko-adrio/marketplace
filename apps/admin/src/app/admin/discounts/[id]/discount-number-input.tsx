"use client";

import { useId, useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { displayNumberInput, numberTypingBuffer } from "./discount-number-format";
import type { NumberInputKind } from "./discount-number-format";

export type { NumberInputKind };

/**
 * Angka bersatuan di atas Input shared. Prefix **Rp** / suffix **%** selalu
 * terlihat dan bukan bagian nilai. Buffer state selalu angka polos (separator
 * grouping dibuang sebelum disimpan), sehingga grouping dihitung ulang di setiap
 * render dan tidak pernah ikut menjadi bagian nilai. Buffer yang belum lengkap
 * (mis. `100.000,`) dipertahankan apa adanya sampai pengguna selesai; hanya saat
 * blur nilai canonical diformat penuh (`Rp 100.000,00`). Parsing/canonicalisasi
 * tetap milik `discount-number-format.ts`.
 */
export function DiscountNumberInput(props: {
  id?: string;
  label: string;
  kind: NumberInputKind;
  value: string;
  onValueChange: (next: string) => void;
  disabled?: boolean;
  placeholder?: string;
  hint?: string;
  error?: string | null;
  optional?: boolean;
}) {
  const generatedId = useId();
  const id = props.id ?? generatedId;
  const hintId = props.hint ? `${id}-hint` : undefined;
  const errorId = props.error ? `${id}-error` : undefined;
  const [focused, setFocused] = useState(false);
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className="min-w-0 space-y-2">
      <Label htmlFor={id}>
        {props.label}
        {props.optional ? (
          <span className="ml-1 font-normal text-muted-foreground">(opsional)</span>
        ) : null}
      </Label>
      <div className="relative">
        {props.kind === "money" ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground"
          >
            Rp
          </span>
        ) : null}
        <Input
          id={id}
          inputMode={props.kind === "money" ? "numeric" : "decimal"}
          autoComplete="off"
          spellCheck={false}
          className={props.kind === "money" ? "pl-10" : "pr-8"}
          value={displayNumberInput(props.value, props.kind, focused)}
          disabled={props.disabled}
          placeholder={props.placeholder}
          aria-describedby={describedBy}
          aria-invalid={props.error ? true : undefined}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            const next = displayNumberInput(props.value, props.kind, false);
            setFocused(false);
            if (next !== props.value) props.onValueChange(next);
          }}
          onChange={(event) =>
            props.onValueChange(
              numberTypingBuffer(props.value, event.target.value, props.kind)
            )
          }
        />
        {props.kind === "percent" ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground"
          >
            %
          </span>
        ) : null}
      </div>
      {props.hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {props.hint}
        </p>
      ) : null}
      {props.error ? (
        <p id={errorId} className="text-xs text-destructive">
          {props.error}
        </p>
      ) : null}
    </div>
  );
}
