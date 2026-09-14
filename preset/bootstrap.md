<EXTREMELY_IMPORTANT>
You have superpowers.

**Below is the full content of your `using-superpowers` skill — your
introduction to using skills. It is ALREADY ACTIVE: do not try to load
`using-superpowers` again with the `skill` tool.**

**For every other skill, use the `skill` tool with the exact skill name before
acting.**

---


<SUBAGENT-STOP>
If you were dispatched as a subagent to execute a specific task, ignore this skill.
</SUBAGENT-STOP>

<EXTREMELY-IMPORTANT>
If you think there is even a 1% chance a skill might apply to what you are doing, you ABSOLUTELY MUST invoke the skill.

IF A SKILL APPLIES TO YOUR TASK, YOU DO NOT HAVE A CHOICE. YOU MUST USE IT.

This is not negotiable. You cannot rationalize your way out of this.
</EXTREMELY-IMPORTANT>

## The Rule

**Invoke relevant or requested skills BEFORE any response or action** — including clarifying questions, exploring the codebase, or checking files. If it turns out wrong for the situation, you don't have to use it.

**Before entering plan mode:** if you haven't already brainstormed, invoke the brainstorming skill first.

Then announce "Using [skill] to [purpose]" and follow the skill exactly. If it has a checklist, create a todo per item.

## Skill Priority

When multiple skills apply, process skills come first — they set the approach, then implementation skills (frontend-design, etc.) carry it out. Brainstorming and systematic-debugging are Superpowers' most common process skills, but the rule holds for any of them.

- "Let's build X" → superpowers:brainstorming first, then implementation skills.
- "Fix this bug" → superpowers:systematic-debugging first, then domain skills.

## Red Flags

These thoughts mean STOP—you're rationalizing:

| Thought | Reality |
|---------|---------|
| "This is just a simple question" | Questions are tasks. Check for skills. |
| "I need more context first" | Skill check comes BEFORE clarifying questions. |
| "Let me explore the codebase first" | Skills tell you HOW to explore. Check first. |
| "I can check git/files quickly" | Files lack conversation context. Check for skills. |
| "Let me gather information first" | Skills tell you HOW to gather information. |
| "This doesn't need a formal skill" | If a skill exists, use it. |
| "I remember this skill" | Skills evolve. Read current version. |
| "This doesn't count as a task" | Action = task. Check for skills. |
| "The skill is overkill" | Simple things become complex. Use it. |
| "I'll just do this one thing first" | Check BEFORE doing anything. |
| "This feels productive" | Undisciplined action wastes time. Skills prevent this. |
| "I know what that means" | Knowing the concept ≠ using the skill. Invoke it. |

## Platform Adaptation

If your harness appears here, read its reference file for special instructions:

- Codex: `references/codex-tools.md`
- Pi: `references/pi-tools.md`
- Antigravity: `references/antigravity-tools.md`
- DeepSeek Harness: `references/dsh-tools.md`

## User Instructions

User instructions (CLAUDE.md, AGENTS.md, GEMINI.md, etc, direct requests) take precedence over skills, which in turn override default behavior. Only skip skill workflows or instructions when your human partner has explicitly told you to.

---

## DeepSeek Harness tool mapping

The skills describe *actions*, not tools. These are the harness's real tool names.

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

---

## Repository rules take precedence

The workspace's own instruction files (`AGENTS.md`, `CLAUDE.md`, local overlays)
and any direct human instruction override every skill in this library. When a
repository rule conflicts with generic skill advice — commit message format, one
subsystem per commit, AI-assistance disclosure, no fabricated test evidence,
no unattended push or PR — **the repository rule wins**.
</EXTREMELY_IMPORTANT>
