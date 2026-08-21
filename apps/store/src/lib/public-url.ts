/**
 * Returns the URL that users can reach from outside the app container.
 *
 * Request-derived origins are not safe for redirects behind a reverse proxy:
 * Next.js can see the container bind address (for example 0.0.0.0:3000).
 */
export function getPublicAppUrl(): string {
  return (
    process.env.BETTER_AUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000"
  );
}
