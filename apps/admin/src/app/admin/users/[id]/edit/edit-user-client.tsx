"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { ResetPasswordDialog } from "@/components/admin/ResetPasswordDialog";
import { buildResetPasswordPayload } from "@/lib/reset-password-contract";

export interface EditUserRole {
  id: string;
  key: string | null;
  name: string;
  isSystem: boolean;
}

export interface EditUserBranchOption {
  id: string;
  name: string;
  code: string;
  city: string;
}

interface EditUserClientProps {
  userId: string;
  /** Current Role assignment of the user (read-only on this page). */
  role: EditUserRole;
  initialData: {
    name: string;
    email: string;
    roleId: string;
    branchId: string | null;
    username: string | null;
  };
  branches: EditUserBranchOption[];
}

export function EditUserClient({
  userId,
  role,
  initialData,
  branches,
}: EditUserClientProps) {
  const router = useRouter();
  const [name, setName] = useState(initialData.name);
  const [email, setEmail] = useState(initialData.email);
  const [branchId, setBranchId] = useState<string | null>(
    initialData.branchId
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);

  // The System Owner Role has no Home Branch; every other Role (including
  // HQ and global-only Roles) requires exactly one Home Branch.
  const isOwner = role.key === "system_owner";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!isOwner && !branchId) {
      setError("Peran ini wajib memiliki cabang utama (Home Branch).");
      return;
    }

    setSubmitting(true);
    try {
      // Strict RBAC payload: assignment stays on the current Role (roleId is
      // passed through unchanged) with the Home Branch per Role requirement.
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          roleId: initialData.roleId,
          branchId: isOwner ? null : branchId,
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || "Gagal memperbarui pengguna");
      }

      toast.success("Perubahan pengguna tersimpan");
      router.push("/admin/users");
      router.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Terjadi kesalahan";
      setError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleResetPassword = async (
    passwordMode: "generate" | "manual",
    password?: string
  ): Promise<{ password: string }> => {
    const res = await fetch(`/api/admin/users/${userId}/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildResetPasswordPayload(passwordMode, password)),
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(json.error || "Gagal reset password");
    }
    return { password: json.data.password };
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {error && (
        <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-md">
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Informasi Pengguna</CardTitle>
          <CardDescription>
            Data dasar akun admin. Username dibuat otomatis dari nama dan
            tidak dapat diubah.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="name">Nama Lengkap</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                disabled={submitting}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={submitting}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Peran &amp; Cabang</CardTitle>
          <CardDescription>
            Peran diatur melalui manajemen Role. Setiap peran non-Owner wajib
            memiliki satu cabang utama (Home Branch).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Peran Saat Ini</Label>
            <div className="rounded-md border p-3 text-sm">
              {role.name}
              {role.isSystem && (
                <span className="ml-2 text-xs text-muted-foreground">
                  (peran sistem)
                </span>
              )}
            </div>
          </div>

          {isOwner ? (
            <p className="text-sm text-muted-foreground">
              System Owner tidak memerlukan cabang utama.
            </p>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="branch">Cabang Utama (Home Branch)</Label>
              <Select
                value={branchId ?? undefined}
                onValueChange={(v) => setBranchId(v)}
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

      <div className="flex items-center justify-end gap-2">
        <Button type="submit" disabled={submitting}>
          Simpan Perubahan
        </Button>
      </div>

      <div className="border-t pt-6">
        <h3 className="text-lg font-semibold mb-2">Tindakan Lain</h3>
        <Button
          type="button"
          variant="outline"
          onClick={() => setResetOpen(true)}
        >
          Reset Kata Sandi
        </Button>
        <p className="text-xs text-muted-foreground mt-2">
          Reset kata sandi pengguna. Semua sesi aktif akan dihapus dan kata
          sandi baru akan ditampilkan satu kali.
        </p>
      </div>

      <ResetPasswordDialog
        open={resetOpen}
        onOpenChange={setResetOpen}
        user={{
          id: userId,
          name: initialData.name,
          email: initialData.email,
          username: initialData.username,
        }}
        onConfirm={handleResetPassword}
      />
    </form>
  );
}