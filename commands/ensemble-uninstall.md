---
description: Remove Ensemble from a repo — delete the portable layer (CONTRACT + commands + workflows) and scratch, cleanly, from one repo or every install under a root. Preserves your personal repo-profile.md unless --purge. The safe counterpart to /ensemble-install.
---

Cleanly remove **Ensemble** from a repo: delete the portable layer the install
placed under `.claude/`, drop the `.workflows/` scratch cache, and undo the
`.gitignore` lines install appended — **without** touching your other commands,
your git history, or (by default) your personal `repo-profile.md`. Mechanical
only: file removal + report, no agents, no Workflow tool.

The portable layer = the 9 files install owns, and only these:
`.claude/ensemble/CONTRACT.md`, `.claude/commands/{ensemble-spec,ensemble-execute,ensemble-review,ensemble-debug}.md`,
`.claude/workflows/{ensemble-spec,ensemble-execute,ensemble-review,ensemble-debug}.js`.

## 1 — Locate the source kit (`<KIT>`)
Resolve `<KIT>` (the Ensemble repo holding `commands/`, `workflows/`, `templates/`),
first that resolves wins:
1. an explicit `--kit <path>` in `$ARGUMENTS`;
2. the `$ENSEMBLE_KIT` env var;
3. **auto-detect** from this command's install: `readlink ~/.claude/commands/ensemble-uninstall.md`
   (or `ensemble-install.md`) → `<KIT>/commands/…` → `<KIT>` is its grandparent.
`<KIT>` is only needed to know the canonical file list (above) — if you can't resolve
it, that list is fixed and you may proceed anyway; note it in the report.

## 2 — Resolve the target repos
Parse `$ARGUMENTS`:
- a **single repo path** (contains `.claude/ensemble/CONTRACT.md`) → just that repo;
- empty → the **current working directory** if it's an install, else stop and ask;
- `--all [<root>]` → **scan** `<root>` (default: cwd) for every directory containing
  `.claude/ensemble/CONTRACT.md` and remove from them all;
- `--check` (any target form) → **dry-run**: report exactly what would be removed and
  kept, delete nothing;
- `--purge` → also delete the personal `.claude/ensemble/repo-profile.md` (default: keep it);
- `--wfwatch` → also remove the machine-global `~/.claude/bin/wfwatch` symlink (default: keep;
  it is shared across every install — see §5).

`.claude/ensemble/CONTRACT.md` is the install marker; a dir without it is not an
Ensemble install — skip it. **List the targets and the exact files each removal will
delete before touching anything.** Never write or delete outside a resolved repo root.

## 3 — Remove the portable layer (per target, safe & idempotent)
For each target repo:
1. Delete the 9 portable files listed above **if present** — and nothing else in
   `.claude/commands/` or `.claude/workflows/`. Those dirs may hold the user's own
   commands/scripts; leave every non-`ensemble-*` file untouched.
2. Delete the `.workflows/` scratch cache (recon + handoff artifacts — all regenerable).
3. **repo-profile.md** — this is the user's personal, human-maintained config
   (CONTRACT §7). **Keep it by default** and say so in the report. Only delete it under
   `--purge`. If it exists, is tracked in git, and has **uncommitted changes**, never
   delete it even with `--purge` — surface it and let the user decide (never discard
   uncommitted work).
4. **Prune now-empty dirs only:** remove `.claude/ensemble/` and `.claude/workflows/`
   **iff** they are empty after step 1–3; remove `.claude/commands/` iff empty; never
   remove `.claude/` itself if anything else remains under it.

## 4 — Undo the .gitignore lines install added
In each target's `.gitignore`, remove the two lines install appended **iff they are
present**: `.workflows/` and `.claude/ensemble/repo-profile.md`. Leave every other line
intact; don't rewrite or reorder the file beyond dropping those exact entries. If a line
isn't there, do nothing. If the repo **tracks** `.claude/` in git
(`git -C <repo> ls-files .claude | head -1`), note that the deletions must be committed to
land upstream — **do not commit in target repos yourself.** Never discard uncommitted changes.

## 5 — Machine-global wfwatch (opt-in, shared)
`~/.claude/bin/wfwatch` is a **one-time machine-global** helper symlinked to the kit — it
is **not** per-repo and is shared by every install. **Leave it in place by default.** Only
under `--wfwatch` remove it (`rm ~/.claude/bin/wfwatch`), and only after confirming no other
Ensemble installs remain that would still want it. Never touch anything else under `~/.claude`.

## 6 — Report
Emit a compact CONTRACT §6-style summary:
- resolved `<KIT>` (or "n/a — used the fixed file list");
- a per-repo line: `repo — N portable files removed (names), .workflows/ cleared,
  gitignore lines removed (which), profile: kept|purged|kept-uncommitted, empty dirs pruned (which)`;
- whether `.claude/` is tracked (→ "commit the deletions in <repo>") or untracked (local-only);
- wfwatch: kept | removed;
- bottom line: Ensemble is gone from these repos; re-add anytime with `/ensemble-install`.

In `--check` mode, print the identical picture but state clearly that **nothing was written**.

Target (a repo path · empty for current repo · `--all [<root>]` to clean every install · `--check` dry-run · `--purge` also removes repo-profile.md · `--wfwatch` also removes the global symlink · `--kit <path>`): $ARGUMENTS
