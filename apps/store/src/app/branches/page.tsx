import { Suspense } from "react";
import { MapPin } from "lucide-react";
import BranchCard, { type Branch } from "@/components/BranchCard";

interface BranchesResponse {
  success: boolean;
  data: Branch[];
}

async function getBranches(city?: string): Promise<BranchesResponse> {
  const params = new URLSearchParams();
  if (city) params.set("city", city);
  try {
    const res = await fetch(
      `${
        process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
      }/api/branches?${params.toString()}`,
      { cache: "no-store" }
    );
    const data = await res.json();
    return data;
  } catch (error) {
    console.error("Error fetching branches:", error);
    return { success: false, data: [] };
  }
}

export const metadata = {
  title: "Cabang Kami",
  description: "Temukan cabang toko terdekat dengan alamat dan jam operasional.",
};

export default async function BranchesPage({
  searchParams,
}: {
  searchParams: Promise<{ city?: string }>;
}) {
  const params = await searchParams;
  const { data: branchesList } = await getBranches(params.city);

  const cities = [
    ...new Set(branchesList.map((b) => b.city).filter(Boolean)),
  ].sort();

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="bg-primary/10 p-2 rounded-lg">
            <MapPin className="h-6 w-6 text-primary" />
          </div>
          <h1 className="text-3xl font-bold">Cabang Kami</h1>
        </div>
        <p className="text-muted-foreground">
          Temukan cabang toko terdekat dengan alamat lengkap dan jam operasional.
        </p>
      </div>

      <Suspense
        fallback={<div className="text-muted-foreground">Memuat cabang...</div>}
      >
        {cities.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-6">
            <a href="/branches">
              <button className="px-3 py-1 text-sm rounded-full border bg-background hover:bg-muted transition-colors">
                Semua
              </button>
            </a>
            {cities.map((c) => (
              <a key={c} href={`/branches?city=${encodeURIComponent(c)}`}>
                <button
                  className={`px-3 py-1 text-sm rounded-full border transition-colors ${
                    params.city === c
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background hover:bg-muted"
                  }`}
                >
                  {c}
                </button>
              </a>
            ))}
          </div>
        )}

        {branchesList.length === 0 ? (
          <div className="text-center py-16">
            <MapPin className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground text-lg">
              Belum ada cabang yang tersedia.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {branchesList.map((branch) => (
              <BranchCard key={branch.id} branch={branch} />
            ))}
          </div>
        )}
      </Suspense>
    </div>
  );
}