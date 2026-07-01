# Dynamic Check — Probe & Prove

**Date:** 2026-07-01
**Status:** Canonical design (supersedes `2026-07-01-dynamic-user-shaped-verification-design.md`).
**Landed 2026-07-01:** the *runtime* frozen-command gate — CONTRACT §4.11 + the four launchers now run a
recorded/human-confirmed real-run check deterministically (no per-run probe derivation, no LLM judge).
**Artifact model — profile-section (decided 2026-07-01).** The recorded check lives in `repo-profile.md`'s
`## Live real-run verification` section, keyed by `appliesWhen` — **not** a committed `.ensemble/dynamic-check`
script. This aligns the design with the personal-tool vision that landed the same day (CONTRACT §7: the profile
is the personal, gitignored gate library). See "Artifact model" below for why script-first was dropped.
**Deferred / this doc's remaining build:** the *install-time* Probe & Prove auto-capture (the ladder) — a focused
follow-up. Until then, the gate consumes a check recorded by hand at install or promoted from an execute lock.
**Scope:** `/ensemble-install`, `repo-profile.md`'s `## Live real-run verification` section, `/ensemble-execute`,
`/ensemble-review`, `/ensemble-update --reprobe`.

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
4. **Profile-section artifact, no new workflow.** The proven recipe lives in
   `repo-profile.md`'s `## Live real-run verification` section as **runnable
   checks keyed by `appliesWhen`**. Runtime consumes it through the existing
   §4.11 mandatory-requirement gate — **no fifth workflow, no committed script.**
5. **The profile is the personal gate library.** A recorded check is a runnable
   command string (a `curl … | assert`, an e2e/scenario invocation, or a
   browser-MCP recipe) plus `appliesWhen`, the rung it reached, and `provenAt`.
   No `.ensemble/` dir, no sidecar JSON. Proof artifacts land in the existing
   gitignored `.workflows/` scratch space.

### Artifact model — why profile-section, not script-first

An earlier draft of this doc proposed a committed, self-contained
`.ensemble/dynamic-check` shell script (+ a `.json` sidecar) as the artifact —
"architecture B" — arguing its value was being *runnable by a human or CI
directly*, independent of Ensemble ("get users").

That thesis was dropped once the **personal-tool vision** landed the same day
(CONTRACT §7, `/ensemble-install` step 3): the kit is shared, but the *config is
personal* — `repo-profile.md` is **gitignored** and is explicitly "your personal
gate library." A committed `.ensemble/dynamic-check` script's entire
justification is being *shared and standalone-runnable*, which directly
contradicts a personal, gitignored gate library. You cannot have the same
artifact be both.

The determinism is identical either way — both models run a real command that
produces a genuine PASS/FAIL against the running service. Script-first only
changed *packaging and shareability*, and shareability is precisely what the
personal-tool vision de-prioritized. It also re-added runtime wiring
(`args.dynamicCheck`) and three new artifacts against the anti-bloat guardrail.
So the check lives in the profile section, and the launchers that already read
that section (§4.11) consume it with no new wiring.

## The ladder

The probe climbs and records the **highest rung actually achieved**; lower rungs
are the automatic fallback.

| Rung | Name | What it proves | How |
|------|------|----------------|-----|
| 0 | Discover | (setup) start cmd, ports, health path, one representative flow, seed data, teardown | recon (`.workflows/recon.md`) + agent inference from manifests/CI/run scripts; interview only to fill gaps |
| 1 | Boot + reach | It starts and answers at its interface | run start cmd, wait (timeout-bounded), port open / health 200 / `--help` |
| 2 | Functional smoke | It's up *and doing the thing* | one real interaction returns an expected result (seeded query, endpoint shape, golden CLI output) |
| 3 | Behavioral | The real user-facing flow works | drive the flow (browser MCP → screenshot) or run a representative sim/eval scenario |

**Degradation is mandatory.** Many real repos can't be fully booted at install
(cloud creds, GPU, heavy infra). When a rung fails or the environment blocks, the
probe stops climbing, records the highest rung reached, and marks the rest
`BLOCKED` with why. Teardown is guaranteed (trap) regardless of outcome.

> **Note — rung 0 discovery source.** Discovery uses `.workflows/recon.md` +
> agent inference over the repo's manifests, CI config, and run scripts. It does
> **not** use `tools/profile-probe.js`, which is a cache-cost measurement harness
> (fan-out agents carrying a synthetic profile to measure the digest win), not a
> repo prober.

## Design

### 1. Install: the "Probe & Prove" phase

A new step in `/ensemble-install`, after recon (§4b/§5), agent-driven:

1. **Discover (rung 0):** infer start/health/flow/seed/teardown from
   `.workflows/recon.md` + reading the repo's manifests, CI config, and run
   scripts. Interview the user **only for gaps** the probe couldn't infer — not a
   fresh vague interview.
2. **Climb (rungs 1→3):** attempt each rung in order, capturing real output at
   each. Stop at the first failure/block. Time-box every wait so install can't
   hang.
3. **Prove:** a check is recorded **only for rungs that ran green**. Proof
   artifacts (screenshots, curl output, scenario logs) land in `.workflows/proof/`.
4. **Record honestly:** highest rung + exact working commands → recorded check in
   the profile section. Anything unreachable → `BLOCKED` with the reason.

The behavioral rung (rung 3) splits by capability:
- **Repo has an e2e harness** (Playwright/Cypress/sim runner): record the
  committed e2e/scenario invocation as the check — runnable by CI and humans
  because it's the repo's *own* harness.
- **No harness:** the behavioral step is an *agent-time browser-MCP* recipe
  recorded in the check (`tool: browser-mcp`, steps, expected proof). The
  functional-smoke rung (a `curl`/CLI assertion) still stands as the
  deterministic fallback.

This split keeps the check truthful about how far proof is deterministic: rungs
1–2 are always a runnable command; behavioral is committed-e2e when the repo has
one, agent-driven browser-MCP otherwise.

### 2. Artifacts written

**`repo-profile.md`'s `## Live real-run verification` section** gains the proven
checks — the human-readable, portable record, part of the personal per-repo layer
`/ensemble-update` preserves. Each check carries `appliesWhen`, the rung it
reached, and `provenAt`; unreachable flows are recorded `BLOCKED` honestly:

```
## Live real-run verification (CONTRACT §4.11 — the real-tool "done" gate)
- **Skip when:** docs-only, test-only, or changes outside api/** and web/**.
- **Boot:** `docker compose up -d && ./scripts/wait-for-ready.sh`
- **Health signal:** `GET :8080/health` → 200
- **Real-run checks** (keyed by `appliesWhen`, PROVEN at install 2026-07-01):
  - **orders flow** (`appliesWhen: api/orders/**, web/orders/**`) — rung: behavioral —
    provenAt: 2026-07-01 — `curl -fsS :8080/api/orders/seed-123 | jq -e '.status=="picked"'`
    then browser MCP: open :3000/orders/seed-123, assert timeline renders, screenshot.
    proof: .workflows/proof/orders-flow.png
  - **planner flow** (`appliesWhen: planner/**`) — BLOCKED: needs GPU sim host
    unavailable at install; reached rung 1 (boots, health 200).
- **Retry cap:** 3
- **Teardown:** `docker compose down`
```

**`.workflows/proof/`** — install-captured artifacts (screenshots, curl output,
scenario logs). Lives under the existing gitignored `.workflows/` scratch space
(CONTRACT §7); regenerated on every run/re-probe. No new gitignored dir needed.

### 3. Runtime consumption (no new workflow, no wiring)

The launchers already read the profile's `## Live real-run verification` section
directly (the §4.11 gate — `/ensemble-execute` §4d + §6.5, `/ensemble-review`
§7.5, `/ensemble-debug` §4.5). Because the check lives in that section, **there is
nothing to thread through `args`** — Probe & Prove simply makes the section
concrete and runnable instead of a vague sentence. Consumption is unchanged:

- **`/ensemble-execute`** — select checks whose `appliesWhen` matches the diff, run
  each against the freshly-booted service, require **fresh** proof from *this* run.
  A covered surface whose check isn't green → not `complete`. Can't boot → `BLOCKED`.
- **`/ensemble-review`** — run the matching checks against the changed surface.
  Unmet → **cannot APPROVE** (`REQUEST CHANGES` if fixable, `BLOCK` if unrunnable).

Selection is `appliesWhen`-driven: a diff touching only `docs/` runs nothing; a
diff under `api/orders/**` runs the `orders` check.

### 4. Anti-rot & safety

- **Self-healing pressure:** runtime always *re-runs* the check for fresh proof,
  so a rotted recipe (moved port, renamed endpoint) fails loudly at
  execute/review instead of silently passing.
- **Re-prove:** `/ensemble-update --reprobe` re-runs install's Probe & Prove phase
  against the existing profile and refreshes the checks + `provenAt`. Plain
  `/ensemble-update` stays mechanical (file sync only) and leaves the profile
  untouched (preserves the personal per-repo layer, as today).
- **Staleness signal:** `provenAt` surfaced in output; flag when old.
- **Safety:** local/ephemeral only; seed/fixture data; **never** prod or shared
  infra; timeout-bounded so it can't hang; guaranteed teardown; proof stays local.
  Honors the Mytra AI-use policy — local app runs are fine, no data exfiltration.

## Testing the feature itself

The kit is dogfooded against its own dev repos + a small matrix of archetypes:
an HTTP service (boot + curl), a browser UI (boot + screenshot), a CLI (golden
output), and a can't-boot case (verify it records `BLOCKED`, does **not**
fabricate a recipe). Assert: green only when actually green; degrade correctly;
teardown always runs; `appliesWhen` selection picks the right checks.

## Out of scope (YAGNI)

- A fifth `/ensemble-verify` workflow (architecture "C"). Revisit only if
  dynamic-verify earns its own front door.
- A committed `.ensemble/dynamic-check` script + sidecar (architecture "B",
  script-first). Considered and dropped — a shared, standalone-runnable script
  contradicts the personal, gitignored gate library (see "Artifact model").
- A declarative manifest-driven runner.
- Exhaustive e2e coverage. This proves the flow is *alive*, not fully tested.
- Provisioning cloud/infra to make un-bootable repos bootable. Those record
  `BLOCKED` honestly.

## Resolved (were open questions)

- **Home of the check:** the profile's `## Live real-run verification` section —
  no separate `.ensemble/` dir. Confirmed against the current install layout
  (the profile lives at `.claude/ensemble/repo-profile.md`, gitignored).
- **Proof artifacts:** always local, never committed — under the existing
  gitignored `.workflows/proof/`, not a new `.ensemble/proof/`.
