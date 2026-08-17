"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import type { NotificationListItem } from "@/lib/notifications";

interface NotificationContextValue {
  notifications: NotificationListItem[];
  unreadCount: number;
  isMuted: boolean;
  toggleMute: () => void;
  markAllRead: () => Promise<void>;
  deleteNotification: (id: string) => Promise<void>;
  clearRead: () => Promise<void>;
}

const NotificationContext = createContext<NotificationContextValue>({
  notifications: [],
  unreadCount: 0,
  isMuted: false,
  toggleMute: () => {},
  markAllRead: async () => {},
  deleteNotification: async () => {},
  clearRead: async () => {},
});

const MUTE_STORAGE_KEY = "marketplace:notification:mute";
const MAX_RECENT = 10;

// Single reusable HTMLAudioElement so repeat notifications don't pile up
// Audio elements and we get fast replay without re-fetching the file.
let notificationAudio: HTMLAudioElement | null = null;
// Browsers block HTMLMediaElement.play() until the page has received a user
// gesture. We "unlock" the element on the first pointer/keyboard interaction
// by playing it silently; after that, programmatic play() from the poll
// callback is allowed. Without this, play() rejects with NotAllowedError and
// (since we swallow it) the sound never plays.
let audioUnlocked = false;

function ensureAudio(): HTMLAudioElement | null {
  if (typeof window === "undefined") return null;
  if (!notificationAudio) {
    notificationAudio = new Audio("/sounds/notification.mp3");
    notificationAudio.preload = "auto";
    // Soft volume so it's gentle rather than startling.
    notificationAudio.volume = 0.35;
  }
  return notificationAudio;
}

function unlockAudio() {
  if (audioUnlocked) return;
  const audio = ensureAudio();
  if (!audio) return;
  audioUnlocked = true;
  // Play muted to consume the user gesture, then reset for real playback.
  const prevVolume = audio.volume;
  audio.volume = 0;
  const p = audio.play();
  if (p && typeof p.then === "function") {
    p.then(() => {
      audio.pause();
      audio.currentTime = 0;
      audio.volume = prevVolume;
    }).catch(() => {
      // Gesture didn't unlock (rare); we'll retry on the next interaction.
      audioUnlocked = false;
      audio.volume = prevVolume;
    });
  } else {
    audio.volume = prevVolume;
  }
}

function playNotificationSound() {
  const audio = ensureAudio();
  if (!audio) return;
  try {
    // Rewind so rapid successive notifications still play in full.
    audio.currentTime = 0;
    const playPromise = audio.play();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch((err) => {
        // If still locked (no gesture yet), the unlock listener will fix it
        // on the next interaction; log so it's debuggable instead of silent.
        console.warn("[notifications] sound play() blocked:", err?.name ?? err);
      });
    }
  } catch (err) {
    console.warn("[notifications] sound error:", err);
  }
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<NotificationListItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  // Bumped to restart the long-poll loop (e.g. after markAllRead, so an
  // in-flight response captured before the DB update can't overwrite the
  // fresh unread count with a stale one).
  const [pollEpoch, setPollEpoch] = useState(0);
  const sinceRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Track every notification id we've already delivered to this session so a
  // server-side re-delivery (race between catch-up and LISTEN/NOTIFY, or a
  // reconnecting listener re-emitting) can't replay the sound. The sound is
  // keyed off THIS set, not off the raw server response length.
  const deliveredIdsRef = useRef<Set<string>>(new Set());
  const MAX_DELIVERED_IDS = 500;

  useEffect(() => {
    if (typeof window === "undefined") return;
    setIsMuted(window.localStorage.getItem(MUTE_STORAGE_KEY) === "true");
  }, []);

  // Unlock audio on the first user gesture so programmatic play() from the
  // poll callback is allowed by the browser's autoplay policy.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const opts: AddEventListenerOptions = { once: true };
    const unlock = () => unlockAudio();
    window.addEventListener("pointerdown", unlock, opts);
    window.addEventListener("keydown", unlock, opts);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  const toggleMute = useCallback(() => {
    const next = !isMuted;
    setIsMuted(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(MUTE_STORAGE_KEY, String(next));
    }
  }, [isMuted]);

  // Keep document title in sync with unread count.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const originalTitle = document.title || "Admin Dashboard";
    if (unreadCount > 0) {
      document.title = `(${unreadCount}) ${originalTitle}`;
    } else {
      document.title = originalTitle;
    }
    return () => {
      document.title = originalTitle;
    };
  }, [unreadCount]);

  const prependNotifications = useCallback(
    (incoming: NotificationListItem[]) => {
      if (incoming.length === 0) return;
      setNotifications((prev) => {
        const seen = new Set(prev.map((n) => n.id));
        const fresh = incoming.filter((n) => !seen.has(n.id));
        const combined = [...fresh, ...prev];
        return combined.slice(0, MAX_RECENT);
      });
    },
    []
  );

  // Long-polling loop.
  useEffect(() => {
    if (typeof window === "undefined") return;

    let cancelled = false;

    async function loop() {
      while (!cancelled) {
        const abort = new AbortController();
        abortRef.current = abort;

        try {
          const params = new URLSearchParams();
          if (sinceRef.current) {
            params.set("since", sinceRef.current);
          }
          const res = await fetch(
            `/api/admin/notifications/poll?${params.toString()}`,
            { signal: abort.signal }
          );
          if (cancelled || abort.signal.aborted) return;

          if (!res.ok) {
            // Back off briefly on error to avoid hammering the server.
            await new Promise((resolve) => setTimeout(resolve, 3000));
            continue;
          }

          const payload = (await res.json()) as {
            success: boolean;
            data?: NotificationListItem[];
            unreadCount?: number;
            serverNow?: string;
          };

          if (payload.success) {
            const newItems = payload.data ?? [];
            const newUnreadCount = payload.unreadCount ?? 0;

            // Dedupe by id BEFORE playing any sound. The server can re-deliver
            // the same notification (catch-up vs LISTEN/NOTIFY race, or a
            // reconnecting listener re-emitting). Without this guard the sound
            // would loop even though the visible list only shows the item once.
            const delivered = deliveredIdsRef.current;
            const fresh = newItems.filter((n) => !delivered.has(n.id));

            if (fresh.length > 0) {
              for (const n of fresh) delivered.add(n.id);
              // Cap the set so it can't grow without bound over a long session.
              if (delivered.size > MAX_DELIVERED_IDS) {
                    const overflow = delivered.size - MAX_DELIVERED_IDS;
                    const it = delivered.values();
                    for (let i = 0; i < overflow; i++) delivered.delete(it.next().value!);
                  }
              prependNotifications(fresh);
              if (!isMuted) {
                playNotificationSound();
              }
            }

            setUnreadCount(newUnreadCount);
            // Use the server's current time as the next watermark (NOT the
            // latest item's createdAt). serverNow is captured after the items
            // exist, so it is strictly greater than any delivered item's
            // createdAt — the next catch-up excludes those items and the
            // watermark always advances. Using the item's createdAt would pin
            // the watermark at that item (ms-truncated vs µs in DB) and
            // re-deliver it forever. Client-side id dedup still guards sound.
            sinceRef.current = payload.serverNow ?? new Date().toISOString();
          }
        } catch (error) {
          // AbortError is expected when the component unmounts or effect reruns.
          if ((error as Error).name === "AbortError") return;
          console.error("Notification poll error:", error);
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }
      }
    }

    loop();

    return () => {
      cancelled = true;
      abortRef.current?.abort();
    };
  }, [isMuted, prependNotifications, pollEpoch]);

  const markAllRead = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/notifications/mark-all-read", {
        method: "POST",
      });
      if (!res.ok) throw new Error("Failed to mark notifications as read");
      setUnreadCount(0);
      setNotifications((prev) =>
        prev.map((n) => (n.isRead ? n : { ...n, isRead: true, readAt: new Date().toISOString() }))
      );
      // Restart the poll loop from a fresh initial poll: the in-flight
      // response was computed before this DB update and would otherwise
      // overwrite the count we just zeroed with a stale value.
      sinceRef.current = null;
      setPollEpoch((e) => e + 1);
    } catch (error) {
      console.error("markAllRead error:", error);
    }
  }, []);

  const deleteNotification = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/admin/notifications/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete notification");
      setNotifications((prev) => {
        const removed = prev.find((n) => n.id === id);
        if (removed && !removed.isRead) {
          setUnreadCount((count) => Math.max(0, count - 1));
        }
        return prev.filter((n) => n.id !== id);
      });
    } catch (error) {
      console.error("deleteNotification error:", error);
    }
  }, []);

  const clearRead = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/notifications/clear-all-read", {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to clear read notifications");
      setNotifications((prev) => prev.filter((n) => !n.isRead));
    } catch (error) {
      console.error("clearRead error:", error);
    }
  }, []);

  const value: NotificationContextValue = {
    notifications,
    unreadCount,
    isMuted,
    toggleMute,
    markAllRead,
    deleteNotification,
    clearRead,
  };

  return (
    <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>
  );
}

export function useNotifications() {
  return useContext(NotificationContext);
}
