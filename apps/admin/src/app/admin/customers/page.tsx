import { CheckCircle2, Clock3, ShoppingBag, UsersRound } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { getStatusTone } from "@marketplace/ui/src/lib/status-presentation";
import { getStatusToneClassName } from "@marketplace/ui/src/lib/status-styles";
import { getCustomerSummary } from "@/features/customers/customer-list-repository";
import { CustomerTable } from "./customer-table";

export default async function CustomersPage() {
  const { registered, onboarded, pending, totalOrders } = await getCustomerSummary();

  const summary = [
    {
      label: "Registered customers",
      value: registered,
      icon: UsersRound,
      tone: "bg-sky-50 text-sky-700",
    },
    {
      label: "Onboarding completed",
      value: onboarded,
      icon: CheckCircle2,
      tone: getStatusToneClassName(getStatusTone("onboarding", "completed")),
      statusTone: getStatusTone("onboarding", "completed"),
    },
    {
      label: "Pending onboarding",
      value: pending,
      icon: Clock3,
      tone: getStatusToneClassName(getStatusTone("onboarding", "pending")),
      statusTone: getStatusTone("onboarding", "pending"),
    },
    {
      label: "Total orders",
      value: totalOrders,
      icon: ShoppingBag,
      tone: "bg-violet-50 text-violet-700",
    },
  ];

  return (
    <div className="space-y-7">
      <div>
        <p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
          Customer directory
        </p>
        <h2 className="text-3xl font-bold tracking-tight">Customer</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          View every customer registered on the storefront and open their
          purchase history.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {summary.map(({ label, value, icon: Icon, tone, statusTone }) => (
          <Card key={label} className="overflow-hidden">
            <CardContent className="flex items-center justify-between p-5">
              <div>
                <p className="text-sm text-muted-foreground">{label}</p>
                <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
              </div>
              <div
                className={`rounded-xl p-3 ${tone}`}
                data-status-tone={statusTone}
              >
                <Icon className="h-5 w-5" aria-hidden />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Daftar Customer</CardTitle>
          <CardDescription>
            Lihat profil customer dan riwayat pembelian.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CustomerTable />
        </CardContent>
      </Card>
    </div>
  );
}
