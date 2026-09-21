"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Archive, Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ALL_MODULES,
  SYSTEM_OWNER_KEY,
  type ActionKey,
  type Grant,
  type GrantScope,
  type ModuleKey,
} from "@marketplace/db/src/rbac/catalog";
import {
  cellScopeOptions,
  grantsToMatrix,
  isCellSelectable,
  matrixHasCoverageError,
  matrixToGrants,
  RBAC_ACTION_LABELS,
  RBAC_MODULE_LABELS,
  RBAC_SCOPE_LABELS,
  type GrantMatrix,
} from "@/lib/rbac/grant-matrix";

// =========================================================
// Role editor client — create/revise/impact/archive/restore
// =========================================================
// The editor always saves a COMPLETE identity + grant draft. A permission
// reduction (removed grant or all→own narrowing) shows the exact diff and
// affected active users and requires an explicit reason before saving.
// Optimistic concurrency: saves carry expectedVersion; a 409 STALE_VERSION
// is surfaced visibly without overwriting the other editor's changes.

type Mode = "new" | "edit" | "archived";

interface RolePayload {
  id: string;
  key: string | null;
  name: string;
  description: string | null;
  isSystem: boolean;
  archived: boolean;
  version: number;
  userCount: number;
  activeUserCount: number;
  grants: Grant[];
}

interface ImpactPreview {
  reduction: boolean;
  diff: { added: Grant[]; removed: Grant[] };
  invalidGrants: Grant[];
  affectedActiveUsers: number;
}

interface RestoreReview {
  role: { id: string; name: string; version: number };
  validGrants: Grant[];
  invalidGrants: Grant[];
}

const ACTIONS: ActionKey[] = ["view", "edit", "delete"];

export function RoleEditorClient({ roleId }: { roleId: string }) {
  const isNew = roleId === "new";
  const router = useRouter();

  const [mode, setMode] = useState<Mode>(isNew ? "new" : "edit");
  const [role, setRole] = useState<RolePayload | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [matrix, setMatrix] = useState<GrantMatrix>(() => grantsToMatrix([]));
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);

  // Reduction confirmation state.
  const [pendingImpact, setPendingImpact] = useState<ImpactPreview | null>(null);
  const [reduceReason, setReduceReason] = useState("");

  // Archive state.
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveReason, setArchiveReason] = useState("");

  // Restore review state.
  const [restoreReview, setRestoreReview] = useState<RestoreReview | null>(null);

  const loadRole = useCallback(async () => {
    if (isNew) {
      setRole(null);
      setMode("new");
      // Optional clone: start from a copy of an existing Role's grants
      // (client-side draft — nothing is created until final Save).
      const cloneFrom = new URLSearchParams(window.location.search).get(
        "cloneFrom"
      );
      if (cloneFrom) {
        try {
          const res = await fetch(`/api/admin/roles/${cloneFrom}`);
          const body = await res.json();
          if (res.ok && body.success) {
            const source = body.data as RolePayload;
            // "- Salinan" stays inside the Role-Name charset (letters,
            // numbers, spaces, hyphens, underscores — no parentheses).
            setName(`${source.name} - Salinan`);
            setDescription(source.description ?? "");
            setMatrix(grantsToMatrix(source.grants));
            return;
          }
        } catch {
          // Fall through to a deny-all draft.
        }
      }
      setMatrix(grantsToMatrix([]));
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/roles/${roleId}`);
      const body = await res.json();
      if (!res.ok || !body.success) {
        setMessage(body.error || "Role tidak ditemukan");
        setLoading(false);
        return;
      }
      const data = body.data as RolePayload;
      setRole(data);
      setName(data.name);
      setDescription(data.description ?? "");
      setMatrix(grantsToMatrix(data.grants));
      setMode(data.archived ? "archived" : "edit");
      if (data.archived) {
        const review = await fetch(`/api/admin/roles/${roleId}/restore`);
        const reviewBody = await review.json();
        if (review.ok && reviewBody.success) {
          setRestoreReview(reviewBody.data as RestoreReview);
        }
      }
    } finally {
      setLoading(false);
    }
  }, [isNew, roleId]);

  useEffect(() => {
    void loadRole();
  }, [loadRole]);

  const draftGrants = useMemo(() => matrixToGrants(matrix), [matrix]);
  const coverageError = useMemo(
    () => matrixHasCoverageError(matrix),
    [matrix]
  );
  const isOwner = role?.key === SYSTEM_OWNER_KEY;
  const immutable = isOwner;

  const setCell = (module: ModuleKey, action: ActionKey, scope: GrantScope | false) => {
    setMatrix((prev) => ({
      ...prev,
      [module]: { ...prev[module], [action]: scope },
    }));
  };

  // ===== Save (create or revise) with impact confirmation =====
  const requestSave = async () => {
    setMessage(null);
    setConflict(false);
    if (!isNew && role) {
      // Revision: preview the impact first; reductions need confirmation.
      const res = await fetch(`/api/admin/roles/${roleId}/impact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, grants: draftGrants }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) {
        setMessage(body.error || "Gagal menghitung dampak perubahan");
        return;
      }
      const preview = body.data as ImpactPreview;
      if (preview.reduction) {
        setPendingImpact(preview);
        setReduceReason("");
        return;
      }
      await saveWithReason(undefined);
      return;
    }
    await saveWithReason(undefined);
  };

  const saveWithReason = async (reason?: string) => {
    setSaving(true);
    setMessage(null);
    setConflict(false);
    try {
      if (isNew) {
        const res = await fetch("/api/admin/roles", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, description, grants: draftGrants }),
        });
        const body = await res.json();
        if (!res.ok || !body.success) {
          setMessage(body.error || "Gagal membuat role");
          return;
        }
        router.push(`/admin/roles/${(body.data as RolePayload).id}`);
        return;
      }
      const res = await fetch(`/api/admin/roles/${roleId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description,
          grants: draftGrants,
          expectedVersion: role?.version,
          reason: reason ?? null,
        }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) {
        if (body.code === "STALE_VERSION") {
          setConflict(true);
          // Re-fetch so the editor shows the current server state.
          await loadRole();
        }
        setMessage(body.error || "Gagal menyimpan role");
        return;
      }
      const data = body.data as RolePayload;
      setRole(data);
      setMessage("Perubahan role tersimpan.");
    } finally {
      setSaving(false);
      setPendingImpact(null);
      setReduceReason("");
    }
  };

  // ===== Archive (custom Roles only) =====
  const archiveRole = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/roles/${roleId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: archiveReason }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) {
        setMessage(body.error || "Gagal mengarsipkan role");
        return;
      }
      setArchiveOpen(false);
      setArchiveReason("");
      await loadRole();
    } finally {
      setSaving(false);
    }
  };

  // ===== Restore (archived Roles) =====
  const restoreRole = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/roles/${roleId}/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description,
          grants: draftGrants,
          expectedVersion: role?.version,
        }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) {
        if (body.code === "STALE_VERSION") setConflict(true);
        setMessage(body.error || "Gagal mengaktifkan kembali role");
        return;
      }
      await loadRole();
      setMessage("Role berhasil diaktifkan kembali.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isNew && !role) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          {message || "Role tidak ditemukan"}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="icon" aria-label="Kembali">
            <Link href="/admin/roles">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-xl font-bold text-foreground">
              {isNew ? "Role Baru" : role!.name}
            </h1>
            {role && (
              <p className="text-xs text-muted-foreground">
                Versi {role.version} · {role.userCount} pengguna
                {role.isSystem && " · Role sistem"}
                {role.archived && " · Diarsipkan"}
              </p>
            )}
          </div>
        </div>
        {!isNew && !isOwner && !role!.archived && !role!.isSystem && (
          <Button
            variant="outline"
            data-testid="role-archive"
            onClick={() => setArchiveOpen(true)}
          >
            <Archive className="mr-2 h-4 w-4" /> Arsipkan
          </Button>
        )}
      </div>

      {conflict && (
        <div
          className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
          data-testid="stale-version-conflict"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">Versi sudah kedaluwarsa</p>
            <p className="text-xs">
              Role diubah oleh orang lain. Perubahan Anda TIDAK disimpan —
              muat ulang data terbaru sebelum mencoba lagi.
            </p>
          </div>
        </div>
      )}

      {message && !conflict && (
        <p className="text-sm text-destructive" data-testid="role-editor-message">
          {message}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Identitas</CardTitle>
          {isOwner && (
            <CardDescription data-testid="owner-immutable-note">
              System Owner bersifat immutable dan tidak memiliki baris izin —
              bypass penuh dimiliki oleh kode.
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="role-name">Nama Role</Label>
            <Input
              id="role-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isOwner || mode === "archived"}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="role-description">Deskripsi</Label>
            <Input
              id="role-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={isOwner || mode === "archived"}
            />
          </div>
        </CardContent>
      </Card>

      {mode === "archived" && restoreReview && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Tinjauan Restorasi
            </CardTitle>
            <CardDescription>
              Izin tersimpan ditinjau ulang terhadap katalog saat ini.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm" data-testid="restore-review">
            <div>
              <span className="font-medium">Izin valid:</span>{" "}
              {restoreReview.validGrants.map(grantLabel).join(", ") || "—"}
            </div>
            <div>
              <span className="font-medium">Izin tidak valid:</span>{" "}
              {restoreReview.invalidGrants.map(grantLabel).join(", ") || "—"}
            </div>
          </CardContent>
        </Card>
      )}

      <GrantMatrixCard
        matrix={matrix}
        disabled={isOwner}
        onCellChange={setCell}
      />

      {coverageError && (
        <p className="text-sm text-destructive" data-testid="coverage-error">
          Kesalahan cakupan: setiap izin Ubah/Hapus memerlukan izin Lihat pada
          modul yang sama (dengan cakupan yang mencakup).
        </p>
      )}

      {mode !== "archived" && !isOwner && (
        <div className="flex items-center gap-3">
          <Button
            onClick={requestSave}
            disabled={saving || coverageError || name.trim().length === 0}
            data-testid="role-save"
          >
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isNew ? "Simpan Role Baru" : "Simpan Perubahan"}
          </Button>
          {!isNew && (
            <Button asChild variant="ghost">
              <Link href={`/admin/roles/new?cloneFrom=${roleId}`}>
                Duplikat sebagai Role Baru
              </Link>
            </Button>
          )}
        </div>
      )}

      {mode === "archived" && (
        <div className="flex items-center gap-3">
          <Button
            onClick={restoreRole}
            disabled={saving || coverageError}
            data-testid="role-restore"
          >
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Aktifkan Kembali
          </Button>
        </div>
      )}

      {/* Reduction impact confirmation */}
      <Dialog
        open={pendingImpact !== null}
        onOpenChange={(open) => {
          if (!open) setPendingImpact(null);
        }}
      >
        <DialogContent data-testid="impact-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              Pengurangan izin terdeteksi
            </DialogTitle>
            <DialogDescription>
              Simpanan ini MENGURANGI hak akses. Tinjau dampaknya dan berikan
              alasan sebelum melanjutkan.
            </DialogDescription>
          </DialogHeader>
          {pendingImpact && (
            <div className="space-y-3 text-sm" data-testid="impact-diff">
              <div>
                <span className="font-medium">Izin dihapus:</span>{" "}
                {pendingImpact.diff.removed.map(grantLabel).join(", ") || "—"}
              </div>
              {pendingImpact.diff.added.length > 0 && (
                <div>
                  <span className="font-medium">Izin ditambahkan:</span>{" "}
                  {pendingImpact.diff.added.map(grantLabel).join(", ")}
                </div>
              )}
              <div>
                <span className="font-medium">
                  Pengguna aktif terdampak: {pendingImpact.affectedActiveUsers}
                </span>
              </div>
              <div className="space-y-2">
                <Label htmlFor="reduction-reason">Alasan pengurangan</Label>
                <Textarea
                  id="reduction-reason"
                  value={reduceReason}
                  onChange={(e) => setReduceReason(e.target.value)}
                  placeholder="Wajib diisi untuk pengurangan hak akses"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingImpact(null)}>
              Batal
            </Button>
            <Button
              onClick={() => void saveWithReason(reduceReason)}
              disabled={saving || reduceReason.trim() === ""}
              data-testid="impact-confirm"
            >
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Konfirmasi Pengurangan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Archive confirmation */}
      <Dialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <DialogContent data-testid="archive-dialog">
          <DialogHeader>
            <DialogTitle>Arsipkan Role</DialogTitle>
            <DialogDescription>
              Role diarsipkan (tidak dihapus). Nama role tetap tercadangkan.
              Role dengan pengguna aktif tidak dapat diarsipkan.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="archive-reason">Alasan pengarsipan</Label>
            <Textarea
              id="archive-reason"
              value={archiveReason}
              onChange={(e) => setArchiveReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setArchiveOpen(false)}>
              Batal
            </Button>
            <Button
              variant="destructive"
              onClick={archiveRole}
              disabled={saving || archiveReason.trim() === ""}
              data-testid="archive-confirm"
            >
              Arsipkan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function grantLabel(grant: Grant): string {
  return `${RBAC_MODULE_LABELS[grant.module]} · ${RBAC_ACTION_LABELS[grant.action]} · ${RBAC_SCOPE_LABELS[grant.scope]}`;
}

// =========================================================
// Grant matrix — one row per module, one column per action, scope selector
// per selectable cell. Unsupported module/action pairs cannot be selected.
// =========================================================
function GrantMatrixCard({
  matrix,
  disabled,
  onCellChange,
}: {
  matrix: GrantMatrix;
  disabled: boolean;
  onCellChange: (
    module: ModuleKey,
    action: ActionKey,
    scope: GrantScope | false
  ) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Matriks Izin</CardTitle>
        <CardDescription>
          Kombinasi modul/aksi di luar katalog tidak dapat dipilih. Modul
          global berlaku luas tanpa cakupan cabang.
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-40">Modul</TableHead>
              {ACTIONS.map((action) => (
                <TableHead key={action} className="w-40 text-center">
                  {RBAC_ACTION_LABELS[action]}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {ALL_MODULES.map((module) => (
              <TableRow key={module}>
                <TableCell className="font-medium">
                  {RBAC_MODULE_LABELS[module]}
                </TableCell>
                {ACTIONS.map((action) => {
                  const options = cellScopeOptions(module, action);
                  const cell = matrix[module]?.[action];
                  if (options.length === 0) {
                    return (
                      <TableCell
                        key={action}
                        className="text-center text-xs text-muted-foreground"
                      >
                        —
                      </TableCell>
                    );
                  }
                  return (
                    <TableCell key={action} className="text-center">
                      <Select
                        value={cell ? cell : "none"}
                        onValueChange={(value) =>
                          onCellChange(
                            module,
                            action,
                            value === "none" ? false : (value as GrantScope)
                          )
                        }
                        disabled={disabled}
                      >
                        <SelectTrigger className="mx-auto h-8 w-36 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Tidak diizinkan</SelectItem>
                          {options.map((scope) => (
                            <SelectItem key={scope} value={scope}>
                              {RBAC_SCOPE_LABELS[scope]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}