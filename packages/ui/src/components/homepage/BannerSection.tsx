"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "../ui/button";
import type { HomepageSectionData, BannerContent, BannerSlide } from "./types";

interface BannerSectionProps {
  section: HomepageSectionData;
  preview?: boolean;
}

const AUTO_ROTATE_DEFAULT_SEC = 5;
const AUTO_ROTATE_MIN_SEC = 2;
const AUTO_ROTATE_MAX_SEC = 30;

function normalizeSlides(content: Partial<BannerContent> | undefined): BannerSlide[] {
  if (!content) return [];
  // Backward-compat: if old single imageUrl is present, wrap into a 1-slide array.
  const legacy = content as unknown as { imageUrl?: string; altText?: string };
  if (typeof legacy.imageUrl === "string" && legacy.imageUrl !== "" && !Array.isArray(content.slides)) {
    return [{ imageUrl: legacy.imageUrl, altText: legacy.altText }];
  }
  return Array.isArray(content.slides)
    ? content.slides.filter(
        (s): s is BannerSlide =>
          !!s && typeof s.imageUrl === "string" && s.imageUrl !== ""
      )
    : [];
}

function clampInterval(sec: number | undefined): number {
  const v = typeof sec === "number" && Number.isFinite(sec) ? sec : AUTO_ROTATE_DEFAULT_SEC;
  return Math.min(AUTO_ROTATE_MAX_SEC, Math.max(AUTO_ROTATE_MIN_SEC, v));
}

export default function BannerSection({ section, preview }: BannerSectionProps) {
  const content = (section.content ?? {}) as Partial<BannerContent>;
  const slides = normalizeSlides(content);
  const { ctaText, ctaLink } = content;
  const intervalSec = clampInterval(content.autoRotateIntervalSec);

  const [current, setCurrent] = useState(0);
  const [paused, setPaused] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const total = slides.length;
  const hasMultiple = total > 1;

  const goTo = useCallback(
    (index: number) => {
      if (total === 0) return;
      setCurrent(((index % total) + total) % total);
    },
    [total]
  );

  const next = useCallback(() => goTo(current + 1), [current, goTo]);
  const prev = useCallback(() => goTo(current - 1), [current, goTo]);

  useEffect(() => {
    if (!hasMultiple || paused) return;
    timerRef.current = setInterval(() => {
      setCurrent((c) => (c + 1) % total);
    }, intervalSec * 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [hasMultiple, paused, intervalSec, total]);

  // Reset index if slides array shrinks.
  useEffect(() => {
    if (current >= total && total > 0) setCurrent(0);
  }, [current, total]);

  if (total === 0) {
    return (
      <section className="relative w-full h-[280px] sm:h-[360px] md:h-[460px] overflow-hidden bg-muted">
        <div className="absolute inset-0 bg-gradient-to-br from-primary to-secondary" />
        <div className="relative z-10 h-full container mx-auto px-4 flex flex-col justify-center">
          {section.title && (
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-white mb-2 max-w-2xl">
              {section.title}
            </h2>
          )}
          {section.subtitle && (
            <p className="text-sm sm:text-base text-white/80 mb-6 max-w-xl">{section.subtitle}</p>
          )}
          {ctaText && <BannerCta ctaText={ctaText} ctaLink={ctaLink} preview={preview} />}
        </div>
      </section>
    );
  }

  return (
    <section
      className="relative w-full h-[280px] sm:h-[360px] md:h-[460px] overflow-hidden bg-muted group/banner"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {slides.map((slide, index) => {
        const isActive = index === current;
        return (
          <div
            key={index}
            className={`absolute inset-0 transition-opacity duration-700 ${
              isActive ? "opacity-100" : "opacity-0 pointer-events-none"
            }`}
            aria-hidden={!isActive}
          >
            <Image
              src={slide.imageUrl}
              alt={slide.altText || section.title || `Banner ${index + 1}`}
              fill
              className="object-cover"
              priority={!preview && index === 0}
              sizes="100vw"
            />
          </div>
        );
      })}
      <div className="absolute inset-0 bg-black/40" />

      <div className="relative z-10 h-full container mx-auto px-4 flex flex-col justify-center">
        {section.title && (
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-white mb-2 max-w-2xl">
            {section.title}
          </h2>
        )}
        {section.subtitle && (
          <p className="text-sm sm:text-base text-white/80 mb-6 max-w-xl">{section.subtitle}</p>
        )}
        {ctaText && <BannerCta ctaText={ctaText} ctaLink={ctaLink} preview={preview} />}
      </div>

      {hasMultiple && (
        <>
          <button
            type="button"
            onClick={prev}
            aria-label="Slide sebelumnya"
            className="absolute left-3 top-1/2 -translate-y-1/2 z-20 h-9 w-9 rounded-full bg-black/40 text-white hover:bg-black/60 transition-colors flex items-center justify-center backdrop-blur-sm"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={next}
            aria-label="Slide berikutnya"
            className="absolute right-3 top-1/2 -translate-y-1/2 z-20 h-9 w-9 rounded-full bg-black/40 text-white hover:bg-black/60 transition-colors flex items-center justify-center backdrop-blur-sm"
          >
            <ChevronRight className="h-5 w-5" />
          </button>

          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2">
            {slides.map((_, index) => {
              const isActive = index === current;
              return (
                <button
                  key={index}
                  type="button"
                  onClick={() => goTo(index)}
                  aria-label={`Pergi ke slide ${index + 1}`}
                  aria-current={isActive}
                  className={`h-2 rounded-full transition-all duration-300 ${
                    isActive ? "w-6 bg-white" : "w-2 bg-white/50 hover:bg-white/80"
                  }`}
                />
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

function BannerCta({
  ctaText,
  ctaLink,
  preview,
}: {
  ctaText: string;
  ctaLink?: string;
  preview?: boolean;
}) {
  if (preview) {
    return (
      <span className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2 w-fit">
        {ctaText}
      </span>
    );
  }
  if (ctaLink) {
    return (
      <Button asChild className="w-fit">
        <Link href={ctaLink}>{ctaText}</Link>
      </Button>
    );
  }
  return <Button className="w-fit">{ctaText}</Button>;
}