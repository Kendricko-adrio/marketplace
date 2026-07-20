import { Suspense } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import AdminLoginForm from "./login-form";
import { Loader2 } from "lucide-react";

// Server component entry point.
//
// Why a server component (previously a client component with a useEffect that
// redirected authenticated users away from /login):
//
// The old useEffect read from `useSession()` — Better Auth's nanostore-backed
// reactive hook. After logout, the in-memory session state is invalidated
// asynchronously (~10ms+ via an internal setTimeout in the client proxy). When
// the router navigated to /login immediately after `await signOut()`, the
// login page mounted and the useEffect ran BEFORE the reactive state had
// cleared — so `session` was still non-null with `isPending=false`, and the
// effect pushed the user back to `/admin`. The admin layout then read the
// (already-deleted) cookie server-side, redirected back to /login, and the
// cycle repeated — a visible redirect loop / "logout doesn't work" bug.
//
// Reading the session server-side uses the authoritative cookie state (the
// cookie is deleted synchronously by the signOut endpoint), so there is no
// race. This also eliminates the client-side useSession subscribe entirely
// from the login page, removing a class of cache/refresh timing bugs.
//
// We still need the ?callbackUrl search param, so we wrap the form in Suspense
// (useSearchParams requires it in Next.js 16).
export default async function AdminLoginPage() {
  const session = await auth.api.getSession({ headers: await headers() });

  if (session) {
    const mustReset = (session.user as { mustResetPassword?: boolean })
      .mustResetPassword;
    if (mustReset) {
      redirect("/reset-password?force=1");
    } else {
      redirect("/admin");
    }
  }

  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-background px-4 py-16">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      }
    >
      <AdminLoginForm />
    </Suspense>
  );
}