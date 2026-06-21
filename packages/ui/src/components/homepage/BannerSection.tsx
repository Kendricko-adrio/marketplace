import Link from "next/link";
import Image from "next/image";
import { Button } from "../ui/button";
import type { HomepageSectionData, BannerContent } from "./types";

interface BannerSectionProps {
  section: HomepageSectionData;
  preview?: boolean;
}

export default function BannerSection({ section, preview }: BannerSectionProps) {
  const content = (section.content ?? {}) as BannerContent;
  const { imageUrl, altText, ctaText, ctaLink } = content;

  return (
    <section className="relative w-full h-[280px] sm:h-[360px] md:h-[460px] overflow-hidden bg-muted">
      {imageUrl ? (
        <Image
          src={imageUrl}
          alt={altText || section.title || "Banner"}
          fill
          className="object-cover"
          priority={!preview}
          sizes="100vw"
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-primary to-secondary" />
      )}
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative z-10 h-full container mx-auto px-4 flex flex-col justify-center">
        {section.title && (
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-white mb-2 max-w-2xl">
            {section.title}
          </h2>
        )}
        {section.subtitle && (
          <p className="text-sm sm:text-base text-white/80 mb-6 max-w-xl">
            {section.subtitle}
          </p>
        )}
        {ctaText && (
          preview ? (
            <span className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2 w-fit">
              {ctaText}
            </span>
          ) : (
            ctaLink ? (
              <Button asChild className="w-fit">
                <Link href={ctaLink}>{ctaText}</Link>
              </Button>
            ) : (
              <Button className="w-fit">{ctaText}</Button>
            )
          )
        )}
      </div>
    </section>
  );
}