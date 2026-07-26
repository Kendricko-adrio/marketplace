import BranchCard from "../store/BranchCard";
import type { HomepageSectionData, HomepageBranch } from "./types";

interface StoreBannerSectionProps {
  section: HomepageSectionData;
  preview?: boolean;
}

export default function StoreBannerSection({
  section,
  preview: _preview,
}: StoreBannerSectionProps) {
  const branches = section.branches ?? [];

  if (branches.length === 0) return null;

  return (
    <section className="container mx-auto px-4 py-8">
      {section.title && (
        <h2 className="text-xl sm:text-2xl font-bold mb-4">{section.title}</h2>
      )}
      {section.subtitle && (
        <p className="text-sm text-muted-foreground mb-4">{section.subtitle}</p>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {branches.map((branch: HomepageBranch) => (
          <BranchCard key={branch.id} branch={branch} />
        ))}
      </div>
    </section>
  );
}