import { requireOnboardedClient } from "@/lib/server-access";

export default async function CartLayout({ children }: { children: React.ReactNode }) {
  await requireOnboardedClient();
  return children;
}
