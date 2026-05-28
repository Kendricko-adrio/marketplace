import type {
  HomepageSection,
  BannerConfig,
  CarouselConfig,
  CategoryGridConfig,
  PromoCardsConfig,
  CountdownConfig,
  ImageTextConfig,
  AnnouncementConfig,
  ProductGridConfig,
  BrandStripConfig,
  VideoEmbedConfig,
} from "@/types/homepage";
import BannerSection from "./BannerSection";
import CarouselSection from "./CarouselSection";
import CategoryGridSection from "./CategoryGridSection";
import PromoCardsSection from "./PromoCardsSection";
import CountdownSection from "./CountdownSection";
import ImageTextSection from "./ImageTextSection";
import AnnouncementSection from "./AnnouncementSection";
import ProductGridSection from "./ProductGridSection";
import BrandStripSection from "./BrandStripSection";
import VideoEmbedSection from "./VideoEmbedSection";

interface SectionRendererProps {
  section: HomepageSection;
}

export function SectionRenderer({ section }: SectionRendererProps) {
  switch (section.type) {
    case "banner":
      return <BannerSection config={(section.config as unknown) as BannerConfig} />;
    case "carousel_product":
      return <CarouselSection config={(section.config as unknown) as CarouselConfig} title={section.title} />;
    case "category_grid":
      return <CategoryGridSection config={(section.config as unknown) as CategoryGridConfig} title={section.title} />;
    case "promo_cards":
      return <PromoCardsSection config={(section.config as unknown) as PromoCardsConfig} title={section.title} />;
    case "countdown_flash_sale":
      return <CountdownSection config={(section.config as unknown) as CountdownConfig} title={section.title} />;
    case "image_text_block":
      return <ImageTextSection config={(section.config as unknown) as ImageTextConfig} title={section.title} />;
    case "announcement_bar":
      return <AnnouncementSection config={(section.config as unknown) as AnnouncementConfig} />;
    case "product_grid":
      return <ProductGridSection config={(section.config as unknown) as ProductGridConfig} title={section.title} />;
    case "brand_strip":
      return <BrandStripSection config={(section.config as unknown) as BrandStripConfig} title={section.title} />;
    case "video_embed":
      return <VideoEmbedSection config={(section.config as unknown) as VideoEmbedConfig} title={section.title} />;
    default:
      return null;
  }
}
