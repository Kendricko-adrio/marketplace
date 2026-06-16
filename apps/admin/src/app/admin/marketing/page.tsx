"use client";
import { Plus, Ticket, Image as ImageIcon, Trash2, Edit } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
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
          <TabsTrigger value="banners">Banner Promo</TabsTrigger>
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

        {/* Banner Tab */}
        <TabsContent value="banners" className="space-y-4 mt-4">
          <div className="flex justify-between items-center bg-card p-4 rounded-lg border shadow-sm">
            <div>
              <h3 className="text-lg font-medium">Banner Halaman Utama</h3>
              <p className="text-sm text-muted-foreground">
                Kelola banner slide yang muncul di halaman beranda.
              </p>
            </div>
            <Button className="gap-2">
              <ImageIcon className="h-4 w-4" /> Upload Banner
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3].map((i) => (
              <Card key={i} className="overflow-hidden">
                <div className="aspect-[16/6] bg-muted relative group">
                  <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button variant="secondary" size="sm">
                      Ganti Gambar
                    </Button>
                  </div>
                </div>
                <CardContent className="p-4">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <div className="font-semibold mb-1">Banner Promo {i}</div>
                      <div className="text-xs text-muted-foreground">
                        Redirect to: /products/promo-{i}
                      </div>
                    </div>
                    <Switch defaultChecked={i !== 3} />
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 gap-2"
                    >
                      <Edit className="h-3 w-3" /> Edit
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 gap-2 text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-3 w-3" /> Hapus
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
