"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RefreshCw, LogOut, Loader2, ShieldOff, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useAuth } from "@/providers/auth-provider";
import { signOut } from "@/lib/auth-client";

// =========================================================
// PolicySafeState — No-Access and Policy-Unavailable UI
// =========================================================
// Two distinct safe browser states, driven by the client policy mirror:
//
// - No-Access (`no-access`): the policy RESOLVED but the user holds no view
//   grant at all. Only password recovery and logout are offered — no
//   protected navigation or data.
// - Policy-Unavailable (`unavailable`): the policy refresh FAILED (network
//   or 5xx). Stale policy and protected navigation/data are already cleared
//   by AuthProvider; this state offers retry, password recovery, and logout.
//
// A failed refresh NEVER logs the user out; recovery is explicit.

export function PolicySafeState({ forced }: { forced?: boolean }) {
  const { policyStatus, refreshPolicy } = useAuth();
  const router = useRouter();
  const [retrying, setRetrying] = useState(false);

  const unavailable = policyStatus === "unavailable" || forced === true;

  const handleRetry = async () => {
    setRetrying(true);
    try {
      await refreshPolicy();
      router.refresh();
    } finally {
      setRetrying(false);
    }
  };

  const handleLogout = async () => {
    await signOut({
      fetchOptions: {
        onSuccess: () => {
          router.replace("/login");
          router.refresh();
        },
      },
    });
  };

  return (
    <Card className="w-full max-w-lg" data-testid="safe-state">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {unavailable ? (
            <WifiOff className="h-5 w-5 text-amber-500" />
          ) : (
            <ShieldOff className="h-5 w-5 text-muted-foreground" />
          )}
          {unavailable
            ? "Kebijakan akses tidak dapat dimuat"
            : "Akses tidak tersedia"}
        </CardTitle>
        <CardDescription>
          {unavailable
            ? "Pemuatan ulang kebijakan akses gagal. Tidak ada menu atau data terlindungi yang ditampilkan. Coba lagi, atau gunakan tindakan pemulihan di bawah."
            : "Akun Anda saat ini tidak memiliki izin melihat pada modul mana pun. Hubungi administrator untuk penugasan Role, atau gunakan tindakan pemulihan di bawah."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {unavailable && (
          <Button onClick={handleRetry} disabled={retrying} data-testid="policy-retry">
            {retrying ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Coba muat ulang kebijakan
          </Button>
        )}
        <Button asChild variant="outline">
          <Link href="/forgot-password">Pemulihan kata sandi</Link>
        </Button>
        <Button variant="outline" onClick={handleLogout} data-testid="safe-state-logout">
          <LogOut className="mr-2 h-4 w-4" /> Keluar
        </Button>
      </CardContent>
    </Card>
  );
}