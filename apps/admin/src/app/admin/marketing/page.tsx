import { Construction } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function AdminMarketingPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">Marketing</h2>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Construction className="h-5 w-5 text-muted-foreground" />
            Segera Hadir
          </CardTitle>
          <CardDescription>
            Alat marketing sedang dalam pengembangan.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Voucher, diskon, dan kampanye promosi akan tersedia di sini
            setelah fitur selesai dikembangkan.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}