# Matt Pocock skills in the marketplace

These skills were vendored unchanged from [`mattpocock/skills`](https://github.com/mattpocock/skills/tree/c55ee46073ed923f86ce59a5eb3b6d895095d1b7/skills) at commit `c55ee46073ed923f86ce59a5eb3b6d895095d1b7`. Their MIT notice is at [`.agents/skills/MATTPOCOCK-LICENSE`](../../.agents/skills/MATTPOCOCK-LICENSE). They are local project skills, not global installs. They were copied directly rather than run through the `skills` CLI to avoid overwriting existing skills and user changes in `skills-lock.json`; **the new copies are not registered in that CLI's lock file**. Pin/reference this commit when updating them, review the diff and keep the repo-specific adaptations in [`.agents/skills/development-workflow/SKILL.md`](../../.agents/skills/development-workflow/SKILL.md), not in the vendored sources.

| Step | Newly vendored upstream skill | Notes |
|---|---|---|
| Alignment | `grilling`, `domain-modeling`, `grill-with-docs` | `grill-with-docs` is a user-invoked wrapper over the first two; `grill-me` was already installed. Human decisions stay with the user. |
| Test seams and module design | `codebase-design` | Reference used by the existing `tdd` skill when the interface or test seam itself needs designing; parallel-design examples do not authorize subagents. |
| External evidence or choice of UI/state shape | `research`, `prototype` | Use only when a concrete unresolved question justifies them. Research's background agent and prototype's commit are **not** pre-authorized. |
| Large, multi-session uncertainty | `wayfinder` | Decision tickets, not build tickets. Requires a tracker decision before its normal publishing/map flow. |
| Approved spec and breakdown | `to-tickets`, `setup-matt-pocock-skills` | `to-spec` was already installed; `to-tickets` requires tracker setup and user approval of the ticket breakdown. Setup itself makes repo edits and must not run silently. |
| One approved implementation slice | `implement` | Its automatic commit instruction is subject to `AGENTS.md`: no commit without user authorization. Existing `tdd` skill remains in place. |
| Independent review | `code-review` | Its parallel subagents require explicit opt-in. It normally reviews committed diffs, so include staged/working-tree changes in local review. |

Not installed: `ask-matt` (its generic routing may conflict with our approved project flow), `triage` (incoming issue tracker work, not our default on-ramp), `diagnosing-bugs` (this repo already uses `systematic-debugging`), and duplicate copies of `grill-me`, `tdd`, and `to-spec`. No existing skill was overwritten.

## Before using a tracker-dependent skill

This repo currently has [`plan/index.md`](../../plan/index.md) and [`tasks.md`](../../tasks.md), but **not** Matt's `docs/agents/issue-tracker.md` configuration. The plan index is not an issue tracker. Before publishing from `to-spec`, `to-tickets`, or `wayfinder`, ask the owner to choose an issue-tracker destination (GitHub Issues, local markdown, or an agreed alternative) and explicitly approve that configuration. The project plan lifecycle and Ready approval gate remain the source of truth for conceptual plans; do not silently create a parallel plan state machine. No setup skill or remote publication was run during installation.

## Pi and project policy

Pi discovers `SKILL.md` under `.agents/skills/` and initially exposes names/descriptions; full instructions are loaded on demand. Use `/reload` in an active Pi session to discover the new skills, and `/skill:<name>` to explicitly invoke one. `grilling` and `domain-modeling` also exist in the user's global skills directory, with different file contents: Pi may report a name collision and retain the first discovered copy. Check the startup skill diagnostics; read the project-local `SKILL.md` explicitly when the pinned project version matters (while respecting any global instructions requiring their own copy). Some upstream wrappers say “Call the Skill tool”, while Pi may only provide a `read` tool and `/skill:<name>` commands: load the relevant `SKILL.md` explicitly. A skill marked `disable-model-invocation: true` is for explicit invocation, not automatic selection.

Upstream instructions never override [`AGENTS.md`](../../AGENTS.md): owner approval for plans/tickets; subagents only after task/session opt-in; no automatic commits, pushes, remote actions, or deployments. The repo-specific [`development-workflow` skill](../../.agents/skills/development-workflow/SKILL.md) spells out those adaptations. Matt's skills provide optional disciplines, not authority to start an unapproved pipeline.
