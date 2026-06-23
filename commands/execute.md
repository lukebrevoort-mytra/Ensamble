---
description: Execution workflow — implement a spec adaptively with TDD where it fits, revising the plan as reality emerges, until criteria are met and checks pass
---

You are running the **Execution workflow**. Goal: implement the spec below
adaptively and finish only when the acceptance criteria are met **and** the
relevant checks pass — with evidence.

First, load the rules and the spec:
1. Read `.claude/workflow-kit/CONTRACT.md` and follow it for the whole run.
2. If `.claude/workflow-kit/repo-profile.md` exists, read it and treat it as
   ground truth (canonical commands, test/sim harnesses, services/MCPs, "done"
   bar).
3. Resolve the input below to a spec: if it's a path (e.g. `.workflows/spec-*.md`)
   read it; if it's pasted spec text, use it; if it's a raw request with no spec,
   produce a lightweight inline spec first (problem + acceptance criteria + test
   strategy) and proceed.

Then work the loop, readjusting per CONTRACT §4 whenever reality diverges:

**1 — Orient & lock criteria.** Load/refresh `.workflows/recon.md`. Restate the
acceptance criteria as a checklist; these are your definition of done. **Add any
profile Invariants whose blast radius this change touches — their gate tests are
non-negotiable acceptance criteria.** Note the profile's characteristic execution
mode (eval/sim/browser/etc.) — you'll converge against *that* signal, not just
"tests green". Confirm the canonical commands as FACTs by checking they exist.

**2 — Decompose.** Break the work into small, independently verifiable tasks and
track them with the task tools. Sequence by dependency; note which tasks have a
real test path and which don't.

**3 — Implement, task by task.** For each task:
   - **TDD when a test path exists:** write a failing test that encodes the
     criterion → implement the minimum to pass → confirm green → refactor. When no
     test path exists, say so (BLOCKED ⛔ on TDD) and fall back to a characterization
     test or a runtime smoke check, and note it.
   - Match existing conventions (you found patterns in recon; mirror them).
   - After each meaningful change, run the **scoped** checks (the single test/
     subset, then typecheck/lint) and capture real output as evidence.
   - Delegate scoped sub-work or hard bugs to runtime-authored subagents per
     CONTRACT §3 — prefer the profile's **Specialist roster** (e.g. its invariant
     guardian or domain reviewer) before the generic table; keep the main thread
     integrating.

**4 — Readjust as you learn.** Hidden coupling, a wrong assumption in the spec, an
unavailable test path, a blocked check — when these surface, update the task list,
log the delta in *Readjustments*, and continue. Don't grind a broken plan.

**5 — Converge.** Loop steps 3–4 until **every** acceptance criterion is satisfied
and the relevant checks pass — including the profile's invariant gate tests and its
characteristic acceptance signal (run the execution-mode harness, e.g. evals, when
the change warrants it). Then run the full relevant check set
(build + typecheck + lint + tests) once more and capture the output. If failures
persist after a couple of focused attempts, escalate to a deep-debug investigator
rather than thrashing. Optionally run a `verifier` pass as an independent gate.

**6 — Report.** Emit the CONTRACT §5 report. The body section is a **task ledger**
(each task → done/blocked + the criterion it satisfies) and the *Evidence / checks
run* table must show the actual final commands and results. State plainly which
criteria are met (FACT ✓) and which are not. Recommend the next action — typically
`/review` of the resulting branch.

Spec or request: $ARGUMENTS
