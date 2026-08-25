# Commit Message Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a project-level Claude Code skill at `.claude/skills/commit-messages/SKILL.md` that documents the repo's Conventional Commits convention, so Claude auto-follows it whenever it creates a commit in this repo.

**Architecture:** Single new Markdown file with `name`/`description` frontmatter (the description is the auto-trigger text) plus a body documenting format, scope rules, subject/body style, the no-AI-traces rule, and worked examples. No code, no other files.

**Tech Stack:** Markdown, YAML frontmatter.

**Spec:** `docs/superpowers/specs/2026-08-25-commit-message-skill-design.md`

## Global Constraints

- Skill lives at `.claude/skills/commit-messages/SKILL.md` (project-level, not `~/.claude/skills/`).
- Frontmatter `description` must read as a "Use when X" auto-trigger clause, matching the pattern other skills in this environment use (spec's "Location and trigger" section).
- Scope values are short workspace directory names only: `client`, `realtime`, `web-standards`, `config-typescript` — never the full `@capstone/*` package name (spec's "Commit message format" section).
- A change spanning multiple workspaces is split into one commit per workspace, each with its own scope — never combined into one unscoped or multi-scoped commit (spec's "Scope and multi-workspace changes" section).
- No-scope commits (`<type>: <summary>`, no parentheses) are reserved for indivisible root-level/cross-cutting changes only (spec's "Scope and multi-workspace changes" section).
- No AI-authorship traces in any commit message: no `Co-Authored-By: Claude`, no "Generated with Claude Code" line, no session URL (spec's "Commit message format" section).

---

### Task 1: Create the commit-messages skill file

**Files:**
- Create: `.claude/skills/commit-messages/SKILL.md`

**Interfaces:**
- Consumes: nothing (pure documentation, no code interfaces, only task in this plan).
- Produces: nothing consumed by other tasks.

- [ ] **Step 1: Create the directory and write the skill file**

Write the following exact content to `.claude/skills/commit-messages/SKILL.md`:

```markdown
---
name: commit-messages
description: Use when creating a git commit in this repository — defines the required Conventional Commits format, workspace scope, and bullet-point body style.
---

# Commit Messages

## Format

```
<type>(<scope>): <short imperative summary>

- <bullet describing one concrete change>
- <bullet describing another concrete change>
```

**Type** — one of the standard Conventional Commits types: `feat`, `fix`, `docs`, `refactor`, `chore`, `test`, `style`, `perf`, `build`, `ci`.

**Scope** — the short workspace directory name: `client`, `realtime`, `web-standards`, `config-typescript`. Never the full `@capstone/*` package name.

**Subject** — imperative mood ("add", not "added"/"adds"), short but informational (states what changed, not just "fix bug"), no trailing period.

**Body** — short bullet points (`- `), one line each, each describing one concrete change. Not prose paragraphs, not a restatement of the subject. Keep the whole body terse — a summary, not a changelog entry.

## Scope and multi-workspace changes

A commit's scope is always the single workspace it touches. When a change genuinely spans multiple workspaces (e.g. a file in `apps/worker-client` and a file in `apps/worker-realtime` in the same unit of work), **split it into separate commits, one per workspace, each with its own scope** — never one commit with no scope or a combined scope.

**No-scope commits** are reserved for changes that are inherently one indivisible unit spanning the whole repo and cannot be meaningfully split — e.g. editing root `CLAUDE.md`, `turbo.json`, `biome.json`, or root `package.json`. These use `<type>: <summary>` with no parenthesized scope.

## No AI traces

Never add a `Co-Authored-By: Claude` line, a "Generated with Claude Code" line, a session URL, or any other marker that the commit was authored by an AI assistant.

## Examples

```
feat(client): add screen-share toggle to room controls

- add ScreenShareButton component to room toolbar
- wire toggle state through useRoomControls hook
```

```
fix(realtime): prevent duplicate socket registration on reconnect

- guard Messenger.onConnect against re-registering an existing session id
```

```
docs: document branching strategy in CLAUDE.md
```

(root-level change touching only `CLAUDE.md` — no scope, since it's not workspace-specific)
```

- [ ] **Step 2: Verify frontmatter and structure**

Run: `grep -n "^---\|^name:\|^description:\|^## " /home/sono/virtual-classroom/.claude/skills/commit-messages/SKILL.md`

Expected output (in this order): two `---` lines bracketing the frontmatter, `name: commit-messages`, `description: Use when creating a git commit...`, then section headers `## Format`, `## Scope and multi-workspace changes`, `## No AI traces`, `## Examples`.

- [ ] **Step 3: Verify the file matches the spec's rules**

Read `/home/sono/virtual-classroom/.claude/skills/commit-messages/SKILL.md` back and confirm against `docs/superpowers/specs/2026-08-25-commit-message-skill-design.md`:
- All 10 Conventional Commits types listed match the spec's "Commit message format" section.
- The four scope values match the spec exactly: `client`, `realtime`, `web-standards`, `config-typescript`.
- The multi-workspace split-commit rule and the no-scope exception both appear and match the spec's "Scope and multi-workspace changes" section wording.
- All three worked examples from the spec's "Examples" section are present verbatim.
- The no-AI-traces rule is present and matches the spec's "Commit message format" section.

- [ ] **Step 4: Commit**

`.claude/skills/` is repo-root tooling, not any one workspace — per the skill's own no-scope rule for indivisible root-level changes, this commit has no scope:

```bash
git add .claude/skills/commit-messages/SKILL.md
git commit -m "$(cat <<'EOF'
chore: add commit-messages skill

- add .claude/skills/commit-messages/SKILL.md documenting Conventional
  Commits format, per-workspace scope, and no-AI-traces rule
EOF
)"
```
