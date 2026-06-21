"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CredentialsDialog, type CredentialsData } from "./CredentialsDialog";

interface ResetPasswordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: {
    id: string;
    name: string;
    email: string;
    username?: string | null;
  } | null;
  onConfirm: (
    passwordMode: "generate" | "manual",
    password?: string
  ) => Promise<{ password: string }>;
}

export function ResetPasswordDialog({
  open,
  onOpenChange,
  user,
  onConfirm,
}: ResetPasswordDialogProps) {
  const [passwordMode, setPasswordMode] = useState<"generate" | "manual">(
    "generate"
  );
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creds, setCreds] = useState<CredentialsData | null>(null);
  const [credsOpen, setCredsOpen] = useState(false);

  const reset = () => {
    setPasswordMode("generate");
    setPassword("");
    setConfirmPassword("");
    setError(null);
    setCreds(null);
    setCredsOpen(false);
  };

  const handleClose = () => {
    onOpenChange(false);
    reset();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setError(null);

    if (passwordMode === "manual") {
      if (password.length < 8) {
        setError("Password minimal 8 karakter.");
        return;
      }
      if (password !== confirmPassword) {
        setError("Konfirmasi password tidak cocok.");
        return;
      }
    }

    setSubmitting(true);
    try {
      const result = await onConfirm(passwordMode, password);
      setCreds({
        name: user.name,
        username: user.username ?? "",
        email: user.email,
        password: result.password,
      });
      setCredsOpen(true);
      // Close the form dialog, keep the credentials dialog open
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Terjadi kesalahan");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!v) handleClose();
          else onOpenChange(v);
        }}
      >
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>Reset Kata Sandi</DialogTitle>
            <DialogDescription>
              Reset kata sandi untuk{" "}
              <strong>{user?.name}</strong> ({user?.email}). Semua sesi aktif
              pengguna ini akan dihapus dan mereka perlu login ulang.
            </DialogDescription>
          </DialogHeader>

          {error && (
            <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-md">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <RadioGroup
              value={passwordMode}
              onValueChange={(v) =>
                setPasswordMode(v as "generate" | "manual")
              }
              disabled={submitting}
              className="grid gap-2"
            >
              <div className="flex items-start space-x-2 rounded-md border p-3">
                <RadioGroupItem
                  id="rp-generate"
                  value="generate"
                  className="mt-1"
                />
                <div>
                  <Label
                    htmlFor="rp-generate"
                    className="font-medium cursor-pointer"
                  >
                    Generate Otomatis
                  </Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Sistem membuat kata sandi acak 16 karakter.
                  </p>
                </div>
              </div>
              <div className="flex items-start space-x-2 rounded-md border p-3">
                <RadioGroupItem
                  id="rp-manual"
                  value="manual"
                  className="mt-1"
                />
                <div>
                  <Label
                    htmlFor="rp-manual"
                    className="font-medium cursor-pointer"
                  >
                    Atur Manual
                  </Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    HQ mengetik kata sandi sendiri (min. 8 karakter).
                  </p>
                </div>
              </div>
            </RadioGroup>

            {passwordMode === "manual" && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="rp-password">Kata Sandi Baru</Label>
                  <Input
                    id="rp-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required={passwordMode === "manual"}
                    disabled={submitting}
                    minLength={8}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="rp-confirm">Konfirmasi</Label>
                  <Input
                    id="rp-confirm"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required={passwordMode === "manual"}
                    disabled={submitting}
                  />
                </div>
              </div>
            )}

            <DialogFooter>
              <Button type="submit" disabled={submitting} className="w-full">
                {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Reset Kata Sandi
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <CredentialsDialog
        open={credsOpen}
        onOpenChange={(v) => {
          setCredsOpen(v);
          if (!v) reset();
        }}
        data={creds}
        title="Kata Sandi Baru"
        description="Kata sandi baru telah dibuat. Salin dan berikan kepada pengguna melalui kanal yang aman. Pengguna akan diminta mengganti kata sandi pada login berikutnya."
      />
    </>
  );
}