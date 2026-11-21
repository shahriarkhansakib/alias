# How AI coding agents find their instructions in this repo

We write agent instructions **once**, in tool-neutral files, and generate the few tool-specific
files some agents need. Edit only the sources; run `pnpm agents:sync`; CI runs `pnpm agents:check`
and fails if the generated files are out of date.

## Sources (edit these)

| File                     | Purpose                                                                                              |
| ------------------------ | ---------------------------------------------------------------------------------------------------- |
| `AGENTS.md` (root)       | Project-wide instructions: commands, architecture, testing, git, security.                           |
| `<folder>/AGENTS.md`     | Extra instructions for one area (`apps/api`, `apps/web`, `packages/contracts`, each API module).     |
| `.agents/rules/*.md`     | Short, focused rules. Frontmatter `trigger: always_on`, or `trigger: glob` with `globs` (see below). |
| `.agents/skills/<name>/` | `SKILL.md` plus any files it needs: procedures an agent loads when the task matches (Agent Skills).  |
| `.agents/claude-code.md` | Claude-Code-only notes, appended to the root `CLAUDE.md`.                                            |

`globs` is either a comma-separated string (`globs: "apps/web/**, packages/ui/**"`) or a YAML list
(`globs:` followed by `  - "apps/web/**"` lines). Use the list form for patterns containing commas,
such as `src/{a,b}/**`.

The Claude-Code-only file is `claude-code.md`, not `claude.md`: on Windows and macOS file names
ignore case, so Claude Code would load a `claude.md` as a nested `CLAUDE.md`.

## Generated (never edit)

| File                                 | Generated from           | Why it exists                                                                               |
| ------------------------------------ | ------------------------ | ------------------------------------------------------------------------------------------- |
| `CLAUDE.md` next to each `AGENTS.md` | `AGENTS.md`              | Claude Code reads `CLAUDE.md`, not `AGENTS.md`; the file just imports it with `@AGENTS.md`. |
| `.claude/rules/*.md`                 | `.agents/rules/*.md`     | Claude Code's rule format uses `paths:` instead of `trigger`/`globs`.                       |
| `.claude/skills/<name>/`             | `.agents/skills/<name>/` | Claude Code looks for skills in `.claude/skills/`.                                          |
| `.claude/.generated-manifest.json`   | the sync script          | Lists every generated file, so the script knows what it may delete.                         |

We generate copies instead of using symlinks because symlinks need administrator rights or
Developer Mode on Windows. `.gitattributes` marks the generated files `linguist-generated`, so
GitHub collapses them in pull request diffs.

How `scripts/sync-agent-config.mjs` behaves (tests: `pnpm test:scripts`):

- Text files (`.md`, `.markdown`, `.txt`) are read with any UTF-8 BOM removed and CRLF turned into
  LF, and written with LF. Other skill files (images, scripts) are copied byte for byte.
- It deletes a generated file only when the manifest lists it and its source is gone.
- Any other file in `.claude/rules/` or `.claude/skills/` is reported as unexpected and never
  deleted; the script exits 1 until you move it into `.agents/` or delete it yourself.
- `--check` changes nothing and exits 1 if a generated file is missing, out of date, stale or
  unexpected.

## Claude Code permissions (`.claude/settings.json`)

- `ask`: `git push` (Bash and PowerShell) always asks for approval, even in Auto mode.
- `deny`: `Read` rules for `.env`, `.env.local`, `.env.development`, `.env.test`, `.env.staging`,
  `.env.production` and their `.local` forms, at any depth. Claude Code applies them to its file
  tools and, in shell commands it can analyse, to `<` redirects and to commands it recognises such
  as `cat`, `head`, `tail`, `sed` and `tee`.
- `deny`: Bash and PowerShell rules for any command that names one of those files as an argument
  (`cat .env`, `source apps/api/.env`, `Get-Content .env.local`). This also blocks
  `cp .env.example .env`; a person runs that setup step.

What these rules do **not** block: commands that read a file without naming it (`grep -r SECRET .`),
programs that open files themselves (a Node or Python script), the same command written another way
(`sh -c '…'`, a full program path, a variable holding the file name), and files outside the folder
Claude Code was started in. Permission rules match command text; they are not a security boundary.
If we need real enforcement later, the answer is Claude Code's sandbox (OS-level file and network
isolation for shell commands) with the unsandboxed retry turned off.

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
