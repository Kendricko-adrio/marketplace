"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import UserForm, {
  type UserFormData,
  type BranchOption,
} from "@/components/admin/UserForm";
import { ResetPasswordDialog } from "@/components/admin/ResetPasswordDialog";
import { Button } from "@/components/ui/button";

interface EditUserClientProps {
  userId: string;
  initialData: {
    name: string;
    email: string;
    role: "admin" | "hq";
    branchId: string | null;
  };
  branches: BranchOption[];
}

export function EditUserClient({
  userId,
  initialData,
  branches,
}: EditUserClientProps) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);

  const handleSubmit = async (data: UserFormData) => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.name,
          email: data.email,
          role: data.role,
          branchId: data.role === "hq" ? null : data.branchId,
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || "Gagal memperbarui pengguna");
      }

      router.push("/admin/users");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Terjadi kesalahan");
      throw err;
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
      body: JSON.stringify({ passwordMode, password }),
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(json.error || "Gagal reset password");
    }
    return { password: json.data.password };
  };

  return (
    <div className="space-y-6">
      <UserForm
        mode="edit"
        initialData={initialData}
        branches={branches}
        onSubmit={handleSubmit}
        submitting={submitting}
        error={error}
      />

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
          username: undefined,
        }}
        onConfirm={handleResetPassword}
      />
    </div>
  );
}