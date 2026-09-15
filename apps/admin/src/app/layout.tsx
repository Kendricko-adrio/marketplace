import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";
import { AuthProvider } from "@/providers/auth-provider";
import { PolicyGate } from "@/components/PolicyGate";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Marketplace Admin",
  description: "Admin Panel for Marketplace",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id">
      <body className={inter.className}>
        <AuthProvider>
          <PolicyGate>{children}</PolicyGate>
        </AuthProvider>
        <Toaster position="top-center" richColors closeButton />
      </body>
    </html>
  );
}
