export { cn } from "./lib/utils";

export * from "./components/ui/avatar";
export * from "./components/ui/badge";
export * from "./components/ui/button";
export * from "./components/ui/card";
export * from "./components/ui/checkbox";
export * from "./components/ui/command";
export * from "./components/ui/dialog";
export * from "./components/ui/dropdown-menu";
export * from "./components/ui/form";
export * from "./components/ui/input";
export * from "./components/ui/label";
export * from "./components/ui/popover";
export * from "./components/ui/radio-group";
export * from "./components/ui/select";
export * from "./components/ui/separator";
export * from "./components/ui/sheet";
export * from "./components/ui/switch";
export * from "./components/ui/table";
export * from "./components/ui/tabs";
export * from "./components/ui/textarea";
export * from "./components/ui/sonner";
export * from "./components/ui/confirm-dialog";

export { default as ProductCard } from "./components/store/ProductCard";
export { default as BranchCard } from "./components/store/BranchCard";
export type {
  Branch,
  OperatingHours,
  DayHours,
} from "./components/store/types";

export { default as MarkdownRenderer } from "./components/markdown/MarkdownRenderer";
export type { MarkdownRendererProps } from "./components/markdown/MarkdownRenderer";

export { default as Footer } from "./components/footer/Footer";
export type { FooterConfigData } from "./components/footer/Footer";
export {
  SocialIcon,
  SOCIAL_PLATFORMS,
  SOCIAL_PLATFORM_LABELS,
} from "./components/footer/SocialIcons";
export type { SocialPlatform } from "./components/footer/SocialIcons";

export { default as HomepageSectionRenderer } from "./components/homepage/HomepageSectionRenderer";
export { default as BannerSection } from "./components/homepage/BannerSection";
export { default as CarouselProductSection } from "./components/homepage/CarouselProductSection";
export { default as PromoCardsSection } from "./components/homepage/PromoCardsSection";
export { default as AnnouncementBarSection } from "./components/homepage/AnnouncementBarSection";
export { default as StoreBannerSection } from "./components/homepage/StoreBannerSection";
export { buildProductFilterQuery } from "./components/homepage/PromoCardsSection";
export type {
  HomepageSectionType,
  BannerContent,
  BannerSlide,
  CarouselContent,
  CarouselSortOrder,
  ProductFilterConfig,
  PromoCardItem,
  PromoCardsContent,
  AnnouncementBarContent,
  HomepageProduct,
  HomepageBranch,
  HomepageSectionData,
} from "./components/homepage/types";