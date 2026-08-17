import { CheckCircle2, Clock3, ShoppingBag, UsersRound } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { getCustomers } from "@/lib/customers";
import { CustomerTable } from "./customer-table";

export default async function CustomersPage() {
  const customers = await getCustomers();
  const onboarded = customers.filter(
    (customer) => customer.onboardingCompleted
  ).length;
  const totalOrders = customers.reduce(
    (total, customer) => total + customer.orderCount,
    0
  );

  const summary = [
    {
      label: "Registered customers",
      value: customers.length,
      icon: UsersRound,
      tone: "bg-sky-50 text-sky-700",
    },
    {
      label: "Onboarding completed",
      value: onboarded,
      icon: CheckCircle2,
      tone: "bg-emerald-50 text-emerald-700",
    },
    {
      label: "Pending onboarding",
      value: customers.length - onboarded,
      icon: Clock3,
      tone: "bg-amber-50 text-amber-700",
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
        {summary.map(({ label, value, icon: Icon, tone }) => (
          <Card key={label} className="overflow-hidden">
            <CardContent className="flex items-center justify-between p-5">
              <div>
                <p className="text-sm text-muted-foreground">{label}</p>
                <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
              </div>
              <div className={`rounded-xl p-3 ${tone}`}>
                <Icon className="h-5 w-5" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="border-b">
          <h3 className="text-lg font-semibold">Customer List</h3>
          <p className="text-sm text-muted-foreground">
            Profile data is collected from registration and onboarding.
          </p>
        </CardHeader>
        <CardContent className="p-6">
          <CustomerTable customers={customers} />
        </CardContent>
      </Card>
    </div>
  );
}
