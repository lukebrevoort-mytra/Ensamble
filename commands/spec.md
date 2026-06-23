---
description: Spec workflow — turn an idea into an implementation-ready spec by exploring the repo and pinning down criteria, risks, and test strategy
---

You are running the **Spec workflow**. Goal: turn the request below into an
implementation-ready spec grounded in this repo's actual code and constraints —
not a generic plan.

First, load the operating rules and output format:
1. Read `.claude/workflow-kit/CONTRACT.md` and follow it for the whole run.
2. If `.claude/workflow-kit/repo-profile.md` exists, read it and treat it as
   ground truth (canonical commands, services/MCPs, subsystem owners, "done"
   bar). If it doesn't exist, proceed from detection and flag the gap.

Then work the phases, readjusting per CONTRACT §4 whenever reality diverges:

**1 — Orient.** Load `.workflows/recon.md` if fresh; otherwise run CONTRACT §1
recon and cache it. Establish language, layout, test framework, and the canonical
build/typecheck/lint/test commands as FACTs.

**2 — Gather context.** Find *all* code the request touches or depends on. For
broad "where/how" sweeps, spawn read-only explorer subagents in parallel (one per
subsystem), each returning file:line evidence — don't dump raw output, synthesize.
Read the real implementations, not just names. Find 2–3 existing patterns similar
to what's being asked so the spec can say "build it like X at file:line".

**3 — Define the spec.** Produce, each item tagged per CONTRACT §2:
   - **Problem statement** — the change in one paragraph, in this repo's terms.
   - **Acceptance criteria** — concrete, *testable* checks (Given/When/Then or a
     checklist). Each must be verifiable by a command or observable behavior.
   - **Affected areas** — files/modules/interfaces to change, by file:line, plus
     blast radius (callers, consumers, schemas, configs). **Flag which profile
     Invariants the change touches** — their gate tests become mandatory acceptance
     criteria downstream.
   - **Approach** — the intended implementation shape, anchored to existing
     patterns; call out alternatives only where the choice is real.
   - **Test strategy** — mapped to the *detected* framework: what to test, at what
     level (unit/integration/e2e), how to run just those tests, and any
     fixtures/sims/services from `repo-profile.md` to use.
   - **Risks** — and a mitigation for each.
   - **Open questions** — anything that needs a human decision before/within build,
     including collisions with any *open architecture decisions* the design docs
     list as not-yet-locked.

**4 — Report & hand off.** Emit the CONTRACT §5 report with the spec as the body
section. Save it to `.workflows/spec-<slug>.md` (and print inline). End with the
recommended next action — typically `/execute .workflows/spec-<slug>.md`, or the
questions that must be answered first.

Do not start implementing. A great spec makes the build boring.

Request: $ARGUMENTS
