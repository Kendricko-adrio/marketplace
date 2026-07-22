// Re-export shared types from the schema owner (packages/db) to avoid drift.
// The DB package is the single source of truth for content/type definitions.
export type {
  HomepageSectionType,
  ProductFilterConfig,
  CarouselSortOrder,
  BannerSlide,
  BannerContent,
  CarouselContent,
  PromoCardItem,
  PromoCardsContent,
  AnnouncementBarContent,
} from "@marketplace/db/src/schema/homepage";

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
  type: import("@marketplace/db/src/schema/homepage").HomepageSectionType;
  title: string | null;
  subtitle: string | null;
  content: unknown;
  displayOrder: number;
  isActive: boolean;
  products?: HomepageProduct[];
  branches?: HomepageBranch[];
}