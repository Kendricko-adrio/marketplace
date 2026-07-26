import Link from "next/link";
import type { FooterConfigData } from "@marketplace/db/src/schema/footer";
import { SocialIcon } from "./SocialIcons";

export type { FooterConfigData } from "@marketplace/db/src/schema/footer";

interface FooterProps {
  config: FooterConfigData | null;
}

function isExternal(href: string): boolean {
  return /^https?:\/\//i.test(href);
}

export default function Footer({ config }: FooterProps) {
  const {
    brandName,
    tagline,
    columns,
    copyrightText,
    socialMedia,
  } = config ?? ({} as FooterConfigData);

  // Defensive: ensure arrays exist even if DB row was saved with nulls.
  const safeColumns = Array.isArray(columns) ? columns : [];
  const safeSocial = Array.isArray(socialMedia) ? socialMedia : [];
  const activeSocial = safeSocial.filter(
    (s) => s?.enabled && Boolean(s?.url)
  );

  // Layout: brand spans 2 cols (md), then up to 3 link columns.
  // Use static Tailwind classes (Tailwind purges dynamic strings).
  const linkColCount = Math.min(safeColumns.length, 3);
  const gridColsClass =
    linkColCount === 0
      ? "grid-cols-1"
      : linkColCount === 1
      ? "grid-cols-1 md:grid-cols-3"
      : linkColCount === 2
      ? "grid-cols-1 md:grid-cols-4"
      : "grid-cols-1 md:grid-cols-5"; // 3 link cols + 2 brand cols
  const brandColSpanClass =
    linkColCount === 0
      ? "col-span-1 md:col-span-4"
      : "col-span-1 md:col-span-2";

  return (
    <footer className="mt-16 border-t bg-secondary/30 pt-16">
      <div className={`container mx-auto grid ${gridColsClass} gap-8 px-4 mb-12`}>
        <div className={brandColSpanClass}>
          {brandName ? (
            <h3 className="text-2xl font-bold text-primary mb-4">{brandName}</h3>
          ) : null}
          {tagline ? (
            <p className="text-muted-foreground leading-relaxed max-w-sm">
              {tagline}
            </p>
          ) : null}

          {activeSocial.length > 0 && (
            <div className="flex items-center gap-3 mt-5">
              {activeSocial.map((s, idx) => {
                const Icon = (
                  <SocialIcon
                    platform={s.platform}
                    size={20}
                    className="text-muted-foreground hover:text-primary transition-colors"
                  />
                );
                return isExternal(s.url) ? (
                  <a
                    key={`${s.platform}-${idx}`}
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={s.platform}
                    className="inline-flex"
                  >
                    {Icon}
                  </a>
                ) : (
                  <Link
                    key={`${s.platform}-${idx}`}
                    href={s.url}
                    aria-label={s.platform}
                    className="inline-flex"
                  >
                    {Icon}
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {safeColumns.slice(0, 3).map((col, colIdx) => (
          <div key={`col-${colIdx}`}>
            {col.title ? (
              <h4 className="font-semibold text-foreground mb-4">{col.title}</h4>
            ) : null}
            <div className="flex flex-col gap-2">
              {(col.links ?? [])
                .slice(0, 5)
                .map((link, linkIdx) => {
                  return isExternal(link.href) ? (
                    <a
                      key={`link-${colIdx}-${linkIdx}`}
                      href={link.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-muted-foreground hover:text-primary transition-colors"
                    >
                      {link.label}
                    </a>
                  ) : (
                    <Link
                      key={`link-${colIdx}-${linkIdx}`}
                      href={link.href}
                      className="text-sm text-muted-foreground hover:text-primary transition-colors"
                    >
                      {link.label}
                    </Link>
                  );
                })}
            </div>
          </div>
        ))}
      </div>

      {copyrightText ? (
        <div className="border-t py-6 text-center text-sm text-muted-foreground">
          {copyrightText}
        </div>
      ) : null}
    </footer>
  );
}