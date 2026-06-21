import { MapPin, Clock, ExternalLink, BadgeCheck } from "lucide-react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import type { Branch, OperatingHours, DayHours } from "./types";

const DAY_LABELS: { key: keyof OperatingHours; label: string }[] = [
  { key: "monday", label: "Senin" },
  { key: "tuesday", label: "Selasa" },
  { key: "wednesday", label: "Rabu" },
  { key: "thursday", label: "Kamis" },
  { key: "friday", label: "Jumat" },
  { key: "saturday", label: "Sabtu" },
  { key: "sunday", label: "Minggu" },
];

function formatHours(h: DayHours | undefined): string {
  if (!h) return "Libur";
  return `${h.open} - ${h.close}`;
}

export default function BranchCard({ branch }: { branch: Branch }) {
  const mapsUrl =
    branch.googleMapsUrl ||
    (branch.latitude && branch.longitude
      ? `https://www.google.com/maps/search/?api=1&query=${branch.latitude},${branch.longitude}`
      : null);

  return (
    <div className="rounded-xl border bg-card text-card-foreground shadow-sm overflow-hidden flex flex-col">
      <div className="bg-primary/5 p-5 border-b">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="bg-primary/10 p-2 rounded-lg mt-0.5">
              <MapPin className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h3 className="font-semibold text-lg leading-tight">
                {branch.name}
              </h3>
              <p className="text-sm text-muted-foreground font-mono">
                {branch.code}
              </p>
            </div>
          </div>
          <Badge variant="default" className="gap-1">
            <BadgeCheck className="h-3 w-3" /> Buka
          </Badge>
        </div>
      </div>

      <div className="p-5 space-y-4 flex-1">
        <div className="space-y-1">
          <p className="text-sm font-medium text-muted-foreground">Alamat</p>
          <p className="text-sm">
            {branch.address}
            <br />
            <span className="text-muted-foreground">{branch.city}</span>
          </p>
        </div>

        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <p className="text-sm font-medium text-muted-foreground">
              Jam Operasional
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-sm pl-6">
            {DAY_LABELS.map(({ key, label }) => (
              <div key={key} className="flex justify-between">
                <span className="text-muted-foreground">{label}</span>
                <span>{formatHours(branch.operatingHours[key])}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {mapsUrl && (
        <div className="p-5 pt-0">
          <a href={mapsUrl} target="_blank" rel="noopener noreferrer">
            <Button variant="outline" className="w-full gap-2">
              <ExternalLink className="h-4 w-4" /> Lihat di Google Maps
            </Button>
          </a>
        </div>
      )}
    </div>
  );
}

export type { Branch, OperatingHours, DayHours };