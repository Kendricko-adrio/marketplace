import type { HomepageSectionData } from "./types";
import BannerSection from "./BannerSection";
import CarouselProductSection from "./CarouselProductSection";
import PromoCardsSection from "./PromoCardsSection";
import AnnouncementBarSection from "./AnnouncementBarSection";
import StoreBannerSection from "./StoreBannerSection";

interface HomepageSectionRendererProps {
  section: HomepageSectionData;
  preview?: boolean;
}

export default function HomepageSectionRenderer({
  section,
  preview,
}: HomepageSectionRendererProps) {
  switch (section.type) {
    case "announcement_bar":
      return <AnnouncementBarSection section={section} preview={preview} />;
    case "banner":
      return <BannerSection section={section} preview={preview} />;
    case "carousel_product":
      return <CarouselProductSection section={section} />;
    case "promo_cards":
      return <PromoCardsSection section={section} preview={preview} />;
    case "store_banner":
      return <StoreBannerSection section={section} />;
    default:
      return null;
  }
}