# DeepSeek Harness tool mapping

Superpowers skills describe **actions** ("read a file", "dispatch a subagent",
"create a todo") and never name a tool. This file translates that action
vocabulary into the real DeepSeek Harness machine names. If a tool below is not
in your catalog, the action is unavailable — use the skill's own fallback
wording, and never invent a tool call.

## Core mapping

| Action (as the skills word it) | DSH tool | Notes |
|---|---|---|
| Read a file | `read` | Line-numbered text. For a large file continue with `offset`/`limit` instead of re-reading from the top. |
| Create or overwrite a file | `write` | Full replacement. Read the file first if it already exists. |
| Edit a file | `edit` | Literal `old_string` → `new_string`. Prefer this over `write` for existing files. |
| Delete a file | `bash` (`rm`) | No dedicated delete tool. |
| Run a shell command | `bash` | Long-running work: pass `run_in_background: true` and collect with `job_output`. |
| Search file contents | `grep` | Dedicated tool; prefer it over shell `grep`/`rg`. |
| Find files by name/path | `glob` | Dedicated tool; prefer it over shell `find`. |
| Fetch a URL | `web_fetch` | Returns decoded text. |
| Search the web | `web_search` | Accepts 1–4 queries per call. |
| **Dispatch a subagent** | `subagent` | Use the default spawn provider: the child gets a **fresh context** and sees none of your session history. That is exactly what the skills require. |
| Give a subagent an explicit model | `subagent` model-selection argument | When a skill says "always specify the model explicitly", pass it here rather than letting the child inherit your route. |
| Collect or stop background work | `job_output` / `job_list` / `job_kill` | Applies to `run_in_background: true` calls. |
| **Create / update todos** | `todo_write` | This is what older Superpowers text calls `TodoWrite`. Send the whole list each call; it replaces the previous one. |
| Ask the human a question | `ask_user_question` | Reserve it for user-owned choices or ambiguity that inspection cannot resolve. |
| Deliver a file to the human | `present` | A file is not delivered by mentioning its path; call `present`. |
| **Invoke a skill** | `skill` | Pass the **exact** skill name. See the namespace note below. |
| Track a long-running objective | goal tools | Not part of the skills' vocabulary; available if you need durable cross-round continuity. |

## Do NOT use these for these actions

- **`subagent_fork`** — a forked child inherits your conversation. The skills are
  explicit that a dispatched subagent "should never inherit your session's
  context or history". Use `subagent`.
- **`workflow`** — the orchestration-script tool is for large fan-out. The
  skills' "dispatch a subagent" means one `subagent` call per task.

## Skill names are flat, not namespaced

Skills and diagrams in this library write skill references as
`superpowers:brainstorming`. DSH's `skill` tool takes the **bare** name and
validates it strictly:

- `superpowers:brainstorming` → call `skill` with `brainstorming`
- `superpowers:finishing-a-development-branch` → `skill` with `finishing-a-development-branch`

Passing the namespaced form fails with `Error: invalid skill name`.

## Where the skills live

All skills in this library are discovered by the filesystem provider, one
directory per skill under this preset's own `skills/`. Load one with the `skill`
tool; a loaded result also tells you the skill's resource base directory, so
`references/...`, `scripts/...`, and `*-prompt.md` paths inside a skill resolve
relative to that base.

Reading a `SKILL.md` directly with `read` is a **fallback only** — the `skill`
tool is the platform mechanism. Two cases still need direct reads:

1. A resource file the loaded skill points at (`references/`, templates,
   reviewer prompts) — those are not skills and are not in the catalog.
2. If the `skill` tool is genuinely absent from the catalog.

## Sandbox and repository reality (read before `using-git-worktrees`)

This harness runs the agent under a file sandbox whose writable root is the
session workspace. That changes two skills' default assumptions:

- **`using-git-worktrees`** — create worktrees **inside the workspace**, e.g.
  `<cwd>/.worktrees/<branch>`. A worktree outside the workspace root will be
  refused by policy. If creation is refused, follow that skill's documented
  sandbox fallback and tell the human you are working in the current directory
  instead — do not silently pretend isolation exists.
- **`finishing-a-development-branch`** — verifying tests and presenting the
  merge/PR/keep/discard options is in scope. `git push`, opening a PR, and
  merging are **human actions**: present them, do not execute them unattended.

## Repository rules outrank these skills

The workspace's own instruction files (`AGENTS.md`, `CLAUDE.md`, local overlays)
take precedence over every skill, and so does a direct human request. Typical
repository rules that override generic skill advice:

- commit message format and the "one subsystem per commit" rule,
- required disclosure that work was AI-assisted,
- no fabricated test results or claims of testing that did not run,
- no automatic commits or pushes when the repository forbids them.
