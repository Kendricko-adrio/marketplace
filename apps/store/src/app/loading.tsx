export default function HomeLoading() {
  return (
    <div className="space-y-10 pb-12" aria-busy="true" aria-label="Memuat beranda">
      <div className="h-[360px] w-full animate-pulse bg-foreground/10" />
      <div className="container mx-auto px-4 space-y-6">
        <div className="h-7 w-48 animate-pulse rounded-md bg-foreground/10" />
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
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
