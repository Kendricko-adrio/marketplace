import { headers, cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { IdentityForm } from "@/components/onboarding/identity-form";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect("/login?callbackUrl=/onboarding");
  }

  // Already onboarded? No reason to stay here.
  const user = session.user as typeof session.user & {
    onboardingCompleted?: boolean;
  };

  if (user.onboardingCompleted) {
    // If the edge cookie is missing/expired, bounce through a route handler
    // that re-syncs it before sending the user home. Without this, middleware
    // would bounce us straight back here in an infinite redirect loop.
    const cookieStore = await cookies();
    if (cookieStore.get("client.onboarding")?.value !== "1") {
      redirect("/api/onboarding/sync");
    }
    redirect("/");
  }

  return (
    <div className="container mx-auto px-4 py-16 flex justify-center items-center min-h-[calc(100vh-4rem)]">
      <IdentityForm />
    </div>
  );
}