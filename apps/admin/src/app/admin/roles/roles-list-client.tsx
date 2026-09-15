"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Plus, Search, Archive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { RoleDetail } from "@/lib/rbac/roles-service";

// =========================================================
// Role list client — searchable, archived filter, immutable Owner
// =========================================================
// Data comes from GET /api/admin/roles (roles:view). System Roles show a
// "Sistem" badge; the System Owner additionally shows an immutable badge and
// no edit affordance. Archived Roles appear only behind the explicit filter.

export function RolesListClient() {
  const [roles, setRoles] = useState<RoleDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (query.trim() !== "") params.set("q", query.trim());
      if (showArchived) params.set("archived", "true");
      const res = await fetch(`/api/admin/roles?${params.toString()}`);
      const body = await res.json();
      if (!res.ok || !body.success) {
        throw new Error(body.error || "Gagal memuat daftar role");
      }
      setRoles(body.data as RoleDetail[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Terjadi kesalahan.");
    } finally {
      setLoading(false);
    }
  }, [query, showArchived]);

  useEffect(() => {
    // Debounce the search input so typing does not spam the API.
    const timer = setTimeout(() => {
      void load();
    }, 250);
    return () => clearTimeout(timer);
  }, [load]);

  return (
    <Card>
      <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle>Daftar Role</CardTitle>
          <CardDescription>
            Role aktif ditampilkan; role yang diarsipkan hanya muncul dengan
            filter eksplisit.
          </CardDescription>
        </div>
        <Button asChild data-testid="roles-new">
          <Link href="/admin/roles/new">
            <Plus className="mr-2 h-4 w-4" /> Role Baru
          </Link>
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Cari role…"
              className="pl-8"
              aria-label="Cari role"
            />
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="roles-archived-filter"
              checked={showArchived}
              onCheckedChange={setShowArchived}
            />
            <Label htmlFor="roles-archived-filter" className="text-sm">
              Tampilkan arsip
            </Label>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <p className="py-6 text-center text-sm text-destructive">{error}</p>
        ) : roles.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Tidak ada role yang cocok.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nama</TableHead>
                <TableHead className="w-28">Tipe</TableHead>
                <TableHead className="w-20 text-center">Versi</TableHead>
                <TableHead className="w-24 text-center">Pengguna</TableHead>
                <TableHead className="w-24 text-center">Izin</TableHead>
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {roles.map((role) => {
                const isOwner = role.key === "system_owner";
                return (
                  <TableRow key={role.id} data-testid="role-row">
                    <TableCell>
                      <Link
                        href={`/admin/roles/${role.id}`}
                        className="font-medium hover:underline"
                      >
                        {role.name}
                      </Link>
                      {role.archived && (
                        <Badge
                          variant="outline"
                          className="ml-2 gap-1 text-muted-foreground"
                        >
                          <Archive className="h-3 w-3" /> Arsip
                        </Badge>
                      )}
                      {role.description && (
                        <p className="text-xs text-muted-foreground">
                          {role.description}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      {isOwner ? (
                        <Badge variant="outline">Sistem · Owner</Badge>
                      ) : role.isSystem ? (
                        <Badge variant="secondary">Sistem</Badge>
                      ) : (
                        <Badge variant="outline">Kustom</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-center text-sm">
                      {role.version}
                    </TableCell>
                    <TableCell className="text-center text-sm">
                      {role.userCount}
                    </TableCell>
                    <TableCell className="text-center text-sm">
                      {role.grants.length}
                    </TableCell>
                    <TableCell>
                      {isOwner ? (
                        <span
                          className="text-xs text-muted-foreground"
                          data-testid="owner-immutable"
                        >
                          Tetap
                        </span>
                      ) : (
                        <Button asChild variant="ghost" size="sm">
                          <Link href={`/admin/roles/${role.id}`}>Buka</Link>
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}