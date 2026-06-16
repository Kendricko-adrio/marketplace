import {
  Footprints,
  Zap,
  Briefcase,
  Shirt,
  Sun,
  Mountain,
  type LucideIcon,
} from "lucide-react";

const iconMap: Record<string, LucideIcon> = {
  Footprints,
  Zap,
  Briefcase,
  Shirt,
  Sun,
  Mountain,
};

interface CategoryIconProps {
  name?: string | null;
  className?: string;
}

export default function CategoryIcon({ name, className }: CategoryIconProps) {
  if (name && name in iconMap) {
    const Icon = iconMap[name];
    return <Icon className={className} />;
  }

  return <div className={className + " bg-muted rounded-full"} />;
}
