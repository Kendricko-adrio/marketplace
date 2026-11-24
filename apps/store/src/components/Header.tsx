"use client";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  ShoppingCart,
  User,
  Search,
  LogOut,
  Package,
  MapPin,
  Menu,
  Home,
  ShoppingBag,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAuth } from "@/providers/auth-provider";
import { useCart } from "@/providers/cart-provider";
import { signOut } from "@/lib/auth-client";
import { useState, useEffect, useSyncExternalStore } from "react";

// `mounted` gates client-only UI (the auth cluster) so the server HTML and the
// first client render agree; React then re-renders once after hydration.
// `useSyncExternalStore` expresses that without a setState call inside an
// effect (which cascades renders and is rejected by the react-hooks lint rule):
// the server snapshot is `false`, the client snapshot is `true`, and the store
// never changes afterwards, so the subscription is a no-op.
const subscribeToHydration = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

export default function Header() {
  const router = useRouter();
  const { user, isLoading, isAuthenticated } = useAuth();
  const { itemCount } = useCart();
  const [searchQuery, setSearchQuery] = useState("");
  const [scrolled, setScrolled] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const mounted = useSyncExternalStore(
    subscribeToHydration,
    getClientSnapshot,
    getServerSnapshot
  );

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      setMobileSearchOpen(false);
      router.push(`/products?search=${encodeURIComponent(searchQuery.trim())}`);
    }
  };

  const handleLogout = async () => {
    await signOut();
    // Clear the onboarding gate cookie so a different user logging in
    // on the same browser is gated correctly until they complete onboarding.
    document.cookie = "client.onboarding=; path=/; max-age=0";
    router.push("/");
    router.refresh();
  };

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  return (
    <header
      className={`sticky top-0 z-50 w-full border-b border-white/10 transition-colors duration-300 ${
        scrolled ? "bg-primary/70 backdrop-blur-md" : "bg-primary"
      }`}
    >
      <div className="container mx-auto flex h-16 items-center justify-between px-4">
        <div className="flex items-center gap-4">
          <Link href="/" className="flex items-center">
            <Image
              src="/adf-logo.png"
              alt="ADF"
              width={120}
              height={40}
              priority
            />
          </Link>
        </div>

        <form
          onSubmit={handleSearch}
          className="hidden md:flex flex-1 max-w-xl mx-8 relative"
        >
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/70" />
          <Input
            type="text"
            placeholder="Cari produk..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 rounded-full bg-white/10 border-white/20 text-white placeholder:text-white/45 focus-visible:bg-white/20 focus-visible:border-white/40"
          />
        </form>

        <div className="flex items-center gap-1 sm:gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Cari produk"
            onClick={() => setMobileSearchOpen(true)}
            className="md:hidden text-white hover:text-white/80 hover:bg-white/10"
          >
            <Search className="h-5 w-5" />
          </Button>
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="hidden md:inline-flex text-white hover:bg-white/10 hover:text-white gap-2"
          >
            <Link href="/branches">
              <MapPin className="h-4 w-4" />
              Cabang
            </Link>
          </Button>
          <Button
            asChild
            variant="ghost"
            size="icon"
            className="relative text-white hover:text-white/80 hover:bg-white/10 transition-colors"
          >
            <Link href="/cart" aria-label="Keranjang">
              <ShoppingCart className="h-6 w-6" />
              {itemCount > 0 && (
                <span className="absolute -bottom-0.5 -right-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-700 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-primary">
                  {itemCount > 10 ? "10+" : itemCount}
                </span>
              )}
            </Link>
          </Button>

          {!mounted || isLoading ? (
            <Button variant="ghost" size="icon" disabled aria-label="Memuat akun">
              <User className="h-6 w-6 animate-pulse text-white" />
            </Button>
          ) : isAuthenticated && user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  aria-label="Menu akun"
                  className="relative h-10 w-10 rounded-full p-0 text-white hover:bg-white/10 hover:text-white"
                >
                  <Avatar className="h-9 w-9">
                    <AvatarImage
                      src={user.image || undefined}
                      alt={user.name}
                    />
                    <AvatarFallback className="bg-secondary text-white ring-1 ring-white/30">
                      {getInitials(user.name)}
                    </AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56" align="end" forceMount>
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col space-y-1">
                    <p className="text-sm font-medium leading-none">
                      {user.name}
                    </p>
                    <p className="text-xs leading-none text-muted-foreground">
                      {user.email}
                    </p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/account" className="cursor-pointer">
                    <User className="mr-2 h-4 w-4" />
                    <span>Profil Saya</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/account?tab=orders" className="cursor-pointer">
                    <Package className="mr-2 h-4 w-4" />
                    <span>Pesanan Saya</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="cursor-pointer text-destructive focus:text-destructive"
                  onClick={handleLogout}
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>Keluar</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <div className="flex items-center gap-2">
              <Button
                asChild
                variant="ghost"
                size="sm"
                className="text-white hover:bg-white/10 hover:text-white"
              >
                <Link href="/login">Masuk</Link>
              </Button>
              <Button
                asChild
                size="sm"
                className="bg-white text-primary hover:bg-white/90"
              >
                <Link href="/register">Daftar</Link>
              </Button>
            </div>
          )}

          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Buka menu navigasi"
            onClick={() => setMobileMenuOpen(true)}
            className="md:hidden text-white hover:text-white/80 hover:bg-white/10"
          >
            <Menu className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {/* Mobile Search Dialog */}
      <Dialog open={mobileSearchOpen} onOpenChange={setMobileSearchOpen}>
        <DialogContent className="sm:max-w-md top-[20%] translate-y-0">
          <DialogHeader>
            <DialogTitle>Cari Produk</DialogTitle>
            <DialogDescription>
              Temukan sepatu, perlengkapan olahraga, atau koleksi favorit Anda.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSearch} className="flex gap-2">
            <Input
              type="search"
              placeholder="Cari produk..."
              aria-label="Cari produk"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus
            />
            <Button type="submit">Cari</Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Mobile Navigation Drawer */}
      <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
        <SheetContent side="right" className="w-72">
          <SheetHeader>
            <SheetTitle>Menu Navigasi</SheetTitle>
            <SheetDescription>
              Jelajahi katalog produk dan lokasi cabang kami.
            </SheetDescription>
          </SheetHeader>
          <nav className="mt-6 flex flex-col gap-2" aria-label="Navigasi mobile">
            <Button
              asChild
              variant="ghost"
              className="w-full justify-start gap-3"
            >
              <Link href="/" onClick={() => setMobileMenuOpen(false)}>
                <Home className="h-4 w-4" />
                Beranda
              </Link>
            </Button>
            <Button
              asChild
              variant="ghost"
              className="w-full justify-start gap-3"
            >
              <Link href="/products" onClick={() => setMobileMenuOpen(false)}>
                <ShoppingBag className="h-4 w-4" />
                Semua Produk
              </Link>
            </Button>
            <Button
              asChild
              variant="ghost"
              className="w-full justify-start gap-3"
            >
              <Link href="/branches" onClick={() => setMobileMenuOpen(false)}>
                <MapPin className="h-4 w-4" />
                Cabang
              </Link>
            </Button>
          </nav>
        </SheetContent>
      </Sheet>
    </header>
  );
}
