"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Loader2, Search } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
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
import {
  formatCustomerDate,
  getCustomerInitials,
} from "@/lib/customer-display";
import type { CustomerListItem } from "@/lib/customers";

const GENDER_LABELS: Record<string, string> = {
  male: "Male",
  female: "Female",
  other: "Other",
};

export function CustomerTable() {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState({ page: 1, search: "" });
  const [customers, setCustomers] = useState<CustomerListItem[]>([]);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const requestVersion = useRef(0);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
  }, []);

  useEffect(() => {
    const version = ++requestVersion.current;
    let active = true;
    const isCurrent = () => active && version === requestVersion.current;
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    const params = new URLSearchParams({ page: String(query.page), limit: "10" });
    if (query.search) params.set("search", query.search);

    async function loadCustomers() {
      try {
        const response = await fetch(`/api/admin/customers?${params}`, { signal: controller.signal });
        if (!isCurrent()) return;
        if (response.status === 401 || response.status === 403) {
          setCustomers([]);
          window.location.reload();
          return;
        }
        if (!response.ok) throw new Error("Customer list unavailable");
        const result = await response.json();
        if (!isCurrent()) return;
        if (!result.success) throw new Error("Customer list unavailable");
        setCustomers(result.data);
        setPagination(result.pagination);
      } catch {
        if (isCurrent()) setError(true);
      } finally {
        if (isCurrent()) setLoading(false);
      }
    }
    void loadCustomers();
    return () => { active = false; controller.abort(); };
  }, [query, retry]);

  function searchCustomers(value: string) {
    setSearch(value);
    // Invalidate the old response immediately, including during the debounce.
    ++requestVersion.current;
    setLoading(true);
    setError(false);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setQuery({ page: 1, search: value.trim() });
    }, 400);
  }

  function changePage(page: number) {
    setLoading(true);
    setQuery({ page, search: query.search });
  }

  return (
    <div>
      <div className="flex gap-4 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => searchCustomers(event.target.value)}
            placeholder="Cari nama/email/telepon..."
            className="pl-8"
            aria-label="Cari customer berdasarkan nama, email, atau telepon"
          />
        </div>
      </div>

      <div aria-busy={loading}>
        {loading ? (
          <div role="status" className="flex items-center justify-center py-16">
            <Loader2 aria-hidden="true" className="h-8 w-8 animate-spin text-primary" />
            <span className="sr-only">Memuat customer...</span>
          </div>
        ) : error ? (
          <div role="alert" className="flex flex-col items-center gap-3 py-16">
            <p className="text-sm text-muted-foreground">Gagal memuat customer.</p>
            <Button variant="outline" size="sm" onClick={() => setRetry((value) => value + 1)}>Coba lagi</Button>
          </div>
        ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[220px]">Nama</TableHead>
                <TableHead className="min-w-[210px]">Email</TableHead>
                <TableHead className="min-w-[145px]">Telepon</TableHead>
                <TableHead className="min-w-[125px]">Tanggal lahir</TableHead>
                <TableHead>Gender</TableHead>
                <TableHead>Onboarding</TableHead>
                <TableHead className="min-w-[150px]">Dibuat</TableHead>
                <TableHead className="min-w-[150px]">Diperbarui</TableHead>
                <TableHead className="text-center">Order</TableHead>
                <TableHead className="w-[90px] text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {customers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="h-24 text-center">
                    {query.search ? "Tidak ada customer yang cocok dengan pencarian ini." : "Belum ada customer."}
                  </TableCell>
                </TableRow>
              ) : (
                customers.map((customer) => (
                  <TableRow key={customer.id} className="group">
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="h-9 w-9 border">
                          <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
                            {getCustomerInitials(customer.name)}
                          </AvatarFallback>
                        </Avatar>
                        <span className="font-medium text-foreground">
                          {customer.name}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {customer.email}
                    </TableCell>
                    <TableCell>{customer.phone || "—"}</TableCell>
                    <TableCell>
                      {formatCustomerDate(customer.birthDate, "date")}
                    </TableCell>
                    <TableCell>
                      {customer.gender
                        ? GENDER_LABELS[customer.gender] ?? customer.gender
                        : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          customer.onboardingCompleted
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : "border-amber-200 bg-amber-50 text-amber-700"
                        }
                      >
                        {customer.onboardingCompleted ? "Selesai" : "Belum selesai"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatCustomerDate(customer.createdAt)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatCustomerDate(customer.updatedAt)}
                    </TableCell>
                    <TableCell className="text-center font-medium">
                      {customer.orderCount}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        asChild
                        variant="ghost"
                        size="sm"
                        className="gap-1.5"
                      >
                        <Link
                          href={`/admin/customers/${customer.id}`}
                          aria-label={`Lihat detail ${customer.name}`}
                        >
                          Lihat detail <ArrowUpRight className="h-3.5 w-3.5" />
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        )}
        </div>
        <div className="flex items-center justify-end space-x-2 py-4">
          <Button variant="outline" size="sm" disabled={loading || error || pagination.page <= 1} onClick={() => changePage(pagination.page - 1)}>
            Previous
          </Button>
          <span className="text-sm text-muted-foreground" aria-live="polite">Page {pagination.page} of {pagination.totalPages}</span>
          <Button variant="outline" size="sm" disabled={loading || error || pagination.page >= pagination.totalPages} onClick={() => changePage(pagination.page + 1)}>
            Next
          </Button>
        </div>
      </div>
    );
  }
