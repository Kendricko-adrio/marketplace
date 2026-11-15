"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

type Kind = "public" | "manual_only";

/**
 * Dialog **Buat diskon**: jenis promo adalah keputusan eksplisit di sini, bukan
 * pilihan diam-diam dari filter daftar atau tab. Request create baru dikirim
 * setelah pilihan valid, dengan request key stabil agar retry tidak
 * menggandakan Offer.
 */
export function DiscountCreateDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (offerId: string) => void;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<Kind | "">("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const requestKey = useRef<string | null>(null);

  function reset(): void {
    setKind("");
    setError(null);
    setBusy(false);
    requestKey.current = null;
  }

  async function submit(): Promise<void> {
    if (busy) return;
    if (!kind) {
      setError("Pilih jenis promo");
      return;
    }
    setBusy(true);
    setError(null);
    requestKey.current ??= crypto.randomUUID();
    try {
      const response = await fetch("/api/admin/discounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestKey: requestKey.current, activationKind: kind }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        success?: boolean;
        data?: { id: string };
        error?: string;
      };
      if (!response.ok || !body.success || !body.data) {
        throw new Error(body.error ?? "Gagal membuat draft. Coba lagi.");
      }
      toast.success("Draft diskon dibuat");
      props.onCreated(body.data.id);
      router.push(`/admin/discounts/${body.data.id}`);
    } catch (caught) {
      // Pilihan tetap tersimpan di dialog supaya pengguna dapat mencoba lagi.
      setError(caught instanceof Error ? caught.message : "Gagal membuat draft. Coba lagi.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (busy) return;
        if (!open) reset();
        props.onOpenChange(open);
      }}
    >
      <DialogContent className="w-[calc(100%-2rem)] max-w-md">
        <DialogHeader>
          <DialogTitle>Buat diskon</DialogTitle>
          <DialogDescription>
            Pilih jenis promo. Jenis tidak dapat diubah setelah draft dibuat.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">Jenis promo*</legend>
            <RadioGroup
              value={kind}
              onValueChange={(value) => {
                setKind(value as Kind);
                setError(null);
              }}
              aria-describedby={error ? "create-kind-error" : undefined}
            >
              <div className="flex items-start gap-3 rounded-md border p-3">
                <RadioGroupItem value="public" id="create-kind-public" className="mt-1" />
                <Label htmlFor="create-kind-public" className="space-y-1 font-normal">
                  <span className="block font-medium">Kupon publik</span>
                  <span className="block text-xs text-muted-foreground">
                    Dipilih customer saat checkout.
                  </span>
                </Label>
              </div>
              <div className="flex items-start gap-3 rounded-md border p-3">
                <RadioGroupItem value="manual_only" id="create-kind-manual" className="mt-1" />
                <Label htmlFor="create-kind-manual" className="space-y-1 font-normal">
                  <span className="block font-medium">Kode promo</span>
                  <span className="block text-xs text-muted-foreground">
                    Dimasukkan customer saat checkout.
                  </span>
                </Label>
              </div>
            </RadioGroup>
            {error ? (
              <p id="create-kind-error" role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </fieldset>

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => {
                reset();
                props.onOpenChange(false);
              }}
            >
              Batal
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Lanjut
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
