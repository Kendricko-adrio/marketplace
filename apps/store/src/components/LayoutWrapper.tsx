"use client";
import { usePathname } from "next/navigation";
import Header from "@/components/Header";

// `footerSlot` is a React node passed from the server layout (typically
// <FooterWrapper />), so the footer can be a Server Component that fetches
// data while LayoutWrapper stays a client component (it needs usePathname).
export default function LayoutWrapper({
  children,
  footerSlot,
}: {
  children: React.ReactNode;
  footerSlot?: React.ReactNode;
}) {
  const pathname = usePathname();
  const isAdmin = pathname?.startsWith("#admin");

  return (
    <div className="flex min-h-screen flex-col">
      {!isAdmin && <Header />}
      <main className="flex-1">{children}</main>
      {!isAdmin && footerSlot}
    </div>
  );
}