"use client";
import {
  MoreHorizontal,
  UserPlus,
  Search,
  Shield,
  ShieldCheck,
  ShieldAlert,
} from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function AdminUsersPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">Pengguna & Akses</h2>
        <Button className="gap-2">
          <UserPlus className="h-4 w-4" /> Tambah Admin
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Daftar Pengguna</CardTitle>
          <CardDescription>
            Kelola akun pengguna, peran, dan status akses.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4 mb-6">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Cari pengguna..." className="pl-8" />
            </div>
            {/* Role Filter Placeholder */}
            <Button variant="outline">Filter Role</Button>
          </div>

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[250px]">Nama Pengguna</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Terakhir Login</TableHead>
                  <TableHead className="text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[
                  {
                    name: "Admin Toko",
                    email: "admin@store.com",
                    role: "Super Admin",
                    status: "Active",
                    login: "Baru saja",
                  },
                  {
                    name: "John Doe",
                    email: "john@example.com",
                    role: "Customer",
                    status: "Active",
                    login: "1 jam lalu",
                  },
                  {
                    name: "Jane Smith",
                    email: "jane@example.com",
                    role: "Staff Gudang",
                    status: "Active",
                    login: "2 jam lalu",
                  },
                  {
                    name: "Bob Wilson",
                    email: "bob@example.com",
                    role: "Customer",
                    status: "Suspended",
                    login: "3 hari lalu",
                  },
                ].map((user, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="h-8 w-8">
                          <AvatarImage
                            src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${user.name}`}
                          />
                          <AvatarFallback>{user.name.charAt(0)}</AvatarFallback>
                        </Avatar>
                        <div>
                          <div className="font-medium">{user.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {user.email}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {user.role === "Super Admin" ? (
                          <ShieldCheck className="h-4 w-4 text-primary" />
                        ) : user.role === "Customer" ? (
                          <div className="w-4" />
                        ) : (
                          <Shield className="h-4 w-4 text-muted-foreground" />
                        )}
                        <span>{user.role}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          user.status === "Active" ? "default" : "destructive"
                        }
                        className={
                          user.status === "Active"
                            ? "bg-green-500 hover:bg-green-600"
                            : ""
                        }
                      >
                        {user.status}
                      </Badge>
                    </TableCell>
                    <TableCell>{user.login}</TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" className="h-8 w-8 p-0">
                            <span className="sr-only">Open menu</span>
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuLabel>Aksi</DropdownMenuLabel>
                          <DropdownMenuItem>Lihat Profil</DropdownMenuItem>
                          <DropdownMenuItem>Ubah Password</DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="text-destructive">
                            Blokir Akun
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
