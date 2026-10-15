# RLM Code Mode Acceptance — partial, clone-only

Scope: isolated witches clone at `http://127.0.0.1:3280`. Live `:3180` was not modified or restarted. This records browser evidence from 2026-09-23, not a complete program acceptance.

## Criteria

- **PASS — host build after the owned type fixes:** `pnpm run build:lib:host` exited 0 after the experimental runtime, persistent-runtime test, and API-proxy test diagnostics were fixed.
- **PASS — witches preset exposes Code Mode:** new clone sessions record `agentPreset: "witches"`. After `tool-presentation` `mode: both` was added to the clone preset, a browser prompt called `run_code` and the tool result was `RLM_BROWSER_3280`. Session: `session-41592658-a157-4e68-bc3c-82967ffe605b`.
- **PASS — Python variable survives a later `run_code` in the same live process:** a second browser turn in that session returned `rlm_probe` without assigning it again. The tool result was again `RLM_BROWSER_3280`. This does not prove survival across a DSH restart.
- **PASS — `rlm.search` and `rlm.read` from a real browser session, with a durable journal:** session `session-6222d91f-71a2-4244-8806-f1ea6ee76d3c` returned lookup counts 1 and 2 and event `evt-muep5o58-25ede751bbaa443985`. A later search in the first session returned earlier probe events `evt-mueoqfnp-f149a93c9ccb4309a9` and `evt-muep876k-18f61f25766845bc80`. Journal file: `/Users/user0/golden-land-new/runtime/dsh-home-witches/memory/rlm/runs.jsonl` (3 rows: two lookups in the second session, one search in the first).
- **FAIL — first RLM binding call before the execution-context fix:** the third turn of `session-41592658` failed with `RLM lookup requires a session` because the binding received no execution object. The persistent runtime now forwards `request.context`, and Code Mode passes the tool execution. The later sessions above passed after that fix.
- **NOT TESTED — `rlm.spawn` in the browser:** no browser turn called `rlm.spawn`, and no child expert completion was observed.
- **NOT TESTED — restart of Python globals:** the interpreter is process-local. The journal is on disk; a clone restart was not used to prove variable loss or journal reload.
- **NOT TESTED — phases 2–9:** task contracts, autonomous cheap execution, two-witch isolation, long-running jobs, batch strategy, comparative measurements, and user acceptance are not accepted by this report.

## Evidence retention

All clone session transcripts, including the sessions cited above, were deleted at the user's explicit request. The PASS entries record historical observations, not currently re-readable session logs. External history and the separate RLM journal were not deleted; event IDs may remain resolvable there, but that must be checked independently. Fresh acceptance must preserve separate evidence artifacts.

## Constraints

History search is per witch session, so a query in a new session does not see another session's private events. Python variables persist only while that session's interpreter and the DSH process stay alive. Live `:3180` stayed on HTTP 200 and was not restarted.
