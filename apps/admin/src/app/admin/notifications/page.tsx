"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  CheckCheck,
  Trash2,
  Bell,
  Loader2,
  Send,
  Volume2,
  BellOff,
} from "lucide-react";
import { useNotifications } from "@/providers/notification-provider";
import { useAuth } from "@/providers/auth-provider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
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
import type { NotificationListItem } from "@/lib/notifications";

const STATUS_BADGES: Record<string, string> = {
  pending_payment: "bg-amber-100 text-amber-700",
  processing: "bg-blue-100 text-blue-700",
  ready_for_pickup: "bg-violet-100 text-violet-700",
  completed: "bg-green-100 text-green-700",
  cancelled: "bg-red-100 text-red-700",
  failed_payment: "bg-orange-100 text-orange-700",
};

const STATUS_LABELS: Record<string, string> = {
  pending_payment: "Pending Payment",
  processing: "Processing",
  ready_for_pickup: "Ready for Pickup",
  completed: "Completed",
  cancelled: "Cancelled",
  failed_payment: "Payment Failed",
};

export default function NotificationsPage() {
  const { isHQ } = useAdminInfo();
  const {
    notifications: liveNotifications,
    unreadCount,
    markAllRead,
    deleteNotification,
    clearRead,
    isMuted,
    toggleMute,
  } = useNotifications();
  const [filter, setFilter] = useState<"all" | "read" | "unread">("all");
  const [items, setItems] = useState<NotificationListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [actionId, setActionId] = useState<string | null>(null);

  // User decision: opening the notifications page marks all in-scope as read.
  useEffect(() => {
    markAllRead();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("isRead", filter);
      params.set("page", String(page));
      params.set("limit", "20");
      const res = await fetch(`/api/admin/notifications?${params.toString()}`);
      const data = await res.json();
      if (data.success) {
        setItems(data.data);
        setTotalPages(data.pagination?.totalPages || 1);
      }
    } catch (error) {
      console.error("Failed to fetch notifications:", error);
    } finally {
      setLoading(false);
    }
  }, [filter, page]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  // Merge live updates into the list so new notifications appear without a full refetch.
  useEffect(() => {
    if (liveNotifications.length === 0) return;
    setItems((prev) => {
      const seen = new Set(prev.map((n) => n.id));
      const fresh = liveNotifications.filter((n) => !seen.has(n.id));
      if (fresh.length === 0) return prev;
      const combined = [...fresh, ...prev];
      // Re-sort by createdAt desc just in case.
      combined.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      return combined.slice(0, 100);
    });
  }, [liveNotifications]);

  const handleMarkAllRead = async () => {
    await markAllRead();
    setItems((prev) =>
      prev.map((n) => (n.isRead ? n : { ...n, isRead: true, readAt: new Date().toISOString() }))
    );
  };

  const handleMarkRead = async (id: string) => {
    setActionId(id);
    try {
      const res = await fetch(`/api/admin/notifications/${id}`, {
        method: "PATCH",
      });
      if (res.ok) {
        setItems((prev) =>
          prev.map((n) =>
            n.id === id ? { ...n, isRead: true, readAt: new Date().toISOString() } : n
          )
        );
      }
    } catch (error) {
      console.error("Failed to mark read:", error);
    } finally {
      setActionId(null);
    }
  };

  const handleDelete = async (id: string) => {
    setActionId(id);
    await deleteNotification(id);
    setItems((prev) => prev.filter((n) => n.id !== id));
    setActionId(null);
  };

  const handleClearRead = async () => {
    await clearRead();
    setItems((prev) => prev.filter((n) => !n.isRead));
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Bell className="h-6 w-6" /> Notifikasi
          </h2>
          <p className="text-sm text-muted-foreground">
            Pantau order yang sudah dibayar secara real-time.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={toggleMute}>
            {isMuted ? (
              <><BellOff className="h-4 w-4 mr-2" /> Bunyikan</>
            ) : (
              <><Volume2 className="h-4 w-4 mr-2" /> Senyapkan</>
            )}
          </Button>
          <Button variant="outline" size="sm" onClick={handleClearRead}>
            <Trash2 className="h-4 w-4 mr-2" /> Hapus Dibaca
          </Button>
          <Button variant="default" size="sm" onClick={handleMarkAllRead}>
            <CheckCheck className="h-4 w-4 mr-2" /> Tandai Semua Dibaca
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <CardTitle>Daftar Notifikasi</CardTitle>
              <CardDescription>
                {unreadCount > 0
                  ? `${unreadCount} notifikasi belum dibaca`
                  : "Tidak ada notifikasi baru"}
              </CardDescription>
            </div>
            <Select
              value={filter}
              onValueChange={(v) => {
                setFilter(v as "all" | "read" | "unread");
                setPage(1);
              }}
            >
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Filter" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua</SelectItem>
                <SelectItem value="unread">Belum Dibaca</SelectItem>
                <SelectItem value="read">Sudah Dibaca</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              Tidak ada notifikasi.
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Judul</TableHead>
                    {isHQ && <TableHead>Cabang</TableHead>}
                    <TableHead>Order</TableHead>
                    <TableHead>Waktu</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((n) => (
                    <TableRow key={n.id} className={!n.isRead ? "bg-muted/30" : undefined}>
                      <TableCell>
                        <div className="font-medium">{n.title}</div>
                        {n.message && (
                          <div className="text-xs text-muted-foreground line-clamp-2 max-w-xs">
                            {n.message}
                          </div>
                        )}
                      </TableCell>
                      {isHQ && (
                        <TableCell>
                          {n.branch ? (
                            <div className="text-sm">
                              {n.branch.name}
                              <div className="text-xs text-muted-foreground">{n.branch.city}</div>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      )}
                      <TableCell>
                        {n.order ? (
                          <div className="text-sm">
                            <Link
                              href={`/admin/orders/${n.orderId}`}
                              className="font-mono hover:underline"
                            >
                              #{n.order.id.slice(0, 8).toUpperCase()}
                            </Link>
                            <div className="text-xs text-muted-foreground">
                              {n.order.customerName}
                            </div>
                            <div className="text-xs font-medium">
                              Rp {parseFloat(n.order.total).toLocaleString("id-ID")}
                            </div>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm whitespace-nowrap">
                        {new Date(n.createdAt).toLocaleString("id-ID", {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </TableCell>
                      <TableCell>
                        {n.order ? (
                          <Badge className={STATUS_BADGES[n.order.status]}>
                            {STATUS_LABELS[n.order.status] || n.order.status}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {!n.isRead && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => handleMarkRead(n.id)}
                              disabled={actionId === n.id}
                              title="Tandai dibaca"
                            >
                              {actionId === n.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <CheckCheck className="h-4 w-4" />
                              )}
                            </Button>
                          )}
                          <Link href={`/admin/orders/${n.orderId}?verify=1`}>
                            <Button variant="ghost" size="icon" className="h-8 w-8" title="Verifikasi pickup">
                              <Send className="h-4 w-4" />
                            </Button>
                          </Link>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={() => handleDelete(n.id)}
                            disabled={actionId === n.id}
                            title="Hapus"
                          >
                            {actionId === n.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

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

function useAdminInfo() {
  const { user } = useAuth();
  const isHQ = user?.role === "hq";
  return { isHQ };
}
