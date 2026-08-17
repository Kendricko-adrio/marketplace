export function assertSeedEnvironmentSafe(
  env: { NODE_ENV?: string }
): void {
  if (env.NODE_ENV?.toLowerCase() === "production") {
    throw new Error("Refusing to seed a production database");
  }
}
