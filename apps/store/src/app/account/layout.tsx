import { requireOnboardedClient } from "@/lib/server-access";

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  await requireOnboardedClient();
  return children;
}
