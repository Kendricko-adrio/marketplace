import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { ImageTextConfig } from "@/types/homepage";

interface ImageTextSectionProps {
  config: ImageTextConfig;
  title: string;
}

export default function ImageTextSection({ config, title }: ImageTextSectionProps) {
  const isLeft = config.imagePosition === "left";
  return (
    <section className="container mx-auto px-4 py-8" style={{ backgroundColor: config.backgroundColor || undefined }}>
      <div className={`flex flex-col ${isLeft ? "md:flex-row" : "md:flex-row-reverse"} items-center gap-8`}>
        <div className="w-full md:w-1/2 relative aspect-[4/3] rounded-xl overflow-hidden">
          <Image src={config.imageUrl} alt={title} fill className="object-cover" sizes="50vw" />
        </div>
        <div className="w-full md:w-1/2 space-y-4">
          <h2 className="text-3xl font-bold">{config.title || title}</h2>
          <p className="text-muted-foreground whitespace-pre-line">{config.description}</p>
          {config.ctaText && (
            <Link href={config.ctaLink || "#"}>
              <Button>{config.ctaText}</Button>
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
