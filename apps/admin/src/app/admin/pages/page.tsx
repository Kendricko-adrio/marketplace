"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  MoreHorizontal,
  FileText,
  Plus,
  Search,
  Pencil,
  Trash2,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
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
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useAuth } from "@/providers/auth-provider";

interface PageRow {
  id: string;
  slug: string;
  title: string;
  isPublished: boolean;
  displayOrder: number;
  updatedAt: string;
}

export default function AdminPagesPage() {
  const { hasPermission } = useAuth();
  const [pages, setPages] = useState<PageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<PageRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchPages = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/pages");
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      setPages(json.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPages();
  }, [fetchPages]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/pages/${deleteTarget.id}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Gagal menghapus");
      toast.success("Halaman berhasil dihapus");
      setDeleteTarget(null);
      fetchPages();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Gagal menghapus";
      toast.error(msg);
    } finally {
      setDeleting(false);
    }
  };

  const filtered = pages.filter(
    (p) =>
      p.title.toLowerCase().includes(search.toLowerCase()) ||
      p.slug.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Halaman Statis</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Kelola halaman statis (Tentang, Syarat, dll) dengan markdown. Hanya
            HQ yang dapat mengelola.
          </p>
        </div>
        {hasPermission("pages", "edit") && (
          <Button asChild className="gap-2">
            <Link href="/admin/pages/new">
              <Plus className="h-4 w-4" /> Halaman Baru
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
          <CardTitle>Daftar Halaman</CardTitle>
          <CardDescription>
            Total {pages.length} halaman. Konten ditulis dalam markdown.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-3 mb-6">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Cari judul atau slug..."
                className="pl-8"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[300px]">Judul</TableHead>
                  <TableHead>Slug</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Urutan</TableHead>
                  <TableHead>Diperbarui</TableHead>
                  <TableHead className="text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                      <Loader2 className="h-5 w-5 animate-spin inline-block" /> Memuat...
                    </TableCell>
                  </TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                      <FileText className="h-10 w-10 mx-auto mb-3 opacity-40" />
                      Tidak ada halaman ditemukan.
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((page) => (
                    <TableRow key={page.id}>
                      <TableCell className="font-medium">{page.title}</TableCell>
                      <TableCell>
                        <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">
                          /pages/{page.slug}
                        </code>
                      </TableCell>
                      <TableCell>
                        {page.isPublished ? (
                          <Badge className="bg-green-500 hover:bg-green-600">
                            Dipublikasi
                          </Badge>
                        ) : (
                          <Badge variant="secondary">Draft</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {page.displayOrder}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatRelative(page.updatedAt)}
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
                            {hasPermission("pages", "edit") && (
                              <DropdownMenuItem asChild>
                                <Link href={`/admin/pages/${page.id}/edit`}>
                                  <Pencil className="mr-2 h-4 w-4" /> Edit
                                </Link>
                              </DropdownMenuItem>
                            )}
                            {hasPermission("pages", "delete") && hasPermission("pages", "edit") && (
                              <DropdownMenuSeparator />
                            )}
                            {hasPermission("pages", "delete") && (
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                disabled={deleting}
                                onClick={() => setDeleteTarget(page)}
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

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="Hapus Halaman"
        description={
          deleteTarget
            ? `Hapus halaman "${deleteTarget.title}"? Tindakan ini tidak dapat dibatalkan.`
            : null
        }
        confirmLabel="Hapus"
        loading={deleting}
        onConfirm={handleDelete}
      />
    </div>
  );
}

function formatRelative(iso: string): string {
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "Baru saja";
  if (diffMin < 60) return `${diffMin} menit lalu`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} jam lalu`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay} hari lalu`;
  return date.toLocaleDateString("id-ID");
}