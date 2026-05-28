import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import type { BannerConfig } from "@/types/homepage";

interface BannerSectionProps {
  config: BannerConfig;
}

export default function BannerSection({ config }: BannerSectionProps) {
  if (config.template === "hero") {
    const img = config.images[0];
    if (!img) return null;
    return (
      <section className="relative w-full">
        <Link href={img.link || "#"} className="relative block w-full aspect-[21/9] md:aspect-[3/1]">
          <Image src={img.url} alt={img.alt || ""} fill className="object-cover" sizes="100vw" />
        </Link>
        {config.ctaText && (
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2">
            <Link href={config.ctaLink || "/products"}>
              <Button size="lg">{config.ctaText}</Button>
            </Link>
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="grid grid-cols-1 md:grid-cols-2 gap-4 container mx-auto px-4 py-8">
      {config.images.map((img, i) => (
        <Link key={i} href={img.link || "#"} className="relative block aspect-[16/9] rounded-xl overflow-hidden">
          <Image src={img.url} alt={img.alt || ""} fill className="object-cover" sizes="(max-width: 768px) 100vw, 50vw" />
        </Link>
      ))}
    </section>
  );
}
