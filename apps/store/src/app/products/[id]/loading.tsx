export default function ProductDetailLoading() {
  return (
    <div
      className="container mx-auto px-4 py-8"
      aria-busy="true"
      aria-label="Memuat detail produk"
    >
      <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
        <div className="aspect-square w-full animate-pulse rounded-xl bg-foreground/10" />
        <div className="space-y-6">
          <div className="space-y-2">
            <div className="h-8 w-3/4 animate-pulse rounded bg-foreground/10" />
            <div className="h-7 w-1/3 animate-pulse rounded bg-foreground/10" />
          </div>
          <div className="space-y-2">
            <div className="h-5 w-24 animate-pulse rounded bg-foreground/10" />
            <div className="flex gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="h-12 w-12 animate-pulse rounded-lg bg-foreground/10"
                />
              ))}
            </div>
          </div>
          <div className="h-12 w-full animate-pulse rounded-lg bg-foreground/10" />
          <div className="space-y-2">
            <div className="h-4 w-full animate-pulse rounded bg-foreground/10" />
            <div className="h-4 w-5/6 animate-pulse rounded bg-foreground/10" />
          </div>
        </div>
      </div>
    </div>
  );
}
