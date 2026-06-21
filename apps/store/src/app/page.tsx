import { HomepageSectionRenderer, type HomepageSectionData } from "@marketplace/ui";

async function getHomepageSections(): Promise<HomepageSectionData[]> {
  try {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/homepage`,
      { cache: "no-store" }
    );
    const data = await res.json();
    return data.success ? (data.data as HomepageSectionData[]) : [];
  } catch (error) {
    console.error("Error fetching homepage sections:", error);
    return [];
  }
}

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