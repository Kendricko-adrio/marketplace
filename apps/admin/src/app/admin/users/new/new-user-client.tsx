"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import UserForm, { type UserFormData, type BranchOption } from "@/components/admin/UserForm";
import {
  CredentialsDialog,
  type CredentialsData,
} from "@/components/admin/CredentialsDialog";

interface NewUserClientProps {
  branches: BranchOption[];
}

export function NewUserClient({ branches }: NewUserClientProps) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creds, setCreds] = useState<CredentialsData | null>(null);
  const [credsOpen, setCredsOpen] = useState(false);

  const handleSubmit = async (data: UserFormData) => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.name,
          email: data.email,
          role: data.role,
          branchId: data.role === "hq" ? null : data.branchId,
          passwordMode: data.passwordMode,
          password: data.passwordMode === "manual" ? data.password : undefined,
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || "Gagal membuat pengguna");
      }

      setCreds({
        name: json.data.name,
        username: json.data.username,
        email: json.data.email,
        password: json.data.password,
        loginUrl:
          typeof window !== "undefined"
            ? `${window.location.origin}/login`
            : undefined,
      });
      setCredsOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Terjadi kesalahan");
      throw err;
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <UserForm
        mode="create"
        branches={branches}
        onSubmit={handleSubmit}
        submitting={submitting}
        error={error}
      />

      <CredentialsDialog
        open={credsOpen}
        onOpenChange={(v) => {
          setCredsOpen(v);
          if (!v) {
            // After the HQ closes the credentials popup, go back to the list
            router.push("/admin/users");
            router.refresh();
          }
        }}
        data={creds}
      />
    </>
  );
}