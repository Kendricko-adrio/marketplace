// =========================================================
// Bootstrap CLI input parsing + secret resolution (pure)
// =========================================================
// The password may arrive through three channels, in this order of
// preference:
//   1. --password-file <path>   (secret manager / mounted secret file)
//   2. RBAC_BOOTSTRAP_PASSWORD  (environment variable)
//   3. --password <value>       (argv; convenient for scripted runs but
//                                visible in the process list / shell history)
// The resolved secret is never logged. A password file must exist and be
// non-empty; its trailing newline (e.g. `echo` output) is trimmed.

export interface ParsedArgs {
  name?: string;
  email?: string;
  username?: string;
  password?: string;
  passwordFile?: string;
}

const FLAGS = [
  "--name",
  "--email",
  "--username",
  "--password",
  "--password-file",
] as const;

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const parsed: ParsedArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (!FLAGS.includes(arg as (typeof FLAGS)[number])) continue;
    if (next === undefined || next.startsWith("--")) continue;
    switch (arg) {
      case "--name":
        parsed.name = next;
        break;
      case "--email":
        parsed.email = next;
        break;
      case "--username":
        parsed.username = next;
        break;
      case "--password":
        parsed.password = next;
        break;
      case "--password-file":
        parsed.passwordFile = next;
        break;
    }
  }
  return parsed;
}

export interface PasswordInput {
  argvPassword?: string;
  passwordFile?: string;
  envPassword?: string;
  readFile?: (path: string) => Promise<string>;
}

/** Resolve the bootstrap password; undefined when no channel supplies one. */
export async function resolvePassword(input: PasswordInput): Promise<
  string | undefined
> {
  if (input.passwordFile) {
    if (!input.readFile) {
      throw new Error(
        "password file cannot be read in this environment"
      );
    }
    let content: string;
    try {
      content = await input.readFile(input.passwordFile);
    } catch {
      throw new Error(
        `password file could not be read: ${input.passwordFile}`
      );
    }
    const secret = content.replace(/\r?\n$/, "");
    if (secret === "") {
      throw new Error("password file is empty");
    }
    return secret;
  }
  if (input.envPassword !== undefined) return input.envPassword;
  return input.argvPassword;
}