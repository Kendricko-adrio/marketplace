"use client";

import { useState } from "react";
import { AlertTriangle, Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface CredentialsData {
  name: string;
  username: string;
  email: string;
  password: string;
  loginUrl?: string;
}

interface CredentialsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: CredentialsData | null;
  title?: string;
  description?: string;
  onClose?: () => void;
}

/**
 * "Show once" credentials popup. Warns the HQ that the password is only
 * visible this one time and is never retrievable again.
 */
export function CredentialsDialog({
  open,
  onOpenChange,
  data,
  title = "Kredensial Pengguna",
  description = "Salin dan simpan kredensial berikut di tempat aman. Ini adalah satu-satunya kali Anda dapat melihat kata sandi.",
  onClose,
}: CredentialsDialogProps) {
  const [copiedField, setCopiedField] = useState<string | null>(null);

  if (!data) return null;

  const copy = async (field: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 1500);
    } catch {
      // clipboard may be blocked in insecure contexts — ignore
    }
  };

  const handleClose = () => {
    onOpenChange(false);
    if (onClose) onClose();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) handleClose();
        else onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 flex gap-2">
          <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-sm text-amber-800">
            <strong>Peringatan:</strong> Kata sandi hanya ditampilkan sekali
            ini. Setelah Anda menutup jendela ini, kata sandi tidak dapat
            dilihat lagi. Salin sekarang dan berikan kepada pengguna melalui
            kanal yang aman.
          </p>
        </div>

        <div className="space-y-3 py-2">
          <FieldRow
            label="Nama"
            value={data.name}
            onCopy={() => copy("name", data.name)}
            copied={copiedField === "name"}
          />
          <FieldRow
            label="Username"
            value={data.username}
            onCopy={() => copy("username", data.username)}
            copied={copiedField === "username"}
          />
          <FieldRow
            label="Email"
            value={data.email}
            onCopy={() => copy("email", data.email)}
            copied={copiedField === "email"}
          />
          <FieldRow
            label="Kata Sandi"
            value={data.password}
            onCopy={() => copy("password", data.password)}
            copied={copiedField === "password"}
            mono
          />
          {data.loginUrl && (
            <FieldRow
              label="URL Login"
              value={data.loginUrl}
              onCopy={() => copy("loginUrl", data.loginUrl ?? "")}
              copied={copiedField === "loginUrl"}
            />
          )}
        </div>

        <DialogFooter>
          <Button onClick={handleClose} className="w-full">
            Saya sudah menyalin, tutup
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FieldRow({
  label,
  value,
  onCopy,
  copied,
  mono,
}: {
  label: string;
  value: string;
  onCopy: () => void;
  copied: boolean;
  mono?: boolean;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="flex gap-2">
        <Input
          readOnly
          value={value}
          className={mono ? "font-mono" : ""}
          onFocus={(e) => e.currentTarget.select()}
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={onCopy}
          className="shrink-0"
        >
          {copied ? (
            <Check className="h-4 w-4 text-green-600" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
        </Button>
      </div>
    </div>
  );
}