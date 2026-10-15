# Acceptance — expert cycle on the isolated clone (:3280)

Date: 2026-10-01. Runtime: `/Users/user0/golden-land-new/scripts/run-dsh-web-witches.sh`, clone home `/Users/user0/golden-land-new/runtime/dsh-home-witches`. Live `:3180` was not touched.

## Scenario

Human message in a Witches session: `добавь в файл /tmp/witches-cycle-demo/notes.md строку cycle-ok`, fixture `/tmp/witches-cycle-demo/notes.md` pre-seeded with `seed`.

## Result

PASS. The runtime executed the task through the expert cycle instead of the cheap dialogue doing the work itself.

| stage | route (real provider call) | stop reason |
|---|---|---|
| collector | `cheapvibecode/glm-5.3-flash` | completed |
| planner | `cheapvibecode/gpt-6-astra` | completed |
| worker | `cheapvibecode/glm-5.3-flash` | completed |
| reviewer | `cheapvibecode/gpt-6-astra` | completed, `accepted: true` |

Reviewer evidence, recorded verbatim in `memory/broker-trace.jsonl`: `Read /tmp/witches-cycle-demo/notes.md directly; it contains exactly two lines in order: 'seed' and 'cycle-ok'.` The file on disk holds `seed\ncycle-ok`, so the accepted claim matches the observable effect.

## Fault found and fixed during acceptance

Every call on the cheap slot failed with `UNKNOWN_MODEL: pi-ai provider "cheapvibecode" has no configured model "deepseek-v4.1-flash"`. The dialogue turn itself ended in that error, so the witch could not answer at all. The configured routes in `settings.yaml`, the Witches preset row, and the `witch-routes.ts` defaults named a model the provider catalog no longer offers; the clone's stored per-session route file named others that do not exist.

Fixed by pointing the cheap slot at `glm-5.3-flash` (catalog entry, 400k context) in the clone home, the preset row, `witch-routes.ts`, and the experimental package defaults, and by removing the stale stored route file so defaults apply. `agent-default-model` moved to the same model.

## Checks run

- `witches-experts` plugin suite: 64 tests, all pass (includes 14 cycle/orchestrator tests and 6 guard tests).
- `witch-routes.spec.ts` + `witches-runtime.spec.ts`: 19 tests pass.
- `npm run build:lib:host`: succeeds.
- Browser: session created through the GUI, message sent, cycle started automatically (`dispatch-gate` records `projectWork: true`), reviewer accepted, file written.

## Dialogue route

In the same run the witch answered on `Zhipu AI · GLM 5.3 Flash` (1 turn, 51K input tokens) and stated that the cycle verdict arrives in the next message, instead of restating its own plan. The dialogue slot stays cheap while planning and review used the expensive slot.

## Second run: blocked by provider balance

A second run (`строку cycle-two`) started the cycle and completed the collector and planner, then the worker child failed with `402 insufficient_balance_error: Token balance exhausted. Top up your balance to continue.` The cycle ended as `cycle-error` and left `/tmp/witches-cycle-demo/notes.md` unchanged. This is a provider billing limit, not a runtime fault; the same code path passed in the first run.

## NOT TESTED

- The witch-side denial (`write`/`edit`/`bash`/`run_code`/`subagent` refused while her cycle executes) is proven only by the guard unit tests; no browser run timed a witch mutation inside a live cycle.
- Rejected-review iteration and its replan ran only against the scripted provider, never against real models.
- Worker scope confinement to the assignment root is not enforced in the deployed legacy plugin: only the tool whitelist and call budget are. The typed `worker-scope.ts` check lives in the unmounted experimental package.
- Human acceptance of the dialogue experience is not obtained.