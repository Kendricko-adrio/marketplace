"use client";
import { useCallback, useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Edit,
  Trash2,
  Plus,
  MoreHorizontal,
  Search,
  Loader2,
  MapPin,
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useAuth } from "@/providers/auth-provider";

interface Branch {
  id: string;
  name: string;
  code: string;
  city: string;
  address: string;
  status: string;
}

export default function AdminBranchesPage() {
  const router = useRouter();
  const { hasPermission } = useAuth();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [deleteTarget, setDeleteTarget] = useState<Branch | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Debounce the input so the DB is only queried after typing stops.
  useEffect(() => {
    const handle = setTimeout(() => {
      setDebouncedSearch(searchTerm.trim());
    }, 400);
    return () => clearTimeout(handle);
  }, [searchTerm]);

  // A new search re-slices the result set from page 1.
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);

  const fetchBranches = useCallback(async () => {
    setLoading(true);
    try {
      // The search term goes to the API (server-side filter across ALL rows),
      // not a client-side filter over the current page.
      const params = new URLSearchParams({
        page: String(page),
        limit: "10",
      });
      if (debouncedSearch) params.set("search", debouncedSearch);
      const res = await fetch(`/api/admin/branches?${params.toString()}`);
      const data = await res.json();
      if (data.success) {
        setBranches(data.data);
        setTotalPages(Math.max(1, data.pagination.totalPages));
      }
    } catch (error) {
      console.error("Error fetching branches:", error);
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch]);

  useEffect(() => {
    void fetchBranches();
  }, [fetchBranches]);

  const getStatusBadge = (status: string) => {
    const variants: Record<string, "default" | "destructive" | "secondary"> = {
      aktif: "default",
      nonaktif: "secondary",
    };
    return variants[status] || "secondary";
  };

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/branches/${deleteTarget.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (data.success) {
        toast.success("Cabang berhasil dihapus");
        setDeleteTarget(null);
        fetchBranches();
      } else {
        toast.error(data.error || "Gagal menghapus cabang");
      }
    } catch {
      toast.error("Gagal menghapus cabang");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <h2 className="text-2xl font-bold tracking-tight">Cabang</h2>
        {hasPermission("branches", "edit") && (
          <Link href="/admin/branches/new">
            <Button className="gap-2">
              <Plus className="h-4 w-4" /> Tambah Cabang
            </Button>
          </Link>
        )}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Daftar Cabang</CardTitle>
          <CardDescription>
            Kelola lokasi cabang toko, alamat, dan jam operasional.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4 mb-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Cari nama/kode/kota..."
                aria-label="Cari cabang berdasarkan nama, kode, atau kota"
                className="pl-8"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : (
            <>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nama Cabang</TableHead>
                      <TableHead>Kode</TableHead>
                      <TableHead>Kota</TableHead>
                      <TableHead>Alamat</TableHead>
                      <TableHead className="text-center">Status</TableHead>
                      <TableHead className="w-[80px] text-right">Aksi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {branches.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="h-24 text-center">
                          {debouncedSearch
                            ? `Tidak ada cabang yang cocok dengan pencarian "${debouncedSearch}".`
                            : "Belum ada cabang."}
                        </TableCell>
                      </TableRow>
                    ) : (
                      branches.map((branch) => (
                        <TableRow key={branch.id}>
                          <TableCell className="font-medium">
                            <span className="inline-flex items-center gap-2">
                              <MapPin className="h-4 w-4 text-muted-foreground" />
                              {branch.name}
                            </span>
                          </TableCell>
                          <TableCell className="font-mono text-sm">
                            {branch.code}
                          </TableCell>
                          <TableCell>{branch.city}</TableCell>
                          <TableCell className="max-w-xs truncate text-muted-foreground">
                            {branch.address}
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge
                              variant={getStatusBadge(branch.status)}
                              className="capitalize"
                            >
                              {branch.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" className="h-8 w-8 p-0">
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuLabel>Aksi</DropdownMenuLabel>
                                {hasPermission("branches", "edit") && (
                                  <DropdownMenuItem
                                    className="cursor-pointer gap-2"
                                    onSelect={() =>
                                      router.push(
                                        `/admin/branches/${branch.id}/edit`
                                      )
                                    }
                                  >
                                    <Edit className="h-4 w-4" /> Edit
                                  </DropdownMenuItem>
                                )}
                                {hasPermission("branches", "delete") && hasPermission("branches", "edit") && (
                                  <DropdownMenuSeparator />
                                )}
                                {hasPermission("branches", "delete") && (
                                  <DropdownMenuItem
                                    className="cursor-pointer gap-2 text-destructive focus:text-destructive focus:bg-destructive/10"
                                    onSelect={() => setDeleteTarget(branch)}
                                  >
                                    <Trash2 className="h-4 w-4" /> Hapus
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

              <div className="flex items-center justify-end space-x-2 py-4">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                >
                  Previous
                </Button>
                <span className="text-sm text-muted-foreground">
                  Page {page} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage(page + 1)}
                >
                  Next
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="Hapus Cabang"
        description={
          deleteTarget
            ? `Yakin ingin menghapus cabang "${deleteTarget.name}"? Tindakan ini tidak dapat dibatalkan.`
            : null
        }
        confirmLabel="Hapus"
        loading={deleting}
        onConfirm={handleDelete}
      />
    </div>
  );
}
