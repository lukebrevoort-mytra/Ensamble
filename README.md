# Ensemble

**A coordinated crew of specialist agents — and you.**

Ensemble turns Claude Code's native **Workflow engine** into four repo-aware
software-development workflows — `/spec`, `/execute`, `/review`, `/debug` — that you
drop into *any* repository. They read the repo, tune themselves to it, fan out
specialist subagents, adversarially verify their own findings, and keep **you** in the
decisions. Orchestrated agents; human-owned calls.

```
/spec     idea       →  an implementation-ready spec, grounded in your code
/execute  spec       →  you lock "done", the loop builds until every criterion is proven
/review   pr|branch  →  the change mapped, the calls yours to make
/debug    bug report →  reproduced, root-caused, and a route to the fix — you decide whether to take it
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

## The four workflows

| Command | Phases | You get |
|---|---|---|
| **`/spec`** | Scope → Gather (parallel explorers) → Draft → adversarial Critique | An implementation-ready spec with testable criteria, anchored to real code |
| **`/execute`** | Lock criteria with you → Plan → **Implement ⇄ independent Verify loop** → Checks | Working code. You confirm the passing criteria once up front; the loop runs autonomously to them (looping while it makes progress, not for a fixed count) and exits **complete / needs-you / blocked** — it won't report done until every criterion **and** your repo's mandatory evidence (a passing test, a UI screenshot) are proven |
| **`/review`** | Shape → Review → Verify → Checks | A Change Map (chat + visual artifact), findings tagged bug / judgment / intent-question, and a verdict **you** set |
| **`/debug`** | Locate → **Reproduce (always)** → Investigate (one per hypothesis) → adversarial Verify | A documented root cause backed by a real reproduction (the failing test/output), the alternatives it ruled out, and an evidence-backed **route to a fix** — which you hand to `/execute` or `/spec`. It diagnoses; it doesn't fix |

All four **scale to the work** — a tiny change spawns a couple of agents; "audit this
thoroughly" spawns adversarial panels — bounded by your token budget.

---

## Quickstart — apply to any repo

**Prerequisites:** Claude Code with the native Workflow tool · `git` · `gh` (for PR
review) · `node` (only for the optional script validator).

### 1. Get Ensemble and expose the installer globally *(once per machine)*

```sh
# clone anywhere — the installer finds itself relative to this checkout
git clone https://github.com/lukebrevoort-mytra/Ensamble ~/.claude/ensemble

# make /ensemble-install and /ensemble-update available in every repo
mkdir -p ~/.claude/commands   # ln won't create this dir; fresh machines may not have it
ln -sf ~/.claude/ensemble/commands/ensemble-install.md ~/.claude/commands/ensemble-install.md
ln -sf ~/.claude/ensemble/commands/ensemble-update.md  ~/.claude/commands/ensemble-update.md
```

> These are **symlinks** into your kit checkout, so `git pull` in `~/.claude/ensemble`
> updates the installer/updater themselves with no extra step.

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
/debug    "uploads >10MB 500 intermittently"  # → reproduces it, root-causes it, → .workflows/debug-*.md
/debug    4567                                 # → diagnoses the bug in issue #4567
```

### Keep installs current

When the kit improves, every repo that installed it is running an **older copy** of
the portable layer until you re-sync — a bug fix or new capability in the kit doesn't
reach a repo on its own. Pull the kit, then:

```
/ensemble-update                 # sync the current repo to the latest kit
/ensemble-update --all           # sync every install under the current dir (or pass a root)
/ensemble-update --all --check   # dry-run: report which repos are stale, change nothing
```

It copies only the portable layer (contract + commands + scripts), **never touches**
your `repo-profile.md`, diffs before writing, and validates the synced scripts. It's
the light counterpart to `/ensemble-install` — no recon, no interview. (Re-running
`/ensemble-install` also updates the portable layer, but re-runs the full retrofit.)

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
    spec.md  execute.md  review.md  debug.md
  workflows/
    spec.js  execute.js  review.js  debug.js   resolve as Workflow({name:"…"})
<repo>/.workflows/             ← gitignored scratch — recon.md · spec-*.md · review-*.md · debug-*.md
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
