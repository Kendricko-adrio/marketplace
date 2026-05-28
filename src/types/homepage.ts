export type SectionType =
  | "banner"
  | "carousel_product"
  | "category_grid"
  | "promo_cards"
  | "countdown_flash_sale"
  | "image_text_block"
  | "announcement_bar"
  | "product_grid"
  | "brand_strip"
  | "video_embed";

export interface HomepageSection {
  id: string;
  type: SectionType;
  title: string;
  displayOrder: number;
  config: Record<string, unknown>;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// 1. Banner
export interface BannerConfig {
  template: "hero" | "split";
  images: { url: string; link: string; alt: string }[];
  ctaText?: string;
  ctaLink?: string;
}

// 2. Carousel Product
export interface CarouselConfig {
  source: "flash_sale" | "best_seller" | "category" | "manual";
  categoryId?: string;
  productIds?: string[];
  maxItems: number;
  autoplay?: boolean;
}

// 3. Categories Grid
export interface CategoryGridConfig {
  categoryIds: string[];
  columns: 4 | 6;
  showIcon: boolean;
}

// 4. Promo Cards
export interface PromoCardsConfig {
  layout: "single" | "double" | "triple";
  cards: {
    image: string;
    title: string;
    description: string;
    link: string;
    badge?: string;
  }[];
}

// 5. Countdown Flash Sale
export interface CountdownConfig {
  title: string;
  endDate: string;
  source: "flash_sale" | "manual";
  productIds?: string[];
  maxItems: number;
}

// 6. Image + Text Block
export interface ImageTextConfig {
  imageUrl: string;
  imagePosition: "left" | "right";
  title: string;
  description: string;
  ctaText?: string;
  ctaLink?: string;
  backgroundColor?: string;
}

// 7. Announcement Bar
export interface AnnouncementConfig {
  text: string;
  link?: string;
  linkText?: string;
  backgroundColor?: string;
  textColor?: string;
  dismissible: boolean;
}

// 8. Product Grid
export interface ProductGridConfig {
  source: "best_seller" | "manual" | "new_arrivals" | "category";
  categoryId?: string;
  productIds?: string[];
  columns: 3 | 4;
  rows: number;
  showViewAll: boolean;
}

// 9. Brand Strip
export interface BrandStripConfig {
  logos: { image: string; name: string; link?: string }[];
  autoplay: boolean;
}

// 10. Video Embed
export interface VideoEmbedConfig {
  videoUrl: string;
  platform: "youtube" | "vimeo";
  aspectRatio: "16/9" | "4/3" | "1/1";
  thumbnail?: string;
  autoplay: boolean;
}
