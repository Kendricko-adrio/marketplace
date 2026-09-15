"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  MoreHorizontal,
  UserPlus,
  Search,
  ShieldCheck,
  KeyRound,
  Pencil,
  Trash2,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ResetPasswordDialog } from "@/components/admin/ResetPasswordDialog";
import { buildResetPasswordPayload } from "@/lib/reset-password-contract";
import { useAuth } from "@/providers/auth-provider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface UserRow {
  id: string;
  name: string;
  username: string | null;
  email: string;
  /** Dynamic Role object — authorization/display never uses role names. */
  role: {
    id: string;
    key: string | null;
    name: string;
    isSystem: boolean;
  } | null;
  branch: {
    id: string;
    name: string;
    code: string;
  } | null;
  isActive: boolean;
  mustResetPassword: boolean;
  emailVerified: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Active Role option for the filter select (GET /api/admin/roles). */
interface RoleFilterOption {
  id: string;
  name: string;
  archived: boolean;
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [roles, setRoles] = useState<RoleFilterOption[]>([]);

  // Reset password dialog state
  const [resetOpen, setResetOpen] = useState(false);
  const [resetTarget, setResetTarget] = useState<UserRow | null>(null);

  // Delete dialog state
  const [deleteTarget, setDeleteTarget] = useState<UserRow | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { hasPermission } = useAuth();

  // Dynamic Role list for the filter select; failures leave only the
  // "all" option instead of blocking the directory.
  useEffect(() => {
    fetch("/api/admin/roles")
      .then(async (res) => {
        if (!res.ok) return;
        const body = await res.json();
        if (body.success) {
          setRoles(
            (body.data as Array<{
              id: string;
              name: string;
              archived: boolean;
            }>).filter((role) => !role.archived)
          );
        }
      })
      .catch(() => {
        // Filter stays unavailable; the list itself still loads.
      });
  }, []);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (roleFilter !== "all") params.set("roleId", roleFilter);
      const res = await fetch(`/api/admin/users?${params.toString()}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      setUsers(json.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat data");
    } finally {
      setLoading(false);
    }
  }, [search, roleFilter]);

  useEffect(() => {
    const t = setTimeout(fetchUsers, 250);
    return () => clearTimeout(t);
  }, [fetchUsers]);

  const handleResetPassword = async (
    passwordMode: "generate" | "manual",
    password?: string
  ): Promise<{ password: string }> => {
    if (!resetTarget) throw new Error("Tidak ada target");
    const res = await fetch(
      `/api/admin/users/${resetTarget.id}/reset-password`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildResetPasswordPayload(passwordMode, password)),
      }
    );
    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(json.error || "Gagal reset password");
    }
    return { password: json.data.password };
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/users/${deleteTarget.id}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || "Gagal menghapus pengguna");
      }
      setDeleteOpen(false);
      setDeleteTarget(null);
      fetchUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menghapus");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Pengguna &amp; Akses</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Kelola akun admin, peran, dan akses cabang.
          </p>
        </div>
        {hasPermission("users", "edit") && (
          <Button asChild className="gap-2">
            <Link href="/admin/users/new">
              <UserPlus className="h-4 w-4" /> Tambah Admin
            </Link>
          </Button>
        )}
      </div>

      {error && (
        <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-md flex items-center gap-2">
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Daftar Pengguna</CardTitle>
          <CardDescription>
            Total {users.length} pengguna. Hanya HQ yang dapat mengelola
            pengguna.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-3 mb-6">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Cari nama, email, username..."
                className="pl-8"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Select value={roleFilter} onValueChange={setRoleFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Filter peran" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Peran</SelectItem>
                {roles.map((role) => (
                  <SelectItem key={role.id} value={role.id}>
                    {role.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[280px]">Pengguna</TableHead>
                  <TableHead>Peran</TableHead>
                  <TableHead>Cabang</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                      Memuat...
                    </TableCell>
                  </TableRow>
                ) : users.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                      Tidak ada pengguna ditemukan.
                    </TableCell>
                  </TableRow>
                ) : (
                  users.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="h-8 w-8">
                            <AvatarFallback>
                              {user.name.charAt(0).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <div className="font-medium flex items-center gap-2">
                              {user.name}
                              {user.mustResetPassword && (
                                <Badge variant="outline" className="text-amber-600 border-amber-400 text-xs">
                                  Reset diperlukan
                                </Badge>
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {user.email}
                              {user.username && (
                                <span className="ml-1">
                                  · @{user.username}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge className="gap-1">
                          {user.role?.isSystem && (
                            <ShieldCheck className="h-3 w-3" />
                          )}
                          {user.role?.name ?? "—"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {user.branch ? (
                          <span className="text-sm">
                            {user.branch.name}
                            <span className="text-xs text-muted-foreground ml-1">
                              ({user.branch.code})
                            </span>
                          </span>
                        ) : (
                          <span className="text-sm text-muted-foreground">
                            Semua Cabang
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="default"
                          className="bg-green-500 hover:bg-green-600"
                        >
                          Aktif
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" className="h-8 w-8 p-0">
                              <span className="sr-only">Open menu</span>
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuLabel>Aksi</DropdownMenuLabel>
                            <DropdownMenuItem asChild>
                              <Link href={`/admin/users/${user.id}/edit`}>
                                <Pencil className="mr-2 h-4 w-4" /> Edit
                              </Link>
                            </DropdownMenuItem>
                            {hasPermission("users", "edit") && (
                              <DropdownMenuItem
                                onClick={() => {
                                  setResetTarget(user);
                                  setResetOpen(true);
                                }}
                              >
                                <KeyRound className="mr-2 h-4 w-4" /> Reset
                                Password
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            {hasPermission("users", "delete") && (
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => {
                                  setDeleteTarget(user);
                                  setDeleteOpen(true);
                                }}
                              >
                                <Trash2 className="mr-2 h-4 w-4" /> Hapus
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <ResetPasswordDialog
        open={resetOpen}
        onOpenChange={setResetOpen}
        user={
          resetTarget
            ? {
                id: resetTarget.id,
                name: resetTarget.name,
                email: resetTarget.email,
                username: resetTarget.username,
              }
            : null
        }
        onConfirm={handleResetPassword}
      />

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Hapus Pengguna?</DialogTitle>
            <DialogDescription>
              Anda akan menghapus{" "}
              <strong>{deleteTarget?.name}</strong> ({deleteTarget?.email}).
              Tindakan ini tidak dapat dibatalkan. Semua sesi pengguna akan
              dihapus.
            </DialogDescription>
          </DialogHeader>
          {error && (
            <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-md">
              {error}
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteOpen(false)}
              disabled={deleting}
            >
              Batal
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? "Menghapus..." : "Hapus"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}