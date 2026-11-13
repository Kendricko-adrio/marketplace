"use client";

import { useId, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  MapPin,
  PackageCheck,
  Truck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  getCustomerTrackingDetail,
  getTrackingStatusLabel,
  newestTrackingEvents,
} from "@/lib/order-tracking-presentation";
import type { OrderDetail } from "./order-detail-types";
import { formatTrackingTime } from "./order-detail-format";
import { useCopyFeedback } from "./use-copy-feedback";

const INITIAL_EVENT_COUNT = 4;

/**
 * Panel pemenuhan delivery: alamat pengiriman + panel tracking. Hanya membaca
 * DTO GET existing; tidak ada provider call, polling, atau mutasi status.
 */
export function OrderFulfillmentPanel({
  shipment,
  deliverySnapshot,
}: {
  shipment: OrderDetail["shipment"];
  deliverySnapshot: OrderDetail["deliverySnapshot"];
}) {
  const [showAllEvents, setShowAllEvents] = useState(false);
  const { feedback, copy } = useCopyFeedback();
  const historyId = useId();

  const events = shipment ? newestTrackingEvents(shipment.timeline) : [];
  const visibleEvents = showAllEvents
    ? events
    : events.slice(0, INITIAL_EVENT_COUNT);

  return (
    <div className="flex flex-col gap-6 lg:grid lg:grid-cols-3 lg:items-start">
      {/* Mobile: tracking dulu, lalu alamat. Desktop: alamat kiri, tracking kanan. */}
      <Card
        className="order-1 lg:order-2 lg:col-span-2"
        role="region"
        aria-label="Lacak paket"
      >
        <CardHeader className="pb-3">
          <h2 className="flex items-center gap-2 text-base font-semibold leading-none tracking-tight">
            <Truck className="h-5 w-5 text-primary" aria-hidden />
            Lacak paket
          </h2>
        </CardHeader>
        <CardContent className="space-y-5 text-sm">
          {shipment ? (
            <>
              {deliverySnapshot && (
                <p className="text-muted-foreground">
                  Layanan {deliverySnapshot.service.name}
                </p>
              )}

              <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <span className="text-muted-foreground">Nomor resi</span>
                  <span className="break-all font-mono font-semibold">
                    {shipment.awb}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => copy(shipment.awb, "Resi disalin")}
                  >
                    <Copy aria-hidden />
                    Salin resi
                  </Button>
                </div>
                {shipment.trackingUrl ? (
                  <Button variant="default" size="sm" asChild>
                    <a
                      href={shipment.trackingUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Lacak di situs kurir
                      <ExternalLink aria-hidden />
                      <span className="sr-only"> (terbuka di tab baru)</span>
                    </a>
                  </Button>
                ) : (
                  <p className="text-muted-foreground">
                    Tautan pelacakan belum tersedia. Anda dapat menggunakan
                    nomor resi di situs kurir.
                  </p>
                )}
                <p role="status" aria-live="polite" className="text-xs">
                  {feedback && (
                    <span
                      className={
                        feedback.ok ? "text-green-700" : "text-destructive"
                      }
                    >
                      {feedback.message}
                    </span>
                  )}
                </p>
              </div>

              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <PackageCheck className="h-5 w-5" aria-hidden />
                </div>
                <div className="min-w-0 space-y-1">
                  <p className="text-base font-semibold">
                    {getTrackingStatusLabel(shipment.latestStatus)}
                  </p>
                  {shipment.delivered && shipment.deliveredAt && (
                    <p className="text-muted-foreground">
                      Diterima {formatTrackingTime(shipment.deliveredAt)}
                    </p>
                  )}
                </div>
              </div>

              <Separator />

              <div className="space-y-4">
                <h3 className="font-semibold">Riwayat pengiriman</h3>
                {events.length === 0 ? (
                  <p className="text-muted-foreground">
                    Riwayat pengiriman belum tersedia.
                  </p>
                ) : (
                  <ol id={historyId} className="space-y-4">
                    {visibleEvents.map((event, index) => {
                      const label = getTrackingStatusLabel(event.status);
                      const detail = getCustomerTrackingDetail(event.detail);
                      const isLatest = index === 0;
                      return (
                        <li
                          key={`${event.status ?? "event"}-${event.at ?? "no-time"}-${index}`}
                          className="flex gap-3"
                        >
                          <span
                            aria-hidden
                            className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${
                              isLatest
                                ? "bg-primary ring-2 ring-primary/20"
                                : "border border-muted-foreground/60"
                            }`}
                          />
                          <div className="min-w-0 space-y-1">
                            <div className="flex flex-col gap-1 lg:flex-row lg:flex-wrap lg:items-center lg:gap-x-2">
                              <time
                                dateTime={event.at ?? undefined}
                                className="text-xs text-muted-foreground"
                              >
                                {formatTrackingTime(event.at)}
                              </time>
                              <p className="font-medium">{label}</p>
                              {isLatest && (
                                <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
                                  <Check className="h-3 w-3" aria-hidden />
                                  Terbaru
                                </span>
                              )}
                            </div>
                            {detail && (
                              <p className="break-words text-muted-foreground">
                                {detail}
                              </p>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                )}
                {events.length > INITIAL_EVENT_COUNT && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowAllEvents((value) => !value)}
                    aria-expanded={showAllEvents}
                    aria-controls={historyId}
                  >
                    {showAllEvents
                      ? "Tampilkan lebih sedikit"
                      : "Lihat semua riwayat"}
                    {showAllEvents ? (
                      <ChevronUp aria-hidden />
                    ) : (
                      <ChevronDown aria-hidden />
                    )}
                  </Button>
                )}
              </div>

              {shipment.podUrl && (
                <Button variant="outline" size="sm" asChild>
                  <a href={shipment.podUrl} target="_blank" rel="noreferrer">
                    Lihat bukti pengiriman
                    <ExternalLink aria-hidden />
                    <span className="sr-only"> (terbuka di tab baru)</span>
                  </a>
                </Button>
              )}
            </>
          ) : (
            <div className="space-y-1 rounded-lg border bg-muted/30 p-4">
              <p className="font-medium">Resi belum tersedia</p>
              <p className="text-muted-foreground">
                Informasi pelacakan akan tampil setelah resi tersedia.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card
        className="order-2 lg:order-1 lg:col-span-1"
        role="region"
        aria-label="Alamat pengiriman"
      >
        <CardHeader className="pb-3">
          <h2 className="flex items-center gap-2 text-base font-semibold leading-none tracking-tight">
            <MapPin className="h-5 w-5 text-primary" aria-hidden />
            Alamat pengiriman
          </h2>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {deliverySnapshot ? (
            <>
              <div className="space-y-1">
                <p className="font-medium">
                  {deliverySnapshot.address.recipientName}
                </p>
                <p className="text-muted-foreground">
                  {deliverySnapshot.address.phone}
                </p>
              </div>
              <p className="break-words">
                {deliverySnapshot.address.fullAddress}
              </p>
              <p className="break-words text-muted-foreground">
                {deliverySnapshot.address.province} ·{" "}
                {deliverySnapshot.address.city} ·{" "}
                {deliverySnapshot.address.district} ·{" "}
                {deliverySnapshot.address.area} · Kode pos{" "}
                {deliverySnapshot.address.postalCode}
              </p>
              <div className="space-y-1 border-t pt-4">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Dikirim dari
                </p>
                <p className="font-medium">{deliverySnapshot.origin.name}</p>
              </div>
            </>
          ) : (
            <p className="text-muted-foreground">
              Detail alamat pengiriman tidak tersedia.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
