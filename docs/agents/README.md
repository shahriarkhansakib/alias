# How AI coding agents find their instructions in this repo

We write agent instructions **once**, in tool-neutral files, and generate the few tool-specific
files some agents need. Edit only the sources; run `pnpm agents:sync`; CI runs `pnpm agents:check`
and fails if the generated files are out of date.

## Sources (edit these)

| File                             | Purpose                                                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `AGENTS.md` (root)               | Project-wide instructions: commands, architecture, testing, git, security.                             |
| `<folder>/AGENTS.md`             | Extra instructions for one area (`apps/api`, `apps/web`, `packages/contracts`, each API module).       |
| `.agents/rules/*.md`             | Short, focused rules. Frontmatter `trigger: always_on`, or `trigger: glob` with `globs: "a/**, b/**"`. |
| `.agents/skills/<name>/SKILL.md` | Step-by-step procedures an agent loads when the task matches (Agent Skills format).                    |

## Generated (never edit)

| File                                 | Generated from           | Why it exists                                                                               |
| ------------------------------------ | ------------------------ | ------------------------------------------------------------------------------------------- |
| `CLAUDE.md` next to each `AGENTS.md` | `AGENTS.md`              | Claude Code reads `CLAUDE.md`, not `AGENTS.md`; the file just imports it with `@AGENTS.md`. |
| `.claude/rules/*.md`                 | `.agents/rules/*.md`     | Claude Code's rule format uses `paths:` instead of `trigger`/`globs`.                       |
| `.claude/skills/<name>/`             | `.agents/skills/<name>/` | Claude Code looks for skills in `.claude/skills/`.                                          |

We generate copies instead of using symlinks because symlinks need administrator rights or
Developer Mode on Windows.

## What each tool reads

| Tool                                                                                                     | Reads                                                                                                                                      | Notes                                                                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code                                                                                              | `CLAUDE.md` (root at launch; nested ones when it reads files in that folder), `.claude/rules/`, `.claude/skills/`, `.claude/settings.json` | Rules with `paths` load only when matching files are read.                                                                                                                                                 |
| Antigravity                                                                                              | `AGENTS.md` / `GEMINI.md` in the workspace folder and its parents, `.agents/rules/*.md`, `.agents/skills/`                                 | Does **not** load `AGENTS.md` from subfolders; the root `AGENTS.md` therefore tells every agent to read the nearest `AGENTS.md` before editing. Rule files without a valid `trigger` are silently ignored. |
| Codex, Cursor, GitHub Copilot coding agent, Gemini CLI, Windsurf, Zed, JetBrains Junie, Aider and others | `AGENTS.md`; the nearest one in the folder tree wins                                                                                       | Listed as supporting AGENTS.md at agents.md. Each may also have its own rules folder; we do not maintain those.                                                                                            |

## Adding things

- **A rule:** create `.agents/rules/<topic>.md` with `trigger: always_on` (use sparingly: it costs
  context on every turn) or `trigger: glob`. For knowledge needed only sometimes, write a skill.
- **A skill:** create `.agents/skills/<name>/SKILL.md` with `name` and `description` frontmatter.
  The description decides when agents load it, so say what it does and when to use it.
- **A module's instructions:** create `<module>/AGENTS.md` with What it does / How it works / Why.

Then run `pnpm agents:sync` and commit everything, including the generated files.

## Why the file name is `AGENTS.md`

`AGENTS.md` (upper case, plural) is the open convention agents look for. An `agent.md` would be
found by no tool automatically.
