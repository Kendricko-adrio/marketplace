import Link from "next/link";

export default function Footer() {
  return (
    <footer className="mt-16 border-t bg-secondary/30 pt-16">
      <div className="container mx-auto grid grid-cols-1 md:grid-cols-4 gap-8 px-4 mb-12">
        <div className="col-span-1 md:col-span-2">
          <h3 className="text-2xl font-bold text-primary mb-4">StoreFront</h3>
          <p className="text-muted-foreground leading-relaxed max-w-sm">
            Belanja aman, nyaman, dan terpercaya. Temukan produk terbaik dengan
            harga terbaik hanya di sini.
          </p>
        </div>
        <div>
          <h4 className="font-semibold text-foreground mb-4">Layanan</h4>
          <div className="flex flex-col gap-2">
            <Link
              href="/help"
              className="text-sm text-muted-foreground hover:text-primary transition-colors"
            >
              Bantuan
            </Link>
            <Link
              href="/status"
              className="text-sm text-muted-foreground hover:text-primary transition-colors"
            >
              Status Pesanan
            </Link>
            <Link
              href="/catalog"
              className="text-sm text-muted-foreground hover:text-primary transition-colors"
            >
              Katalog
            </Link>
          </div>
        </div>
        <div>
          <h4 className="font-semibold text-foreground mb-4">Tentang</h4>
          <div className="flex flex-col gap-2">
            <Link
              href="/about"
              className="text-sm text-muted-foreground hover:text-primary transition-colors"
            >
              Tentang Kami
            </Link>
            <Link
              href="/privacy"
              className="text-sm text-muted-foreground hover:text-primary transition-colors"
            >
              Privasi
            </Link>
            <Link
              href="/terms"
              className="text-sm text-muted-foreground hover:text-primary transition-colors"
            >
              Syarat & Ketentuan
            </Link>
          </div>
        </div>
      </div>
      <div className="border-t py-6 text-center text-sm text-muted-foreground">
        &copy; 2026 StoreFront. All rights reserved.
      </div>
    </footer>
  );
}
