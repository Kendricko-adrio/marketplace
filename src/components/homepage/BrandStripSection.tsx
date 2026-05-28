"use client";
import Image from "next/image";
import Link from "next/link";
import type { BrandStripConfig } from "@/types/homepage";

interface BrandStripSectionProps {
  config: BrandStripConfig;
  title: string;
}

export default function BrandStripSection({ config, title }: BrandStripSectionProps) {
  return (
    <section className="container mx-auto px-4 py-8">
      <h2 className="text-2xl font-semibold mb-6 text-center">{title}</h2>
      <div className={`flex ${config.autoplay !== false ? "overflow-x-auto" : "flex-wrap justify-center"} gap-8 items-center py-4`}>
        {config.logos.map((logo, i) => (
          <Link key={i} href={logo.link || "#"} className="flex-shrink-0 relative h-16 w-32 grayscale hover:grayscale-0 transition-all">
            <Image src={logo.image} alt={logo.name} fill className="object-contain" sizes="128px" />
          </Link>
        ))}
      </div>
    </section>
  );
}
