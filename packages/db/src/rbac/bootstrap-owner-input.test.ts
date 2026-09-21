import { describe, it, expect } from "vitest";
import { parseArgs, resolvePassword } from "./bootstrap-owner-input";

// =========================================================
// Bootstrap CLI input parsing + secret resolution (pure)
// =========================================================
// Secrets must never be logged and must not have to travel through argv:
// --password-file and the RBAC_BOOTSTRAP_PASSWORD environment variable are
// the preferred channels; --password stays supported for scripted runs.

describe("parseArgs", () => {
  it("parses all supported flags", () => {
    expect(
      parseArgs([
        "--name",
        "System Owner",
        "--email",
        "owner@example.invalid",
        "--username",
        "owner",
        "--password",
        "secret123",
        "--password-file",
        "/run/secrets/pw",
      ])
    ).toEqual({
      name: "System Owner",
      email: "owner@example.invalid",
      username: "owner",
      password: "secret123",
      passwordFile: "/run/secrets/pw",
    });
  });

  it("ignores a flag with no following value", () => {
    expect(parseArgs(["--name", "--email", "a@b.co"])).toEqual({
      email: "a@b.co",
    });
  });

  it("returns an empty parse for no arguments", () => {
    expect(parseArgs([])).toEqual({});
  });
});

describe("resolvePassword", () => {
  const readFile = async (path: string): Promise<string> => {
    if (path === "/run/secrets/pw") return "from-file-secret\n";
    throw new Error("ENOENT");
  };

  it("prefers the password file over argv and env", async () => {
    expect(
      await resolvePassword({
        argvPassword: "from-argv",
        passwordFile: "/run/secrets/pw",
        envPassword: "from-env",
        readFile,
      })
    ).toBe("from-file-secret");
  });

  it("falls back to the env variable without a file", async () => {
    expect(
      await resolvePassword({
        argvPassword: "from-argv",
        envPassword: "from-env",
        readFile,
      })
    ).toBe("from-env");
  });

  it("falls back to argv when no file/env is provided", async () => {
    expect(
      await resolvePassword({ argvPassword: "from-argv", readFile })
    ).toBe("from-argv");
  });

  it("returns undefined when no channel supplies a secret", async () => {
    expect(await resolvePassword({ readFile })).toBeUndefined();
  });

  it("rejects an empty password file with a clear error", async () => {
    await expect(
      resolvePassword({
        passwordFile: "/run/secrets/pw",
        readFile: async () => "",
      })
    ).rejects.toThrow("empty");
  });

  it("rejects an unreadable password file with a clear error", async () => {
    await expect(
      resolvePassword({ passwordFile: "/nope", readFile })
    ).rejects.toThrow("password file");
  });
});