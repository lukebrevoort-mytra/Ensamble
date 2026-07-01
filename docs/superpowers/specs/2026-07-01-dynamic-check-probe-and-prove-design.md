# Dynamic Check — Probe & Prove

**Date:** 2026-07-01
**Status:** Canonical design (supersedes `2026-07-01-dynamic-user-shaped-verification-design.md`).
**Landed 2026-07-01:** the *runtime* frozen-command gate — CONTRACT §4.11 + the four launchers now run a
recorded/human-confirmed real-run check deterministically (no per-run probe derivation, no LLM judge).
**Deferred:** the *install-time* Probe & Prove auto-capture below (the ladder + committed `.ensemble/dynamic-check`
emission) — a focused follow-up. Until then, the gate consumes a check recorded at install or promoted from an execute lock.
**Scope:** `/ensemble-install`, `repo-profile.md` + `.ensemble/dynamic-check`, `/ensemble-execute`, `/ensemble-review`, `/ensemble-update`

## Problem

Green unit tests prove code satisfies assertions the same agent wrote. They do
**not** prove the system is *alive* — that the service boots, the endpoint
answers, the UI renders, the flow works. The kit already has the *conceptual*
scaffolding for dynamic verification (mandatory-requirement gates, the
tool-awareness rule, a "characteristic execution & verification mode" profile
section), but it is all **descriptive prose**. `repo-profile.md` says "a browser
MCP for UI verification"; it never captures a concrete, runnable *recipe*. So
runs re-derive verification every time and fall back to the path of least
resistance — unit tests.

**The gap is at the moment of capture, not in the runtime machinery.** Nothing
concrete and runnable is ever recorded, so nothing concrete is ever enforced.

## Decisions (locked)

1. **Fix capture, not runtime.** The leverage is making install emit something
   concrete and runnable instead of a vague sentence.
2. **Probe & prove.** Install *actively* boots and exercises the system and saves
   a recipe **only if it ran green once**. If it can't, it records `BLOCKED` with
   the reason and how far it got. It never fabricates a green.
3. **Aim for full behavioral.** The probe climbs a ladder and targets the top
   rung (drive the real flow + capture a screenshot/scenario), degrading down as
   the environment forces. Representative, not exhaustive — the goal is proving
   the *dynamic flow is alive*, not test coverage.
4. **Rails + runnable script (architecture "B").** The proven recipe lives in
   `repo-profile.md` *and* is emitted as a committed, runnable
   `.ensemble/dynamic-check`. Runtime consumes it through the existing
   mandatory-requirement gate — **no fifth workflow.** The script is the "get
   users" piece: a human or CI can run it directly.
5. **Script-first artifact.** `.ensemble/dynamic-check` is a self-contained
   script (a subcommand per flow) with a tiny sidecar `.json` holding
   `appliesWhen` → flow, rung, `provenAt`, and proof paths for the agents.

## The ladder

The probe climbs and records the **highest rung actually achieved**; lower rungs
are the automatic fallback.

| Rung | Name | What it proves | How |
|------|------|----------------|-----|
| 0 | Discover | (setup) start cmd, ports, health path, one representative flow, seed data, teardown | `profile-probe.js` + recon; interview only to fill gaps |
| 1 | Boot + reach | It starts and answers at its interface | run start cmd, wait (timeout-bounded), port open / health 200 / `--help` |
| 2 | Functional smoke | It's up *and doing the thing* | one real interaction returns an expected result (seeded query, endpoint shape, golden CLI output) |
| 3 | Behavioral | The real user-facing flow works | drive the flow (browser MCP → screenshot) or run a representative sim/eval scenario |

**Degradation is mandatory.** Many real repos can't be fully booted at install
(cloud creds, GPU, heavy infra). When a rung fails or the environment blocks, the
probe stops climbing, records the highest rung reached, and marks the rest
`BLOCKED` with why. Teardown is guaranteed (trap) regardless of outcome.

## Design

### 1. Install: the "Probe & Prove" phase

A new step in `/ensemble-install`, after recon, agent-driven:

1. **Discover (rung 0):** infer start/health/flow/seed/teardown from
   `profile-probe.js` + recon. Interview the user **only for gaps** the probe
   couldn't infer — not a fresh vague interview.
2. **Climb (rungs 1→3):** attempt each rung in order, capturing real output at
   each. Stop at the first failure/block. Time-box every wait so install can't
   hang.
3. **Prove:** a recipe is written **only for rungs that ran green**. Proof
   artifacts (screenshots, curl output, scenario logs) land in `.ensemble/proof/`.
4. **Record honestly:** highest rung + exact working commands → recipe. Anything
   unreachable → `BLOCKED` with the reason.

The behavioral rung (rung 3) splits by capability:
- **Repo has an e2e harness** (Playwright/Cypress/sim runner): the probe writes a
  committed e2e/scenario invocation into the script — runnable by CI and humans.
- **No harness:** the behavioral step is an *agent-time browser-MCP* step
  described in the sidecar (`tool: browser-mcp`, steps, expected proof). The
  shell script still owns rungs 1–2 deterministically.

This split keeps "runnable by a human/CI" truthful: the script is genuinely
runnable through functional smoke; behavioral is committed-e2e when possible,
agent-driven otherwise.

### 2. Artifacts written

**`repo-profile.md` gains a `## Dynamic check` block** — the human-readable,
portable record (part of the per-repo layer, alongside everything
`/ensemble-update` preserves):

```
## Dynamic check — PROVEN at install 2026-07-01 (highest rung: behavioral)
- flow `orders` — appliesWhen: api/orders/**, web/orders/**
  up:        docker compose up -d && ./scripts/wait-for-ready.sh
  exercise:  curl -fsS :8080/api/orders/seed-123 → .status == "picked"
             browser MCP: open :3000/orders/seed-123, screenshot
  assert:    status "picked" AND order timeline rendered
  teardown:  docker compose down
  proof:     .ensemble/proof/orders-flow.png · orders-curl.txt
  fallbackRung: functional-smoke
- flow `planner` — BLOCKED: needs GPU sim host unavailable at install. Reached rung 1 (boots, health 200).
```

**`.ensemble/dynamic-check`** — committed, executable, self-contained (owns rungs
1–2; calls the repo's e2e for rung 3 when present):

```bash
#!/usr/bin/env bash
# Ensemble dynamic check — proven at install. Re-runnable by humans, CI, and agents.
# Usage: ./.ensemble/dynamic-check [flow|all]   (default: all)
set -euo pipefail
FLOW="${1:-all}"

up()       { docker compose up -d && ./scripts/wait-for-ready.sh; }
teardown() { docker compose down; }
trap teardown EXIT

flow_orders() {  # rung: behavioral · appliesWhen: api/orders/** web/orders/**
  curl -fsS localhost:8080/api/orders/seed-123 | jq -e '.status=="picked"'  # rung 2
  npx playwright test orders.spec.ts                                         # rung 3 (if present)
}

run() { case "$1" in orders) flow_orders ;; *) echo "unknown flow: $1" >&2; exit 2 ;; esac; }

up
if [ "$FLOW" = all ]; then run orders; else run "$FLOW"; fi
echo "dynamic-check OK: $FLOW"
```

**`.ensemble/dynamic-check.json`** — sidecar for agent selection & metadata:

```json
{
  "provenAt": "2026-07-01",
  "highestRung": "behavioral",
  "flows": [
    {
      "name": "orders",
      "rung": "behavioral",
      "appliesWhen": ["api/orders/**", "web/orders/**"],
      "command": "./.ensemble/dynamic-check orders",
      "behavioral": {
        "mode": "e2e",
        "detail": "npx playwright test orders.spec.ts",
        "proof": ".ensemble/proof/orders-flow.png"
      },
      "fallbackRung": "functional-smoke"
    },
    {
      "name": "planner",
      "rung": "blocked",
      "blockedReason": "needs GPU sim host unavailable at install; reached rung 1",
      "appliesWhen": ["planner/**"]
    }
  ]
}
```

**`.ensemble/proof/`** — install-captured artifacts. Gitignored; regenerated on
every run/re-probe.

### 3. Runtime wiring (no new workflow)

The recipe threads in as `args.dynamicCheck` (from the profile/sidecar), exactly
like `args.tools` does today. It is an **auto-generated mandatory requirement
with a runnable body**:

- **`/ensemble-execute`** — final-checks phase: select flows whose `appliesWhen`
  matches the diff, run `./.ensemble/dynamic-check <flow>`, and require **fresh**
  proof from *this* run (not install's). A covered surface whose check isn't green
  → not `complete`. Can't boot (same env limits) → `BLOCKED` with why.
- **`/ensemble-review`** — checks phase: run the matching flows against the
  changed surface. Unmet → **cannot APPROVE** (`REQUEST CHANGES` if fixable,
  `BLOCK` if unrunnable) — identical to how unmet mandatory requirements behave
  today.

Selection is `appliesWhen`-driven: a diff touching only `docs/` runs nothing; a
diff under `api/orders/**` runs the `orders` flow.

### 4. Anti-rot & safety

- **Self-healing pressure:** runtime always *re-runs* the check for fresh proof,
  so a rotted recipe (moved port, renamed endpoint) fails loudly at
  execute/review instead of silently passing.
- **Re-prove:** `/ensemble-update --reprobe` re-runs the probe, refreshes the
  recipe, script, and `provenAt`. Plain `/ensemble-update` leaves it untouched
  (preserves the per-repo layer, as today).
- **Staleness signal:** `provenAt` surfaced in output; flag when old.
- **Safety:** local/ephemeral only; seed/fixture data; **never** prod or shared
  infra; timeout-bounded so it can't hang; guaranteed teardown; proof stays local.
  Honors the Mytra AI-use policy — local app runs are fine, no data exfiltration.

## Testing the feature itself

The kit is dogfooded against its own dev repos + a small matrix of archetypes:
an HTTP service (boot + curl), a browser UI (boot + screenshot), a CLI (golden
output), and a can't-boot case (verify it records `BLOCKED`, does **not**
fabricate a recipe). Assert: green only when actually green; degrade correctly;
teardown always runs; `appliesWhen` selection picks the right flows.

## Out of scope (YAGNI)

- A fifth `/ensemble-verify` workflow (architecture "C"). Revisit only if
  dynamic-verify earns its own front door.
- A declarative manifest-driven runner (artifact "manifest-first"). Script-first
  chosen for adoptability.
- Exhaustive e2e coverage. This proves the flow is *alive*, not fully tested.
- Provisioning cloud/infra to make un-bootable repos bootable. Those record
  `BLOCKED` honestly.

## Open questions

- Exact home of the per-repo `.ensemble/` dir vs where `repo-profile.md` lives
  today — confirm against the current install layout before implementing.
- Whether `.ensemble/proof/` should ever be committed as install evidence, or
  always gitignored (leaning: always gitignored).
