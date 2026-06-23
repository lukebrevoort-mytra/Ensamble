# Ensemble

**A coordinated crew of specialist agents — and you.**

Ensemble turns Claude Code's native **Workflow engine** into three repo-aware
software-development workflows — `/spec`, `/execute`, `/review` — that you drop into
*any* repository. They read the repo, tune themselves to it, fan out specialist
subagents, adversarially verify their own findings, and keep **you** in the
decisions. Orchestrated agents; human-owned calls.

```
/spec     idea     →  an implementation-ready spec, grounded in your code
/execute  spec     →  built, looping until every criterion is proven
/review   pr|branch →  the change mapped, the calls yours to make
```

---

## Why it's different

Most "AI review/build" tools sweep your code and hand down a verdict. Ensemble is
built on three principles that keep it grounded and keep you involved:

- **🎻 Native orchestration.** Each command is a thin launcher that calls Claude's
  Workflow engine — deterministic fan-out, schema-validated output, adversarial
  verification, budget-scaled depth. Not a prompt pretending to be a pipeline.
- **🪵 Repo-aware.** A one-time install reads your repo and interviews you, writing a
  profile (commands, test/sim harnesses, MCP services, specialist roster,
  **non-negotiables**). Every spawned agent re-orients on it and the in-scope files —
  no naked subagents guessing at your conventions.
- **🤝 Human-in-the-loop.** Workflows *prepare* decisions; **you make them.** `/review`
  leads with a **Change Map** so you understand the shape before any finding,
  separates objective bugs from judgment calls, and lets you own the verdict.

---

## The three workflows

| Command | Phases | You get |
|---|---|---|
| **`/spec`** | Scope → Gather (parallel explorers) → Draft → adversarial Critique | An implementation-ready spec with testable criteria, anchored to real code |
| **`/execute`** | Plan → **Implement ⇄ Verify loop** → Checks | Working code; the loop won't stop until criteria **and** your repo's mandatory evidence (e.g. a passing test, a UI screenshot) exist |
| **`/review`** | Shape → Review → Verify → Checks | A Change Map (chat + visual artifact), findings tagged bug / judgment / intent-question, and a verdict **you** set |

All three **scale to the work** — a tiny change spawns a couple of agents; "audit this
thoroughly" spawns adversarial panels — bounded by your token budget.

---

## Quickstart — apply to any repo

**Prerequisites:** Claude Code with the native Workflow tool · `git` · `gh` (for PR
review) · `node` (only for the optional script validator).

### 1. Get Ensemble and expose the installer globally *(once per machine)*

```sh
# clone anywhere — the installer finds itself relative to this checkout
git clone <ensemble-repo-url> ~/.claude/ensemble

# make /ensemble-install available in every repo
ln -sf ~/.claude/ensemble/commands/ensemble-install.md ~/.claude/commands/ensemble-install.md
```

### 2. Install into a target repo *(once per repo)*

```
cd path/to/your/repo
```
Then, in Claude Code, run:
```
/ensemble-install
```
It copies the portable layer into `.claude/`, runs **recon** on your stack, **reads
your design docs**, **interviews you** (canonical commands, test/sim harnesses, MCP
services, the specialist roster, what's off-limits, and your **mandatory
requirements**), and writes `.claude/ensemble/repo-profile.md`.

> Commit `.claude/` — the workflows and profile are shared with your team. The
> gitignored `.workflows/` holds scratch and handoff artifacts.

### 3. Use it

```
/spec     "add refresh-token rotation"        # → .workflows/spec-*.md
/execute  .workflows/spec-refresh-rotation.md # → builds it, looping until proven
/review                                        # → reviews the current branch
/review   1234                                 # → reviews PR #1234
```

Re-running `/ensemble-install` updates the portable layer (contract + commands +
scripts) **without touching** your `repo-profile.md`.

---

## What a `/review` feels like

This is the human-in-the-loop model in action:

1. **Intake** — it detects whether you're the **author** or the **reviewer**, confirms
   it, and asks one question: what to focus on / what's intentional or out-of-scope.
2. **Comprehension first** — it shows a **Change Map** (intent · structure · a numbered
   reading-order walk · hotspots) in chat *and* as a house-style visual artifact, so
   you understand the change before seeing a single finding.
3. **Facts vs. judgment** — objective bugs are stated as facts (and adversarially
   verified); judgment calls and intent-questions come to **you**, each with a prepared
   question, options, and a recommendation.
4. **You decide** — adjudicate what matters (nits are listed, not nagged), and **you**
   own the verdict. As reviewer, it then offers to post your kept findings as PR
   comments — never without your confirmation.

---

## What gets installed

```
<repo>/.claude/                ← committed; shared with the team
  ensemble/
    CONTRACT.md                portable operating contract (identical everywhere)
    repo-profile.md            this repo's profile — the only per-repo file
  commands/
    spec.md  execute.md  review.md
  workflows/
    spec.js  execute.js  review.js   resolve as Workflow({name:"…"})
<repo>/.workflows/             ← gitignored scratch — recon.md · spec-*.md · review-*.md
```

The **only** per-repo file you maintain is `repo-profile.md`. Everything else is the
portable layer, identical across every repo.

---

## Key ideas

- **Mandatory requirements** — non-negotiables you declare at install (a test that must
  pass, a cycle that must run, a screenshot that must be produced). Enforced as a
  *loop*: `/execute` won't finish without the evidence; `/review` won't approve without
  it.
- **Per-phase compute (effort-first)** — cheap effort for mechanical phases, high for
  hard reasoning; tunable per repo, model pinned only when truly warranted.
- **Evidence discipline** — every claim is tagged FACT ✓ / ASSUMPTION ~ / QUESTION ? /
  BLOCKED ⛔. Proof and guesswork never blur.

---

## Learn more

- **`docs/architecture.html`** — the visual architecture overview (open in a browser).
- **`CONTRACT.md`** — the portable operating contract every workflow obeys.
- **`PLAN.md`** — the living design doc and rationale.
- **`tools/validate-workflows.mjs`** — CI guard: `node tools/validate-workflows.mjs`
  checks every workflow script parses and respects the sandbox rules.
