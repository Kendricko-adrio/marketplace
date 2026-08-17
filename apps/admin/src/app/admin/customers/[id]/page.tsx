import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  Mail,
  Phone,
  ReceiptText,
  ShoppingBag,
  UserRound,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  formatCustomerDate,
  getCustomerInitials,
} from "@/lib/customer-display";
import { getCustomerDetail } from "@/lib/customers";

const STATUS_LABELS: Record<string, string> = {
  pending_payment: "Pending Payment",
  processing: "Processing",
  ready_for_pickup: "Ready for Pickup",
  completed: "Completed",
  cancelled: "Cancelled",
  failed_payment: "Payment Failed",
};

const STATUS_STYLES: Record<string, string> = {
  pending_payment: "border-amber-200 bg-amber-50 text-amber-700",
  processing: "border-blue-200 bg-blue-50 text-blue-700",
  ready_for_pickup: "border-violet-200 bg-violet-50 text-violet-700",
  completed: "border-emerald-200 bg-emerald-50 text-emerald-700",
  cancelled: "border-red-200 bg-red-50 text-red-700",
  failed_payment: "border-orange-200 bg-orange-50 text-orange-700",
};

const GENDER_LABELS: Record<string, string> = {
  male: "Male",
  female: "Female",
  other: "Other",
};

function formatRupiah(value: string | number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(Number(value));
}

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await getCustomerDetail(id);
  if (!detail) notFound();

  const { customer, orders } = detail;
  const totalSpent = orders
    .filter((order) => order.paymentStatus === "paid")
    .reduce((sum, order) => sum + Number(order.total), 0);
  const completedOrders = orders.filter(
    (order) => order.status === "completed"
  ).length;

  const profileFields = [
    { label: "Email", value: customer.email, icon: Mail },
    { label: "Phone", value: customer.phone || "—", icon: Phone },
    {
      label: "Birth date",
      value: formatCustomerDate(customer.birthDate, "date"),
      icon: CalendarDays,
    },
    {
      label: "Gender",
      value: customer.gender
        ? GENDER_LABELS[customer.gender] ?? customer.gender
        : "—",
      icon: UserRound,
    },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-7">
      <Button asChild variant="ghost" size="sm" className="-ml-3 gap-2">
        <Link href="/admin/customers">
          <ArrowLeft className="h-4 w-4" /> Back to customers
        </Link>
      </Button>

      <div className="flex flex-col gap-5 rounded-2xl border bg-card p-6 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Avatar className="h-16 w-16 border-4 border-primary/10">
            <AvatarFallback className="bg-primary text-lg font-bold text-primary-foreground">
              {getCustomerInitials(customer.name)}
            </AvatarFallback>
          </Avatar>
          <div>
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                Customer profile
              </p>
              <Badge
                variant="outline"
                className={
                  customer.onboardingCompleted
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-amber-200 bg-amber-50 text-amber-700"
                }
              >
                {customer.onboardingCompleted
                  ? "Onboarding completed"
                  : "Onboarding pending"}
              </Badge>
            </div>
            <h2 className="text-3xl font-bold tracking-tight">
              {customer.name}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Customer since {formatCustomerDate(customer.createdAt, "date")}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-5 border-t pt-4 text-center sm:border-l sm:border-t-0 sm:pl-6 sm:pt-0">
          <div>
            <p className="text-xl font-bold tabular-nums">{orders.length}</p>
            <p className="text-xs text-muted-foreground">Orders</p>
          </div>
          <div>
            <p className="text-xl font-bold tabular-nums">{completedOrders}</p>
            <p className="text-xs text-muted-foreground">Completed</p>
          </div>
          <div>
            <p className="text-sm font-bold tabular-nums">
              {formatRupiah(totalSpent)}
            </p>
            <p className="text-xs text-muted-foreground">Paid value</p>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[0.85fr_1.5fr]">
        <Card className="h-fit">
          <CardHeader className="border-b">
            <h3 className="text-lg font-semibold">Profile Information</h3>
            <p className="text-sm text-muted-foreground">
              Registration and onboarding details.
            </p>
          </CardHeader>
          <CardContent className="space-y-5 p-6">
            {profileFields.map(({ label, value, icon: Icon }) => (
              <div key={label} className="flex items-start gap-3">
                <div className="rounded-lg bg-muted p-2 text-muted-foreground">
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {label}
                  </p>
                  <p className="mt-0.5 break-words text-sm font-medium">
                    {value}
                  </p>
                </div>
              </div>
            ))}
            <div className="border-t pt-5">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Email verified</span>
                <span className="flex items-center gap-1.5 font-medium">
                  {customer.emailVerified && (
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  )}
                  {customer.emailVerified ? "Verified" : "Not verified"}
                </span>
              </div>
              <div className="mt-3 flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Last updated</span>
                <span className="font-medium">
                  {formatCustomerDate(customer.updatedAt)}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-primary/10 p-2.5 text-primary">
                <ReceiptText className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-lg font-semibold">Order History</h3>
                <p className="text-sm text-muted-foreground">
                  {orders.length} order{orders.length === 1 ? "" : "s"} placed
                  by this customer.
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {orders.length === 0 ? (
              <div className="flex min-h-64 flex-col items-center justify-center gap-3 px-6 text-center text-muted-foreground">
                <ShoppingBag className="h-10 w-10" />
                <div>
                  <p className="font-medium text-foreground">No orders yet</p>
                  <p className="text-sm">
                    This customer has not placed an order.
                  </p>
                </div>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableHead>Order</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Branch</TableHead>
                    <TableHead className="text-center">Items</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-14" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders.map((order) => (
                    <TableRow key={order.id}>
                      <TableCell className="font-mono text-xs font-medium">
                        #{order.id.slice(0, 8).toUpperCase()}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatCustomerDate(order.createdAt, "date")}
                      </TableCell>
                      <TableCell className="max-w-36 truncate text-sm">
                        {order.branchName || "—"}
                      </TableCell>
                      <TableCell className="text-center">
                        {order.itemCount}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatRupiah(order.total)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={STATUS_STYLES[order.status]}
                        >
                          {STATUS_LABELS[order.status] ?? order.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Button asChild variant="ghost" size="icon">
                          <Link
                            href={`/admin/orders/${order.id}`}
                            aria-label={`Open order ${order.id}`}
                          >
                            <ArrowUpRight className="h-4 w-4" />
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
