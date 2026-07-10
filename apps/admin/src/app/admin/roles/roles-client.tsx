"use client";

import { useState, useCallback } from "react";
import { Save, ShieldCheck, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import type { PermissionMap, ModuleName, ModulePermissions } from "@/db";
import { moduleLabel, HQ_PERMISSIONS } from "@/lib/permissions-shared";

interface RolesClientProps {
  adminPermissions: PermissionMap;
}

const MODULES: ModuleName[] = [
  "products",
  "orders",
  "branches",
  "homepage",
  "pages",
  "users",
];


export function RolesClient({ adminPermissions }: RolesClientProps) {
  const [permissions, setPermissions] = useState<PermissionMap>(adminPermissions);
  const [saving, setSaving] = useState(false);

  const updatePermission = useCallback(
    (role: "admin" | "hq", module: ModuleName, key: keyof ModulePermissions, value: boolean) => {
      if (role === "hq") return; // HQ row is read-only
      setPermissions((prev) => ({
        ...prev,
        [module]: { ...prev[module], [key]: value },
      }));
    },
    []
  );

  const savePermission = async (module: ModuleName) => {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/permissions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: "admin",
          module,
          ...permissions[module],
        }),
      });

      const result = await res.json();
      if (!res.ok || !result.success) {
        throw new Error(result.error || "Failed to save permission");
      }

      toast.success(`Permission untuk modul ${moduleLabel(module)} telah diperbarui.`);
    } catch (err) {
      console.error("Error saving permission:", err);
      toast.error(err instanceof Error ? err.message : "Terjadi kesalahan.");
    } finally {
      setSaving(false);
    }
  };

  const renderRow = (role: "admin" | "hq", perms: PermissionMap, readOnly: boolean) => {
    const roleLabel = role === "hq" ? "HQ" : "Admin";
    const roleColor = role === "hq" ? "bg-primary/10 text-primary" : "bg-secondary text-secondary-foreground";

    return MODULES.map((module) => (
      <TableRow key={`${role}-${module}`}>
        {module === "products" && (
          <TableCell rowSpan={MODULES.length} className="align-top font-medium w-32">
            <div className="flex flex-col gap-1">
              <Badge variant="outline" className={roleColor}>
                {roleLabel}
              </Badge>
              {role === "hq" && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <ShieldCheck size={12} />
                  Akses penuh
                </span>
              )}
            </div>
          </TableCell>
        )}
        <TableCell className="font-medium">{moduleLabel(module)}</TableCell>
        <TableCell className="text-center">
          <Switch
            checked={perms[module].canView}
            disabled={readOnly || saving}
            onCheckedChange={(v) => updatePermission(role, module, "canView", v)}
            aria-label={`${role} can view ${module}`}
          />
        </TableCell>
        <TableCell className="text-center">
          <Switch
            checked={perms[module].canEdit}
            disabled={readOnly || saving || !perms[module].canView}
            onCheckedChange={(v) => updatePermission(role, module, "canEdit", v)}
            aria-label={`${role} can edit ${module}`}
          />
        </TableCell>
        <TableCell className="text-center">
          <Switch
            checked={perms[module].canDelete}
            disabled={readOnly || saving || !perms[module].canView}
            onCheckedChange={(v) => updatePermission(role, module, "canDelete", v)}
            aria-label={`${role} can delete ${module}`}
          />
        </TableCell>
        {!readOnly && (
          <TableCell className="text-right">
            <Button
              size="sm"
              onClick={() => savePermission(module)}
              disabled={saving}
            >
              {saving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Simpan
            </Button>
          </TableCell>
        )}
      </TableRow>
    ));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Matrix Hak Akses</CardTitle>
        <CardDescription>
          HQ (read-only) selalu memiliki akses penuh. Edit permission untuk role Admin di bawah.
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-32">Role</TableHead>
              <TableHead>Modul</TableHead>
              <TableHead className="text-center w-24">Lihat</TableHead>
              <TableHead className="text-center w-24">Edit/Buat</TableHead>
              <TableHead className="text-center w-24">Hapus</TableHead>
              <TableHead className="text-right w-32">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {renderRow("hq", HQ_PERMISSIONS, true)}
            {renderRow("admin", permissions, false)}
          </TableBody>
        </Table>

        <p className="mt-4 text-sm text-muted-foreground">
          Catatan: permission Edit mencakup membuat data baru (misalnya tombol “Tambah”).
          Nonaktifkan “Lihat” untuk menyembunyikan menu dari sidebar sekaligus mematikan akses
          ke halaman dan API modul tersebut.
        </p>
      </CardContent>
    </Card>
  );
}
