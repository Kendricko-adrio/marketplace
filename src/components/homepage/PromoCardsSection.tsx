import Link from "next/link";
import Image from "next/image";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { PromoCardsConfig } from "@/types/homepage";

interface PromoCardsSectionProps {
  config: PromoCardsConfig;
  title: string;
}

export default function PromoCardsSection({ config, title }: PromoCardsSectionProps) {
  const layout = config.layout || "double";
  const cols = layout === "single" ? "grid-cols-1" : layout === "double" ? "grid-cols-1 md:grid-cols-2" : "grid-cols-1 md:grid-cols-3";

  return (
    <section className="container mx-auto px-4 py-8">
      <h2 className="text-2xl font-semibold mb-6">{title}</h2>
      <div className={`grid ${cols} gap-4`}>
        {config.cards.map((card, i) => (
          <Link key={i} href={card.link || "#"}>
            <Card className="overflow-hidden h-full hover:shadow-lg transition-shadow">
              <div className="relative aspect-[16/9]">
                <Image src={card.image} alt={card.title} fill className="object-cover" sizes="(max-width: 768px) 100vw, 33vw" />
                {card.badge && <Badge className="absolute top-2 left-2">{card.badge}</Badge>}
              </div>
              <CardContent className="p-4">
                <h3 className="font-semibold">{card.title}</h3>
                <p className="text-sm text-muted-foreground mt-1">{card.description}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </section>
  );
}
