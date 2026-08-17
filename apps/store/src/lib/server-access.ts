import { auth } from "@/lib/auth";
import { getClientAccessError } from "@/lib/client-access";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export async function requireOnboardedClient() {
  const session = await auth.api.getSession({ headers: await headers() });
  const accessError = getClientAccessError(session?.user);
  if (accessError?.code === "UNAUTHORIZED") redirect("/login");
  if (accessError?.code === "ONBOARDING_REQUIRED") redirect("/onboarding");
  return session!;
}
