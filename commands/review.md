---
description: Review workflow — review a branch or PR dynamically, inferring risk, spawning the right specialist reviewers, running checks, and giving a verdict with evidence
---

You are running the **Review workflow**. Goal: review the target branch/PR below,
infer where the risk actually is, verify findings, and deliver a verdict backed by
evidence and named residual risks — not a generic checklist pass.

First, load the rules:
1. Read `.claude/workflow-kit/CONTRACT.md` and follow it for the whole run.
2. If `.claude/workflow-kit/repo-profile.md` exists, read it and treat it as
   ground truth (canonical commands, services/MCPs, what blocks a merge here).

Then work the phases, readjusting per CONTRACT §4 whenever reality diverges:

**1 — Acquire the diff.** Resolve the target: a PR number/URL (`gh pr diff`), a
branch name, or default to the current branch vs its base. Find the base by
merge-base with the repo's default branch; don't assume `main`. Get the full diff,
the file list, and the PR description/linked issue if present. Establish the
changed surface as FACTs.

**2 — Infer risk & adapt.** From the diff, map which subsystems are touched and
what *kinds* of risk are present (security, data/migrations, concurrency, public
API/contract, performance, UI, build/release). Don't pre-commit to a fixed
checklist — let the diff choose the lenses. If the risk profile turns out
different than the first read, re-scope (CONTRACT §4) and log it.

**3 — Spawn specialist reviewers (runtime roles).** Instantiate the profile's
**Specialist roster** first (CONTRACT §3) — those named reviewers are this repo's
standing crew; spawn the ones whose trigger the diff matches. Then use the generic
table only to cover risk lenses the roster misses. Author each role prompt scoped
to the *specific changed files*; launch in parallel; each returns structured
findings with file:line evidence and severity. Also spawn a read-only explorer for
"does this change break callers elsewhere" sweeps.

**4 — Run the checks that matter.** Run the canonical build/typecheck/lint and the
tests covering the changed areas (scoped first, full set if feasible). **If the
diff falls in the blast radius of any profile Invariant, run that invariant's gate
test as a mandatory acceptance check** — a passing gate is the strongest evidence
the invariant held. Run the characteristic execution-mode checks too (e.g. evals
if behavior changed). Capture real output. If a check is blocked (no creds, no
env), record BLOCKED ⛔ and the best alternative evidence you could gather.

**5 — Verify findings adversarially.** Before reporting any finding, confirm it's
real: re-read the code, or have an independent pass try to refute it. Drop the ones
that don't survive. A plausible-but-unverified concern is an *Open question*, not a
finding. This is the difference between a review and a guess.

**6 — Verdict.** Emit the CONTRACT §5 report. The body section is the **verdict**:
`APPROVE` / `APPROVE WITH NITS` / `REQUEST CHANGES` / `BLOCK`, with findings grouped
by severity (each: file:line, why it matters, suggested fix) and explicit
**residual risks** (what you did *not* or *could not* verify). Save to
`.workflows/review-<slug>.md` and print inline. Recommend the next action.

Review the code; do not fix it here. If asked to fix, hand specific items to
`/execute`.

Target (PR number/URL, branch, or empty for current branch): $ARGUMENTS
