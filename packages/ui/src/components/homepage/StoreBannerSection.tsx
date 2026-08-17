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
      <div className="flex gap-6 overflow-x-auto pb-4 snap-x snap-mandatory items-stretch -mx-4 px-4 [scrollbar-width:thin]">
        {branches.map((branch: HomepageBranch) => (
          <div
            key={branch.id}
            className="shrink-0 w-[85vw] sm:w-[320px] lg:w-[340px] snap-start flex"
          >
            <BranchCard branch={branch} showOperatingHours={false} />
          </div>
        ))}
      </div>
    </section>
  );
}