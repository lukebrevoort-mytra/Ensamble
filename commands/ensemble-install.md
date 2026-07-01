---
description: Install Ensemble — the Spec/Execute/Review/Debug workflows — into the current repo and retrofit them to its real stack, tests, services, and conventions
---

Install **Ensemble** — the portable `/ensemble-spec`, `/ensemble-execute`, `/ensemble-review`, `/ensemble-debug` workflows
— into the **current repo** and specialize them to *this* repo.

Source of truth: the **Ensemble source repo** (wherever you cloned it — e.g.
`~/work/mytra/workflow-kit/`; the directory that contains this command's sibling
`commands/`, `workflows/`, and `templates/`). Referred to below as `<KIT>`.

Do this:

**1 — Safety & target check.** Confirm the working directory is a git repo (`git
rev-parse --show-toplevel`). If not, stop and ask the user for the target repo
path. Never write outside the repo root. If `.claude/commands/ensemble-spec.md` already
exists, treat this as an update: diff against the kit and ask before overwriting
human-edited files (never clobber a customized `repo-profile.md`).

**2 — Copy the portable layer.** Into `<repo>/.claude/`:
   - `ensemble/CONTRACT.md`      ← from `<KIT>/CONTRACT.md`
   - `commands/ensemble-spec.md`          ← from `<KIT>/commands/ensemble-spec.md`
   - `commands/ensemble-execute.md`       ← from `<KIT>/commands/ensemble-execute.md`
   - `commands/ensemble-review.md`        ← from `<KIT>/commands/ensemble-review.md`
   - `commands/ensemble-debug.md`         ← from `<KIT>/commands/ensemble-debug.md`
   - `workflows/ensemble-spec.js`         ← from `<KIT>/workflows/ensemble-spec.js`
   - `workflows/ensemble-execute.js`      ← from `<KIT>/workflows/ensemble-execute.js`
   - `workflows/ensemble-review.js`       ← from `<KIT>/workflows/ensemble-review.js`
   - `workflows/ensemble-debug.js`        ← from `<KIT>/workflows/ensemble-debug.js`
     These four are the **native workflow scripts** the commands launch via the
     Workflow tool; they go in `.claude/workflows/` so they resolve as named
     workflows (`Workflow({name: "ensemble-spec"|"ensemble-execute"|"ensemble-review"|"ensemble-debug"})`). Copy all four.
   These are identical across repos; copy verbatim.

**3 — Gitignore scratch + personal config.** Ensure the repo's `.gitignore` contains
(append any missing): `.workflows/` (scratch/handoff) and `.claude/ensemble/repo-profile.md`
(your **personal** repo profile — which doubles as your personal gate library, CONTRACT
§4.11). `.claude/` itself stays committed so the team shares the *kit* (commands + workflow
scripts) — but the **config is personal**: the profile is yours, gitignored, never assumed
shared (you *may* commit it to share). This is the "kit shared, config personal" split
(CONTRACT §7).

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
     characteristically needs (not the generic table) — each with its `agentType`
     (the real native agent the script will spawn: `Explore`/`oracle`/`verifier`/
     `uiux`/`general-purpose` or a custom type), when-to-spawn, scope, and the
     checks it owns. The workflow scripts read these fields verbatim, so be exact.
   - **Repo tools for evidence** — the specific MCP servers / local services /
     harnesses reviewers and executors should use (and their tool ids), so the
     scripts can name them in every agent brief (CONTRACT §4.4) instead of letting
     orchestrated agents guess.
   - **Characteristic execution & verification mode** — how a change is actually
     proven done here (eval/grounding deltas? sim scenarios? browser flows? soak?).
   - **Live real-run verification (CONTRACT §4.11 — the highest-value gate)** — the
     *concrete, runnable* form of the above: can this repo prove a change **through the
     real running service the way a user hits it**? Detect the boot command (dev/run
     script, `docker compose`, devcontainer), its health signal, a **runnable check** that
     proves the flow (a `curl … | assert`, an e2e/scenario invocation, or a browser-MCP
     recipe), and teardown. This is what makes the loop's "done" trustworthy — great
     real-run testing is the whole thesis. If the repo has no runnable service/flow, note
     that (the gate won't apply).
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
   - **Essential success tests** (high value — this seeds `/ensemble-execute`'s criteria lock):
     which *existing* suites/tests/checks the user treats as the **ground-truth signal
     that a change actually succeeded** (not just "tests exist"), and **when each
     applies**. The agents can infer acceptance criteria from a spec, but they can miss
     the one suite the user most trusts — asking here guarantees `/ensemble-execute` assembles it
     into the locked "done" contract every run. Record as `essentialTests: [{test,
     appliesWhen}]`. Distinct from invariants (properties that never regress) and from
     mandatory requirements (process/evidence gates): these are the positive
     "did it work?" signals. Surface your best guesses and let the user confirm/add.
   - **Live real-run method** (CONTRACT §4.11 — the highest-value elicitation) —
     detect → propose → ask: present your derived boot command / health signal / **runnable
     real-run check(s)** / teardown from 4b and ask the user to confirm or correct — *"here's
     how the loop will prove a change works through the real service — right?"*. If you
     couldn't detect a runnable flow, ask whether one exists and how to start it. Populate the
     profile's **Live real-run verification** section as recorded checks keyed by
     `appliesWhen`; if there genuinely is no runnable service, say so and omit the section
     (the gate won't apply).
   - **test/simulation/fixture harnesses** the agents should drive;
   - **MCP servers / local services** connected to this repo and when agents may
     use them (DB, browser, issue tracker, docs) — this is what makes the agents
     repo-aware;
   - subsystem boundaries / ownership and any do-not-touch areas;
   - the **definition of done / merge bar** and default branch;
   - security-sensitive surfaces to always review hard;
   - **which tools/services agents SHOULD and SHOULD NOT use** — if recon found an
     MCP/service but it's unclear whether agents may drive it (cost, creds, side
     effects, production data), ask explicitly rather than guessing;
   - **Mandatory requirements** (the heart of tuning this repo) — ask what must
     ALWAYS hold for a change here and how it's proven: a test that must pass, a
     cycle that must run (eval/sim/soak), a tool that must be used, an artifact that
     must be produced (e.g. a screenshot for any UI change). Record each as
     `{requirement, appliesWhen, requiredEvidence}`; these become the workflows'
     hard gates (CONTRACT §4.8). Surface your best guesses from 4b and let the user
     confirm, edit, or add — this is the step that "changes the workflow to fit the
     repo."
   - **Phase compute policy** (optional, effort-first) — only if this repo has a
     clear reason to retune compute per phase: a huge codebase where broad `gather`
     should be cheap (`effort: low`), or a safety-critical repo where `verify` must
     run at high effort or a stronger model. Capture as `phasePolicy: {phase:
     {effort, model}}` (CONTRACT §4.9). Defaults are fine for most repos — don't ask
     without a signal, and prefer `effort` over pinning a `model`.

**6 — Write the profile.** Populate `<repo>/.claude/ensemble/repo-profile.md`
from `<KIT>/templates/repo-profile.template.md`, filling detected
+ confirmed values. The **Repo character**, **Invariants & gate tests**,
**Essential success tests**, **Mandatory requirements**, **Specialist roster**,
**Execution mode**, and **Live real-run verification** (unless the repo has no runnable
flow) sections are mandatory — a profile without them is just a command list and defeats
the purpose.
Mark anything still unverified with `~`. This file is **personal and gitignored** (step 3),
human-maintained — your config, not shared team infra.

**7 — Report.** Emit a short CONTRACT §6-style summary: what was installed, the
detected stack/commands (FACTs), what the interview resolved, and what remains an
open question. Tell the user they can now run `/ensemble-spec`, `/ensemble-execute`, `/ensemble-review`, `/ensemble-debug`
in this repo, and that to pull later kit updates they can run **`/ensemble-update`**
(the light path — re-syncs the portable layer, no interview; `--all` updates every
install at once) or re-run `/ensemble-install` for a full retrofit — neither touches
`repo-profile.md`.
   Also point them at **`wfwatch`** — the live run viewer — as a one-time, machine-global
   setup (it is NOT per-repo; do not write outside this repo to install it). Check
   whether `~/.claude/bin/wfwatch` already exists; if not, tell the user to run once
   (resolving `<KIT>` to the actual kit path):
   `mkdir -p ~/.claude/bin && ln -sf <KIT>/tools/wfwatch ~/.claude/bin/wfwatch`
   and ensure `~/.claude/bin` is on their `PATH` (needs `python3`). Then `wfwatch` in a
   side terminal follows any run live.

Optional argument (target repo path, if not the current directory): $ARGUMENTS
