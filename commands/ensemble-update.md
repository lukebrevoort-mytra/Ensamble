---
description: Update an existing Ensemble install — re-sync the portable layer (CONTRACT + commands + workflows) from the kit into one repo or every installed repo under a root, preserving each repo's repo-profile.md. The light, non-interactive counterpart to /ensemble-install.
---

Re-sync the **portable layer** of Ensemble (the files that are identical in every
repo) from the source kit into already-installed repos, **without** re-running the
recon/interview and **without ever touching** the per-repo `repo-profile.md` or the
`.workflows/` cache. This is the one-command answer to "the kit changed; update my
repos." It is mechanical (file copy + validate) — no agents, no Workflow tool.

The portable layer = these 9 files, copied verbatim:
`CONTRACT.md → .claude/ensemble/CONTRACT.md`, `commands/{spec,execute,review,pulse}.md →
.claude/commands/`, `workflows/{spec,execute,review,pulse}.js → .claude/workflows/`.

## 1 — Locate the source kit (`<KIT>`)
Resolve `<KIT>` (the Ensemble repo that holds `commands/`, `workflows/`, `templates/`),
in this order — stop at the first that resolves:
1. an explicit kit path in `$ARGUMENTS` (e.g. `--kit <path>`);
2. the `$ENSEMBLE_KIT` env var;
3. **auto-detect** from this command's own install: `readlink ~/.claude/commands/ensemble-install.md`
   (or `ensemble-update.md`) → `<KIT>/commands/…` → `<KIT>` is its grandparent dir.
   This is the robust default since the management commands are symlinked out of the kit.
Confirm `<KIT>/workflows/execute.js` exists; if you can't resolve `<KIT>`, stop and ask.

**Pull latest** unless told `--no-pull`: `git -C <KIT> pull --ff-only`. If the kit has
uncommitted changes or the pull isn't fast-forward, skip it and note that you're syncing
the kit's **current working state** (say so in the report) rather than failing.

## 2 — Resolve the target repos
Parse `$ARGUMENTS`:
- a **single repo path** (contains `.claude/ensemble/CONTRACT.md`) → just that repo;
- empty → the **current working directory** if it's an install, else fall through to scan;
- `--all [<root>]` → **scan** `<root>` (default: the current working directory)
  for every directory containing `.claude/ensemble/CONTRACT.md` and update them all;
- `--check` (any target form) → **dry-run**: report staleness, copy nothing.

`.claude/ensemble/CONTRACT.md` is the install marker — a dir without it is not an
Ensemble install, skip it. List the targets you found before acting.

## 3 — Sync each target (idempotent, safe)
For each target repo, **diff first, then copy only what differs**, and report per file:
1. Compare each of the 9 portable files (`<KIT>` vs `<repo>/.claude/...`); copy the ones
   that differ, leave identical ones untouched. Record `updated` vs `current` per file.
2. **Never** modify `.claude/ensemble/repo-profile.md`, `.claude/settings*.json`, or
   anything under `.workflows/` — those are per-repo (human-maintained / scratch).
3. Ensure `.workflows/` is in the repo's `.gitignore` (append if missing) — same as install.
4. If the repo **tracks** `.claude/` in git (`git -C <repo> ls-files .claude | head -1`),
   note it so the user knows to commit the synced files there; if untracked, it's a
   local-only update (nothing to commit). **Do not commit in target repos yourself.**

## 4 — Validate
Run `node <KIT>/tools/validate-workflows.mjs` once (the copied scripts are byte-identical
to the kit's, so validating the source proves the copies). Report pass/fail. If it fails,
**stop and surface it** — do not leave repos half-synced with a broken script.

## 5 — Profile drift check (suggest, never edit)
For each target, compare the section headers in `<KIT>/templates/repo-profile.template.md`
against the repo's `repo-profile.md`. Report any template section the profile is **missing**
(e.g. a freshly-added `## Essential success tests`) as a suggested manual addition — these
unlock new behavior (that section seeds `/execute`'s criteria lock). **Never auto-edit the
profile**; just tell the user which repos would benefit from a quick `/ensemble-install`
re-interview or a hand-edit.

## 6 — Report
Emit a compact summary:
- the resolved `<KIT>` + whether it was pulled (and to which commit, via `git -C <KIT> rev-parse --short HEAD`);
- a per-repo line: `repo — N files updated (names), M current; validate ✓; tracked/untracked; profile gaps: <sections or none>`;
- the bottom line + next step (e.g. "run `/spec`/`/execute` to use the updates"; for tracked `.claude/`, "commit the synced files in <repo>").

In `--check` mode, report exactly the same staleness picture but state clearly that
nothing was written.

Target (a repo path · empty for current repo · `--all [<root>]` to sync every install · `--check` dry-run · `--kit <path>` / `--no-pull`): $ARGUMENTS
