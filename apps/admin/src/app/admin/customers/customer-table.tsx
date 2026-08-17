"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Search, UsersRound } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  filterCustomers,
  formatCustomerDate,
  getCustomerInitials,
} from "@/lib/customer-display";
import type { CustomerListItem } from "@/lib/customers";

const GENDER_LABELS: Record<string, string> = {
  male: "Male",
  female: "Female",
  other: "Other",
};

export function CustomerTable({ customers }: { customers: CustomerListItem[] }) {
  const [search, setSearch] = useState("");
  const filteredCustomers = useMemo(
    () => filterCustomers(customers, search),
    [customers, search]
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search name, email, or phone..."
            className="pl-9"
            aria-label="Search customers"
          />
        </div>
        <p className="text-sm text-muted-foreground">
          Showing {filteredCustomers.length} of {customers.length} customers
        </p>
      </div>

      <div className="rounded-lg border bg-background">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead className="min-w-[220px]">Name</TableHead>
              <TableHead className="min-w-[210px]">Email</TableHead>
              <TableHead className="min-w-[145px]">Phone</TableHead>
              <TableHead className="min-w-[125px]">Birth Date</TableHead>
              <TableHead>Gender</TableHead>
              <TableHead>Onboarding</TableHead>
              <TableHead className="min-w-[150px]">Created At</TableHead>
              <TableHead className="min-w-[150px]">Updated At</TableHead>
              <TableHead className="text-center">Orders</TableHead>
              <TableHead className="w-[90px] text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredCustomers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="h-40 text-center">
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <UsersRound className="h-8 w-8" />
                    <span>No customers found.</span>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              filteredCustomers.map((customer) => (
                <TableRow key={customer.id} className="group">
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar className="h-9 w-9 border">
                        <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
                          {getCustomerInitials(customer.name)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="font-medium text-foreground">
                        {customer.name}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {customer.email}
                  </TableCell>
                  <TableCell>{customer.phone || "—"}</TableCell>
                  <TableCell>
                    {formatCustomerDate(customer.birthDate, "date")}
                  </TableCell>
                  <TableCell>
                    {customer.gender
                      ? GENDER_LABELS[customer.gender] ?? customer.gender
                      : "—"}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={
                        customer.onboardingCompleted
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border-amber-200 bg-amber-50 text-amber-700"
                      }
                    >
                      {customer.onboardingCompleted ? "Completed" : "Pending"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatCustomerDate(customer.createdAt)}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatCustomerDate(customer.updatedAt)}
                  </TableCell>
                  <TableCell className="text-center font-medium">
                    {customer.orderCount}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      asChild
                      variant="ghost"
                      size="sm"
                      className="gap-1.5"
                    >
                      <Link
                        href={`/admin/customers/${customer.id}`}
                        aria-label="View detail"
                      >
                        View <ArrowUpRight className="h-3.5 w-3.5" />
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
