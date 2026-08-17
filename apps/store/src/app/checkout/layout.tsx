import { requireOnboardedClient } from "@/lib/server-access";

export default async function CheckoutLayout({ children }: { children: React.ReactNode }) {
  await requireOnboardedClient();
  return children;
}
