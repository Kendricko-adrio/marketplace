import { getHomepageSections } from "@/lib/homepage";
import { SectionRenderer } from "@/components/homepage/SectionRenderer";

export const dynamic = "force-dynamic";

export default async function Home() {
  const sections = await getHomepageSections();

  return (
    <div className="flex flex-col">
      {sections.map((section) => (
        <SectionRenderer key={section.id} section={section} />
      ))}
    </div>
  );
}
