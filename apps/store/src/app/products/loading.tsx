export default function ProductsLoading() {
  return (
    <div
      className="container mx-auto flex flex-col gap-8 px-4 py-8 md:flex-row"
      aria-busy="true"
      aria-label="Memuat katalog produk"
    >
      <aside className="w-full space-y-4 md:w-64">
        <div className="h-6 w-24 animate-pulse rounded bg-foreground/10" />
        <div className="h-10 w-full animate-pulse rounded-md bg-foreground/10" />
        <div className="h-10 w-full animate-pulse rounded-md bg-foreground/10" />
        <div className="h-10 w-full animate-pulse rounded-md bg-foreground/10" />
      </aside>
      <div className="flex-1 space-y-6">
        <div className="flex items-center justify-between border-b pb-4">
          <div className="h-8 w-44 animate-pulse rounded bg-foreground/10" />
          <div className="h-5 w-40 animate-pulse rounded bg-foreground/10" />
        </div>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="space-y-3 rounded-lg border bg-card p-4">
              <div className="aspect-square w-full animate-pulse rounded-md bg-foreground/10" />
              <div className="h-4 w-3/4 animate-pulse rounded bg-foreground/10" />
              <div className="h-5 w-1/2 animate-pulse rounded bg-foreground/10" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
