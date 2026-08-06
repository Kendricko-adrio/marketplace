"use client";

import { useState } from "react";
import Link from "next/link";
import { Bell, BellOff, Volume2, Trash2, CheckCheck, Loader2 } from "lucide-react";
import { useNotifications } from "@/providers/notification-provider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const MAX_DROPDOWN_ITEMS = 10;

export default function NotificationBell() {
  const {
    notifications,
    unreadCount,
    isMuted,
    toggleMute,
    markAllRead,
    deleteNotification,
  } = useNotifications();
  const [open, setOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen && unreadCount > 0) {
      // User decision: opening the bell marks all in-scope notifications as read.
      markAllRead();
    }
  };

  const recentNotifications = notifications.slice(0, MAX_DROPDOWN_ITEMS);

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    await deleteNotification(id);
    setDeletingId(null);
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="Notifications">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <Badge
              variant="destructive"
              className="absolute -right-1 -top-1 h-5 min-w-[1.25rem] px-1.5 text-xs flex items-center justify-center"
            >
              {unreadCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h4 className="font-semibold text-sm">Notifikasi</h4>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={toggleMute}
              title={isMuted ? "Nyalakan suara" : "Matikan suara"}
            >
              {isMuted ? (
                <BellOff className="h-4 w-4" />
              ) : (
                <Volume2 className="h-4 w-4" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => markAllRead()}
              title="Tandai semua dibaca"
            >
              <CheckCheck className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="max-h-80 overflow-y-auto">
          {recentNotifications.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              Belum ada notifikasi.
            </div>
          ) : (
            <ul className="divide-y">
              {recentNotifications.map((n) => (
                <li
                  key={n.id}
                  className={cn(
                    "flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/50",
                    !n.isRead && "bg-muted/30"
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <Link
                      href={`/admin/orders/${n.orderId}`}
                      className="block text-sm font-medium hover:underline"
                      onClick={() => setOpen(false)}
                    >
                      {n.title}
                    </Link>
                    {n.message && (
                      <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                        {n.message}
                      </p>
                    )}
                    <p className="mt-1 text-xs text-muted-foreground">
                      {new Date(n.createdAt).toLocaleString("id-ID", {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => handleDelete(n.id)}
                    disabled={deletingId === n.id}
                  >
                    {deletingId === n.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Trash2 className="h-3 w-3" />
                    )}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-t p-2">
          <Link href="/admin/notifications" passHref>
            <Button
              variant="ghost"
              className="w-full justify-center text-xs"
              onClick={() => setOpen(false)}
            >
              Lihat semua notifikasi
            </Button>
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
