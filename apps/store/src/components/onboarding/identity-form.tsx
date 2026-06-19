"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { completeOnboarding, type OnboardingState } from "@/app/onboarding/actions";

const initialState: OnboardingState = {};

export function IdentityForm() {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState(
    completeOnboarding,
    initialState
  );

  // If onboarding succeeded, the action calls redirect() which throws on the
  // server but we still want to refresh client-side session data.
  useEffect(() => {
    if (state?.success) {
      router.refresh();
    }
  }, [state?.success, router]);

  return (
    <Card className="w-full max-w-lg shadow-lg border-muted/40">
      <CardHeader className="space-y-1">
        <CardTitle className="text-2xl font-bold text-center">
          Lengkapi Identitas Anda
        </CardTitle>
        <CardDescription className="text-center">
          Mohon isi data berikut untuk menyelesaikan pendaftaran. Semua kolom
          wajib diisi.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-5">
          {/* Phone */}
          <div className="space-y-2">
            <Label htmlFor="phone">Nomor Telepon</Label>
            <Input
              id="phone"
              name="phone"
              type="tel"
              placeholder="+628123456789"
              required
              disabled={isPending}
            />
            <p className="text-xs text-muted-foreground">
              Termasuk kode negara. Digunakan untuk notifikasi pesanan.
            </p>
            {state?.errors?.phone && (
              <p className="text-xs text-destructive">
                {state.errors.phone[0]}
              </p>
            )}
          </div>

          {/* Birth date */}
          <div className="space-y-2">
            <Label htmlFor="birthDate">Tanggal Lahir</Label>
            <Input
              id="birthDate"
              name="birthDate"
              type="date"
              required
              disabled={isPending}
            />
            <p className="text-xs text-muted-foreground">
              Anda harus berusia minimal 13 tahun.
            </p>
            {state?.errors?.birthDate && (
              <p className="text-xs text-destructive">
                {state.errors.birthDate[0]}
              </p>
            )}
          </div>

          {/* Gender */}
          <div className="space-y-2">
            <Label>Jenis Kelamin</Label>
            <RadioGroup name="gender" required disabled={isPending}>
              <div className="flex items-center space-x-2">
                <RadioGroupItem id="gender-male" value="male" />
                <Label htmlFor="gender-male" className="font-normal cursor-pointer">
                  Laki-laki
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem id="gender-female" value="female" />
                <Label htmlFor="gender-female" className="font-normal cursor-pointer">
                  Perempuan
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem id="gender-other" value="other" />
                <Label htmlFor="gender-other" className="font-normal cursor-pointer">
                  Lainnya
                </Label>
              </div>
            </RadioGroup>
            {state?.errors?.gender && (
              <p className="text-xs text-destructive">
                {state.errors.gender[0]}
              </p>
            )}
          </div>

          {state?.message && !state.errors && (
            <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-md">
              {state.message}
            </div>
          )}

          <Button type="submit" className="w-full" disabled={isPending}>
            {isPending ? "Menyimpan..." : "Selesaikan Pendaftaran"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}