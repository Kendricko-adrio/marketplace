"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Eye, Search, MoreHorizontal, Loader2, MapPin, Phone, X } from "lucide-react";
import { useAuth } from "@/providers/auth-provider";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface Order {
  id: string;
  total: string;
  status: string;
  paymentStatus: string;
  createdAt: string;
  pickupDate: string | null;
  contactPhone: string;
  customer: { name: string; email: string };
  branch: { id: string; name: string; city: string } | null;
  itemCount: number;
}

interface Branch {
  id: string;
  name: string;
  city: string;
}

const STATUS_LABELS: Record<string, string> = {
  pending_payment: "Pending Payment",
  processing: "Processing",
  ready_for_pickup: "Ready for Pickup",
  completed: "Completed",
  cancelled: "Cancelled",
  failed_payment: "Payment Failed",
};

const STATUS_BADGES: Record<string, string> = {
  pending_payment:
    "bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-100",
  processing: "bg-blue-100 text-blue-700 border-blue-200 hover:bg-blue-100",
  ready_for_pickup:
    "bg-violet-100 text-violet-700 border-violet-200 hover:bg-violet-100",
  completed: "bg-green-100 text-green-700 border-green-200 hover:bg-green-100",
  cancelled: "bg-red-100 text-red-700 border-red-200 hover:bg-red-100",
  failed_payment:
    "bg-orange-100 text-orange-700 border-orange-200 hover:bg-orange-100",
};

const PAYMENT_BADGES: Record<string, string> = {
  pending:
    "bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-100",
  paid: "bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-100",
  failed: "bg-red-100 text-red-700 border-red-200 hover:bg-red-100",
};

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

// Local YYYY-MM-DD for <input type="date"> defaults (today).
function todayLocalISO(): string {
  const d = new Date();
  const tzOffset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tzOffset).toISOString().slice(0, 10);
}

// Build a windowed page list around the current page (max 5 consecutive),
// with first/last + ellipsis when the range is far from the edges.
function getPageRange(current: number, total: number): (number | "...")[] {
  if (total <= 1) return total === 1 ? [1] : [];
  const max = 5;
  let start = Math.max(1, current - 2);
  const end = Math.min(total, start + max - 1);
  start = Math.max(1, end - max + 1);

  const pages: (number | "...")[] = [];
  if (start > 1) {
    pages.push(1);
    if (start > 2) pages.push("...");
  }
  for (let i = start; i <= end; i++) pages.push(i);
  if (end < total) {
    if (end < total - 1) pages.push("...");
    pages.push(total);
  }
  return pages;
}

export default function AdminOrdersPage() {
  const router = useRouter();
  const { hasPermission } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("all");
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [branchFilter, setBranchFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [orderFrom, setOrderFrom] = useState(todayLocalISO);
  const [orderTo, setOrderTo] = useState(todayLocalISO);
  const [pickupFrom, setPickupFrom] = useState("");
  const [pickupTo, setPickupTo] = useState("");
  const [userRole, setUserRole] = useState<string>("admin");
  const [userBranchId, setUserBranchId] = useState<string | null>(null);

  // Fetch current user's role/branch
  useEffect(() => {
    async function fetchSession() {
      try {
        const res = await fetch("/api/auth/getSession");
        const data = await res.json();
        if (data?.user) {
          setUserRole(data.user.role || "admin");
          setUserBranchId(data.user.branchId || null);
        }
      } catch {
        // ignore
      }
    }
    fetchSession();
  }, []);

  const isHQ = userRole === "hq";

  // Fetch branches for HQ filter
  useEffect(() => {
    if (!isHQ) return;
    async function fetchBranches() {
      try {
        const res = await fetch("/api/admin/branches");
        const data = await res.json();
        if (data.success) setBranches(data.data);
      } catch {
        // ignore
      }
    }
    fetchBranches();
  }, [isHQ]);

  // Debounce the search input into the query used for fetching (500ms).
  // Separating input from the fetched query avoids an immediate fetch on
  // every keystroke (the previous impl. double-fired via the useCallback dep).
  useEffect(() => {
    const t = setTimeout(() => {
      setSearchQuery(searchInput);
      setPage(1);
    }, 500);
    return () => clearTimeout(t);
  }, [searchInput]);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (activeTab !== "all") params.set("status", activeTab);
      if (isHQ && branchFilter !== "all") params.set("branchId", branchFilter);
      if (searchQuery) params.set("search", searchQuery);
      if (orderFrom) params.set("from", orderFrom);
      if (orderTo) params.set("to", orderTo);
      if (pickupFrom) params.set("pickupFrom", pickupFrom);
      if (pickupTo) params.set("pickupTo", pickupTo);
      params.set("page", String(page));
      params.set("limit", String(limit));

      const res = await fetch(`/api/admin/orders?${params.toString()}`);
      const data = await res.json();
      if (data.success) {
        setOrders(data.data);
        setTotalPages(data.pagination?.totalPages || 1);
        setTotalItems(data.pagination?.total || 0);
      }
    } catch (error) {
      console.error("Error fetching orders:", error);
    } finally {
      setLoading(false);
    }
  }, [
    activeTab,
    branchFilter,
    searchQuery,
    page,
    limit,
    isHQ,
    orderFrom,
    orderTo,
    pickupFrom,
    pickupTo,
  ]);

  // Fetch on filter/tab/page change
  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  // 30s polling — only on relevant tabs and when tab is visible
  useEffect(() => {
    if (
      activeTab !== "pending_payment" &&
      activeTab !== "ready_for_pickup" &&
      activeTab !== "failed_payment" &&
      activeTab !== "all"
    )
      return;

    const interval = setInterval(() => {
      if (document.visibilityState === "visible") {
        fetchOrders();
      }
    }, 30000);

    return () => clearInterval(interval);
  }, [activeTab, fetchOrders]);

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("id-ID", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  };

  const hasDateFilter =
    !!orderFrom || !!orderTo || !!pickupFrom || !!pickupTo;

  const clearDateFilters = () => {
    setOrderFrom("");
    setOrderTo("");
    setPickupFrom("");
    setPickupTo("");
    setPage(1);
  };

  const pageRange = getPageRange(page, totalPages);
  const fromItem = totalItems === 0 ? 0 : (page - 1) * limit + 1;
  const toItem = Math.min(page * limit, totalItems);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">Orders</h2>
        {!isHQ && userBranchId && (
          <Badge variant="secondary" className="gap-1">
            <MapPin className="h-3 w-3" /> Your Branch Only
          </Badge>
        )}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Order List</CardTitle>
          <CardDescription>
            Monitor and manage customer orders. Pickup-in-store model.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Filters */}
          <div className="flex flex-col gap-4 mb-6">
            <div className="flex flex-col md:flex-row gap-4 justify-between">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search order ID, customer name, phone..."
                  className="pl-8"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                />
              </div>
              {isHQ && (
                <Select
                  value={branchFilter}
                  onValueChange={(v) => {
                    setBranchFilter(v);
                    setPage(1);
                  }}
                >
                  <SelectTrigger className="w-[200px]">
                    <SelectValue placeholder="All branches" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Branches</SelectItem>
                    {branches.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* Date filters */}
            <div className="flex flex-col lg:flex-row gap-4 lg:items-end">
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium text-muted-foreground">
                  Order Date
                </span>
                <div className="flex items-center gap-2">
                  <Input
                    type="date"
                    className="w-[160px]"
                    value={orderFrom}
                    onChange={(e) => {
                      setOrderFrom(e.target.value);
                      setPage(1);
                    }}
                  />
                  <span className="text-xs text-muted-foreground">to</span>
                  <Input
                    type="date"
                    className="w-[160px]"
                    value={orderTo}
                    onChange={(e) => {
                      setOrderTo(e.target.value);
                      setPage(1);
                    }}
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium text-muted-foreground">
                  Pickup Date
                </span>
                <div className="flex items-center gap-2">
                  <Input
                    type="date"
                    className="w-[160px]"
                    value={pickupFrom}
                    onChange={(e) => {
                      setPickupFrom(e.target.value);
                      setPage(1);
                    }}
                  />
                  <span className="text-xs text-muted-foreground">to</span>
                  <Input
                    type="date"
                    className="w-[160px]"
                    value={pickupTo}
                    onChange={(e) => {
                      setPickupTo(e.target.value);
                      setPage(1);
                    }}
                  />
                </div>
              </div>

              {hasDateFilter && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1 text-muted-foreground"
                  onClick={clearDateFilters}
                >
                  <X className="h-3.5 w-3.5" /> Clear dates
                </Button>
              )}
            </div>
          </div>

          {/* Status tabs */}
          <Tabs
            value={activeTab}
            onValueChange={(v) => {
              setActiveTab(v);
              setPage(1);
            }}
            className="w-full"
          >
            <TabsList className="mb-4">
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="pending_payment">Pending Payment</TabsTrigger>
              <TabsTrigger value="processing">Processing</TabsTrigger>
              <TabsTrigger value="ready_for_pickup">Ready for Pickup</TabsTrigger>
              <TabsTrigger value="completed">Completed</TabsTrigger>
              <TabsTrigger value="cancelled">Cancelled</TabsTrigger>
              <TabsTrigger value="failed_payment">Payment Failed</TabsTrigger>
            </TabsList>

            {loading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[120px]">Order ID</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Contact Phone</TableHead>
                      <TableHead>Branch</TableHead>
                      <TableHead>Order Date</TableHead>
                      <TableHead>Pickup Date</TableHead>
                      <TableHead className="text-center">Items</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Payment</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {orders.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={11} className="h-24 text-center">
                          No orders found.
                        </TableCell>
                      </TableRow>
                    ) : (
                      orders.map((order) => (
                        <TableRow key={order.id}>
                          <TableCell className="font-mono text-xs">
                            {order.id.slice(0, 8)}...
                          </TableCell>
                          <TableCell>
                            <div className="font-medium">
                              {order.customer.name}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {order.customer.email}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5 text-sm">
                              <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                              {order.contactPhone}
                            </div>
                          </TableCell>
                          <TableCell>
                            {order.branch ? (
                              <div className="text-sm">
                                {order.branch.name}
                                <div className="text-xs text-muted-foreground">
                                  {order.branch.city}
                                </div>
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-sm">
                            {formatDate(order.createdAt)}
                          </TableCell>
                          <TableCell className="text-sm">
                            {order.pickupDate ? (
                              formatDate(order.pickupDate)
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-center">
                            {order.itemCount}
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            Rp {parseFloat(order.total).toLocaleString("id-ID")}
                          </TableCell>
                          <TableCell>
                            <Badge
                              className={STATUS_BADGES[order.status]}
                            >
                              {STATUS_LABELS[order.status] || order.status}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge
                              className={PAYMENT_BADGES[order.paymentStatus]}
                            >
                              {order.paymentStatus}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  className="h-8 w-8 p-0"
                                >
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuLabel>Actions</DropdownMenuLabel>
                                <DropdownMenuItem
                                  className="cursor-pointer gap-2"
                                  onSelect={() =>
                                    router.push(`/admin/orders/${order.id}`)
                                  }
                                >
                                  <Eye className="h-4 w-4" /> View Detail
                                </DropdownMenuItem>
                                {hasPermission("orders", "edit") && (
                                  <DropdownMenuItem
                                    className="cursor-pointer gap-2"
                                    onSelect={() =>
                                      router.push(`/admin/orders/${order.id}?verify=1`)
                                    }
                                  >
                                    <MapPin className="h-4 w-4" /> Verifikasi Pickup
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
            )}
          </Tabs>

          {/* Pagination */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mt-4">
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <span>
                {totalItems > 0
                  ? `Showing ${fromItem}–${toItem} of ${totalItems}`
                  : "No results"}
              </span>
              <div className="flex items-center gap-2">
                <span>Rows per page</span>
                <Select
                  value={String(limit)}
                  onValueChange={(v) => {
                    setLimit(Number(v));
                    setPage(1);
                  }}
                >
                  <SelectTrigger className="h-8 w-[72px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAGE_SIZE_OPTIONS.map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(1)}
                  disabled={page <= 1}
                >
                  First
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(Math.max(1, page - 1))}
                  disabled={page <= 1}
                >
                  Previous
                </Button>
                {pageRange.map((p, idx) =>
                  p === "..." ? (
                    <span
                      key={`ellipsis-${idx}`}
                      className="px-2 text-muted-foreground"
                    >
                      …
                    </span>
                  ) : (
                    <Button
                      key={p}
                      variant={p === page ? "default" : "outline"}
                      size="sm"
                      className="h-8 w-8 p-0"
                      onClick={() => setPage(p)}
                    >
                      {p}
                    </Button>
                  )
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(Math.min(totalPages, page + 1))}
                  disabled={page >= totalPages}
                >
                  Next
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(totalPages)}
                  disabled={page >= totalPages}
                >
                  Last
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}