import { HomepageSectionRenderer, type HomepageSectionData } from "@marketplace/ui";
import { GET as getHomepageResponse } from "@/app/api/homepage/route";

async function getHomepageSections(): Promise<HomepageSectionData[]> {
  const res = await getHomepageResponse();
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error || "Failed to load homepage sections");
  }
  return data.data as HomepageSectionData[];
}

export const dynamic = "force-dynamic";

export default async function Home() {
  const sections = await getHomepageSections();

  const announcement = sections.find((s) => s.type === "announcement_bar");
  const rest = sections.filter((s) => s.type !== "announcement_bar");

  return (
    <div>
      {announcement && (
        <HomepageSectionRenderer section={announcement} />
      )}
      {rest.map((section) => (
        <HomepageSectionRenderer key={section.id} section={section} />
      ))}
    </div>
  );
}
