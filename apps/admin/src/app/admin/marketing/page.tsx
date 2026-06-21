"use client";
import { Plus, Ticket, Trash2, Edit } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export default function AdminMarketingPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">Marketing Tools</h2>
      </div>

      <Tabs defaultValue="vouchers" className="w-full">
        <TabsList>
          <TabsTrigger value="vouchers">Voucher & Diskon</TabsTrigger>
        </TabsList>

        {/* Voucher Tab */}
        <TabsContent value="vouchers" className="space-y-4 mt-4">
          <div className="flex justify-between items-center bg-card p-4 rounded-lg border shadow-sm">
            <div>
              <h3 className="text-lg font-medium">Buat Voucher Baru</h3>
              <p className="text-sm text-muted-foreground">
                Tingkatkan penjualan dengan kode promo menarik.
              </p>
            </div>
            <Button className="gap-2">
              <Plus className="h-4 w-4" /> Buat Voucher
            </Button>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Daftar Voucher Aktif</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Kode</TableHead>
                    <TableHead>Tipe</TableHead>
                    <TableHead>Nilai</TableHead>
                    <TableHead>Min. Belanja</TableHead>
                    <TableHead>Kuota</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[
                    {
                      code: "DISKON10",
                      type: "Persentase",
                      value: "10%",
                      min: "Rp 50.000",
                      quota: "50/100",
                      status: true,
                    },
                    {
                      code: "HMT25RB",
                      type: "Potongan",
                      value: "Rp 25.000",
                      min: "Rp 100.000",
                      quota: "10/50",
                      status: true,
                    },
                    {
                      code: "ONGKIRFREE",
                      type: "Gratis Ongkir",
                      value: "Maks Rp 20rb",
                      min: "Rp 0",
                      quota: "Habis",
                      status: false,
                    },
                  ].map((voucher, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-mono font-bold">
                        {voucher.code}
                      </TableCell>
                      <TableCell>{voucher.type}</TableCell>
                      <TableCell>{voucher.value}</TableCell>
                      <TableCell>{voucher.min}</TableCell>
                      <TableCell>{voucher.quota}</TableCell>
                      <TableCell>
                        <Switch checked={voucher.status} />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
