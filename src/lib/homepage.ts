import { db } from "@/db";
import { homepageSections } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import type { HomepageSection } from "@/types/homepage";

export async function getHomepageSections(): Promise<HomepageSection[]> {
  const rows = await db
    .select()
    .from(homepageSections)
    .where(eq(homepageSections.isActive, true))
    .orderBy(asc(homepageSections.displayOrder));

  return rows.map((r) => ({
    ...r,
    type: r.type as HomepageSection["type"],
    config: (r.config as Record<string, unknown>) || {},
  }));
}
