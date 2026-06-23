"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export interface BranchOption {
  id: string;
  name: string;
  code: string;
  city: string;
}

export interface UserFormData {
  name: string;
  email: string;
  role: "admin" | "hq";
  branchId: string | null;
  passwordMode: "generate" | "manual";
  password: string;
}

interface UserFormProps {
  mode: "create" | "edit";
  initialData?: Partial<UserFormData>;
  branches: BranchOption[];
  onSubmit: (data: UserFormData) => Promise<void>;
  submitting?: boolean;
  error?: string | null;
}

export default function UserForm({
  mode,
  initialData,
  branches,
  onSubmit,
  submitting = false,
  error = null,
}: UserFormProps) {
  const [formData, setFormData] = useState<UserFormData>({
    name: initialData?.name ?? "",
    email: initialData?.email ?? "",
    role: initialData?.role ?? "admin",
    branchId: initialData?.branchId ?? null,
    passwordMode: "generate",
    password: "",
  });
  const [confirmPassword, setConfirmPassword] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  // When role switches to HQ, branchId is meaningless. Rather than sync via
  // effect (which triggers cascading renders), we compute the effective
  // branchId at submit time and disable the select when role === "hq".
  function updateField<K extends keyof UserFormData>(
    key: K,
    value: UserFormData[K]
  ) {
    setFormData((prev) => {
      const next = { ...prev, [key]: value };
      // If switching to HQ, clear branchId in the same setState call.
      if (key === "role" && value === "hq") {
        next.branchId = null;
      }
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLocalError(null);

    if (formData.role === "admin" && !formData.branchId) {
      setLocalError("Admin (staf cabang) wajib memiliki cabang.");
      return;
    }

    if (mode === "create") {
      if (formData.passwordMode === "manual") {
        if (formData.password.length < 8) {
          setLocalError("Password minimal 8 karakter.");
          return;
        }
        if (formData.password !== confirmPassword) {
          setLocalError("Konfirmasi password tidak cocok.");
          return;
        }
      }
    }

    try {
      await onSubmit(formData);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Terjadi kesalahan");
    }
  }

  const displayError = localError || error;

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {displayError && (
        <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-md">
          {displayError}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Informasi Pengguna</CardTitle>
          <CardDescription>
            Data dasar akun admin. Username akan dibuat otomatis dari nama.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="name">Nama Lengkap</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => updateField("name", e.target.value)}
                placeholder="cth. Budi Santoso"
                required
                disabled={submitting}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => updateField("email", e.target.value)}
                placeholder="budi@store.com"
                required
                disabled={submitting}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Peran & Cabang</CardTitle>
          <CardDescription>
            HQ mengawasi semua cabang. Admin (staf cabang) hanya dapat
            mengelola satu cabang.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Peran</Label>
            <RadioGroup
              value={formData.role}
              onValueChange={(v) =>
                updateField("role", v as "admin" | "hq")
              }
              disabled={submitting}
              className="grid sm:grid-cols-2 gap-2"
            >
              <div className="flex items-start space-x-2 rounded-md border p-3">
                <RadioGroupItem id="role-admin" value="admin" className="mt-1" />
                <div>
                  <Label
                    htmlFor="role-admin"
                    className="font-medium cursor-pointer"
                  >
                    Admin (Staf Cabang)
                  </Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Akses terbatas ke satu cabang.
                  </p>
                </div>
              </div>
              <div className="flex items-start space-x-2 rounded-md border p-3">
                <RadioGroupItem id="role-hq" value="hq" className="mt-1" />
                <div>
                  <Label
                    htmlFor="role-hq"
                    className="font-medium cursor-pointer"
                  >
                    HQ (Headquarters)
                  </Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Akses penuh ke semua cabang &amp; manajemen pengguna.
                  </p>
                </div>
              </div>
            </RadioGroup>
          </div>

          {formData.role === "admin" && (
            <div className="space-y-2">
              <Label htmlFor="branch">Cabang</Label>
              <Select
                value={formData.branchId ?? undefined}
                onValueChange={(v) => updateField("branchId", v)}
                disabled={submitting}
              >
                <SelectTrigger id="branch">
                  <SelectValue placeholder="Pilih cabang..." />
                </SelectTrigger>
                <SelectContent>
                  {branches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name} — {b.city} ({b.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {branches.length === 0 && (
                <p className="text-xs text-destructive">
                  Belum ada cabang. Buat cabang terlebih dahulu di menu Cabang.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {mode === "create" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Kata Sandi</CardTitle>
            <CardDescription>
              Pilih cara menetapkan kata sandi awal. Pengguna akan diminta
              mengganti kata sandi pada login pertama.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <RadioGroup
              value={formData.passwordMode}
              onValueChange={(v) =>
                updateField("passwordMode", v as "generate" | "manual")
              }
              disabled={submitting}
              className="grid sm:grid-cols-2 gap-2"
            >
              <div className="flex items-start space-x-2 rounded-md border p-3">
                <RadioGroupItem
                  id="pw-generate"
                  value="generate"
                  className="mt-1"
                />
                <div>
                  <Label
                    htmlFor="pw-generate"
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
                  id="pw-manual"
                  value="manual"
                  className="mt-1"
                />
                <div>
                  <Label
                    htmlFor="pw-manual"
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

            {formData.passwordMode === "manual" && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="password">Kata Sandi</Label>
                  <Input
                    id="password"
                    type="password"
                    value={formData.password}
                    onChange={(e) => updateField("password", e.target.value)}
                    required={formData.passwordMode === "manual"}
                    disabled={submitting}
                    minLength={8}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirmPassword">Konfirmasi Kata Sandi</Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required={formData.passwordMode === "manual"}
                    disabled={submitting}
                  />
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button type="submit" disabled={submitting}>
          {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          {mode === "create" ? "Buat Pengguna" : "Simpan Perubahan"}
        </Button>
      </div>
    </form>
  );
}