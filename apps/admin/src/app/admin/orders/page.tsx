"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Eye, Search, MoreHorizontal, Loader2, MapPin } from "lucide-react";
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
};

const STATUS_BADGES: Record<string, string> = {
  pending_payment:
    "bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-100",
  processing: "bg-blue-100 text-blue-700 border-blue-200 hover:bg-blue-100",
  ready_for_pickup:
    "bg-violet-100 text-violet-700 border-violet-200 hover:bg-violet-100",
  completed: "bg-green-100 text-green-700 border-green-200 hover:bg-green-100",
  cancelled: "bg-red-100 text-red-700 border-red-200 hover:bg-red-100",
};

const PAYMENT_BADGES: Record<string, string> = {
  pending:
    "bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-100",
  paid: "bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-100",
  failed: "bg-red-100 text-red-700 border-red-200 hover:bg-red-100",
};

export default function AdminOrdersPage() {
  const router = useRouter();
  const { hasPermission } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [branchFilter, setBranchFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [userRole, setUserRole] = useState<string>("admin");
  const [userBranchId, setUserBranchId] = useState<string | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (activeTab !== "all") params.set("status", activeTab);
      if (isHQ && branchFilter !== "all") params.set("branchId", branchFilter);
      if (searchQuery) params.set("search", searchQuery);
      params.set("page", String(page));
      params.set("limit", "20");

      const res = await fetch(`/api/admin/orders?${params.toString()}`);
      const data = await res.json();
      if (data.success) {
        setOrders(data.data);
        setTotalPages(data.pagination?.totalPages || 1);
      }
    } catch (error) {
      console.error("Error fetching orders:", error);
    } finally {
      setLoading(false);
    }
  }, [activeTab, branchFilter, searchQuery, page, isHQ]);

  // Fetch on filter/tab/page change
  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  // Debounced search
  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    setPage(1);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => fetchOrders(), 1000);
  };

  // 30s polling — only on relevant tabs and when tab is visible
  useEffect(() => {
    if (activeTab !== "pending_payment" && activeTab !== "ready_for_pickup" && activeTab !== "all") return;

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
          <div className="flex flex-col md:flex-row gap-4 mb-6 justify-between">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search order ID, customer name..."
                className="pl-8"
                value={searchQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
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
                      <TableHead>Branch</TableHead>
                      <TableHead>Date</TableHead>
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
                        <TableCell colSpan={9} className="h-24 text-center">
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
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <span className="text-sm text-muted-foreground">
                Page {page} of {totalPages}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(Math.max(1, page - 1))}
                  disabled={page <= 1}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(Math.min(totalPages, page + 1))}
                  disabled={page >= totalPages}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}