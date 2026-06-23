---
description: Install the Spec/Execute/Review workflow kit into the current repo and retrofit it to the repo's real stack, tests, services, and conventions
---

Install the portable workflow kit into the **current repo** and specialize it so
the `/spec`, `/execute`, and `/review` workflows are tuned to *this* repo.

Source of truth for the kit: the **workflow-kit repo** (default
`~/work/mytra/workflow-kit/`; i.e. the directory that contains this command's
sibling `commands/` and `templates/`). Referred to below as `<KIT>`.

Do this:

**1 — Safety & target check.** Confirm the working directory is a git repo (`git
rev-parse --show-toplevel`). If not, stop and ask the user for the target repo
path. Never write outside the repo root. If `.claude/commands/spec.md` already
exists, treat this as an update: diff against the kit and ask before overwriting
human-edited files (never clobber a customized `repo-profile.md`).

**2 — Copy the portable layer.** Into `<repo>/.claude/`:
   - `workflow-kit/CONTRACT.md`  ← from `<KIT>/CONTRACT.md`
   - `commands/spec.md`          ← from `<KIT>/commands/spec.md`
   - `commands/execute.md`       ← from `<KIT>/commands/execute.md`
   - `commands/review.md`        ← from `<KIT>/commands/review.md`
   These are identical across repos; copy verbatim.

**3 — Gitignore the scratch space.** Ensure `.workflows/` is in the repo's
`.gitignore` (append if missing). `.claude/` itself stays committed so the team
shares the workflows.

**4 — Deep recon.** Run CONTRACT §1 recon against this repo for real — detect
languages, layout, subsystems, test framework, and the canonical
build/typecheck/lint/test commands (read CI config for the authoritative ones).
Verify commands exist rather than guessing. Cache the result to `.workflows/recon.md`.

**4b — Derive repo character (the actual superpower — do NOT skip).** Detection of
commands is table stakes; *understanding what this repo is* is what makes the
workflows differ from a generic checklist. **Actually read** the architecture/PRD/
design docs (`README`, `docs/`, `ARCHITECTURE.md`, ADRs) and skim the defining
modules — don't just point at them. Then derive, with citations:
   - **Repo character** — what this system fundamentally is and its dominant axes
     (simulation-heavy? data-intensive UI? airgapped agent? high-concurrency
     service?). What does "correct" mean here?
   - **Non-negotiable invariants → gate tests** — find the properties that must
     never regress and the *exact existing test/command* that proves each (e.g. an
     egress negative test, a read-only AST scan, a migration-reversibility check).
   - **Specialist roster** — the 3–6 named subagents this repo's work
     characteristically needs (not the generic table) — each with when-to-spawn,
     scope, and the checks it owns.
   - **Characteristic execution & verification mode** — how a change is actually
     proven done here (eval/grounding deltas? sim scenarios? browser flows? soak?).
   A simulation-heavy k8s repo and a data-intensive UI repo must come out of this
   step with *different rosters and different acceptance models*. If they don't,
   you did this step wrong.

**5 — Retrofit interview (the high-value step).** Detection can't know everything.
Present your derived character/roster/invariants/execution-mode from 4b for the
user to confirm or correct, then fill remaining gaps —
Using what recon found as a starting point, interview the user with
`AskUserQuestion` to fill the gaps that make the workflows *infinitely more
useful* — ask only what you couldn't confidently detect, and offer your detected
values as the default option:
   - the canonical commands you're unsure about (esp. single/scoped test runs);
   - **test/simulation/fixture harnesses** the agents should drive;
   - **MCP servers / local services** connected to this repo and when agents may
     use them (DB, browser, issue tracker, docs) — this is what makes the agents
     repo-aware;
   - subsystem boundaries / ownership and any do-not-touch areas;
   - the **definition of done / merge bar** and default branch;
   - security-sensitive surfaces to always review hard.

**6 — Write the profile.** Populate `<repo>/.claude/workflow-kit/repo-profile.md`
from `<KIT>/templates/repo-profile.template.md`, filling detected
+ confirmed values. The **Repo character**, **Invariants & gate tests**,
**Specialist roster**, and **Execution mode** sections (from step 4b) are
mandatory — a profile without them is just a command list and defeats the purpose.
Mark anything still unverified with `~`. This file is committed and human-maintained.

**7 — Report.** Emit a short CONTRACT §5-style summary: what was installed, the
detected stack/commands (FACTs), what the interview resolved, and what remains an
open question. Tell the user they can now run `/spec`, `/execute`, `/review` in
this repo, and that re-running `/workflow-install` updates the portable layer
without touching `repo-profile.md`.

Optional argument (target repo path, if not the current directory): $ARGUMENTS
