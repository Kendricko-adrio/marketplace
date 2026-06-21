export type HomepageSectionType =
  | "banner"
  | "carousel_product"
  | "promo_cards"
  | "announcement_bar"
  | "store_banner";

export interface BannerContent {
  imageUrl: string;
  altText?: string;
  ctaText?: string;
  ctaLink?: string;
}

export interface PromoCardItem {
  id: string;
  imageUrl: string;
  title: string;
  linkUrl?: string;
}

export interface PromoCardsContent {
  cards: PromoCardItem[];
}

export interface AnnouncementBarContent {
  message: string;
  variant?: "info" | "warning" | "success";
}

export interface HomepageProduct {
  id: string;
  name: string;
  slug: string;
  price: number;
  basePrice: number;
  image: string | null;
  rating: string | null;
  sold: number;
  isFlashSale: boolean;
  flashSalePrice: string | null;
}

export interface HomepageBranch {
  id: string;
  name: string;
  code: string;
  city: string;
  address: string;
  latitude: string | null;
  longitude: string | null;
  operatingHours: import("../store/types").OperatingHours;
  googleMapsUrl: string | null;
  status: string;
}

export interface HomepageSectionData {
  id: string;
  type: HomepageSectionType;
  title: string | null;
  subtitle: string | null;
  content: unknown;
  displayOrder: number;
  isActive: boolean;
  products?: HomepageProduct[];
  branches?: HomepageBranch[];
}