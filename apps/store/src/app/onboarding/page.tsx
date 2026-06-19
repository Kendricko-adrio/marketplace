import { headers } from "next/headers";
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
    redirect("/");
  }

  return (
    <div className="container mx-auto px-4 py-16 flex justify-center items-center min-h-[calc(100vh-4rem)]">
      <IdentityForm />
    </div>
  );
}