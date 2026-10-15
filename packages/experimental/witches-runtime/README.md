# @deepseek-ai/dsh-experimental-witches-runtime

English | [中文](README.md)

Host runtime for Golden Land witches: dual cheap/expensive routes, a Memory Broker that runs after every authentic human message, and a shared expert registry. Witches are DSH sessions. Experts are shared competence, not per-witch copies.

## Config

```yaml
- id: witches-runtime
  name: '@deepseek-ai/dsh-experimental-witches-runtime'
  config:
    brokerInputTokens: 5000
    brokerOutputTokens: 300
    cheapProvider: cheapvibecode
    cheapModel: deepseek-v4.1-flash
    expensiveProvider: cheapvibecode
    expensiveModel: gpt-6-astra
```

`brokerInputTokens` is a hard ceiling for the complete Memory Broker prompt, not for history alone. `brokerOutputTokens` caps the injected capsule. Cheap-provider failure does not promote to the expensive route.

## Dual routes

Each witch stores `cheap`, `expensive`, and `active`. The composer picker writes the active slot. The two-state toggle changes `active` only. Children inherit the parent's live assembled selection (`liveModelSelectionOf`), not `agent-default-model`.

## Memory Broker

The pre-step hook inspects the latest message with `source.kind === 'user'`. Plugin dumps are ignored. The broker packs instruction + human text + candidates into `brokerInputTokens`, calls a cheap filter, and injects one plugin-attributed reminder. An empty capsule is valid. A late result for an older human message is discarded once a newer human id has a capsule.

## Experts

Passports are shared. Episodes are owned by the requesting witch. `cancelEpisode` refuses a witch that does not own the episode, so stopping one witch does not halt the shared expert serving others.

## Execution cycle authority

`src/execution-cycle.ts` defines task transitions from evidence collection through expert planning, bounded worker assignments, and expert review. Worker results cannot accept their own task. Tool reservations consume assignment budgets before dispatch; pauses, cancellation, and rejected reviews invalidate old assignment versions. The executor must authenticate roles, enforce filesystem scope, and revalidate inputs before resume.

`CycleRunner` pins routes for the operation: collection and workers use cheap; planning and review use expensive. Rejected reviews return to planning with a new version. Review iterations are bounded; exhaustion pauses the task. Agent grants are bound by the provider adapter and revoked on settlement, including failure. Late bind callbacks and stale stage results are rejected. The adapter must validate model output and bind the actual child before its first tool call.

`installExecutionGuard` registers an effect-owned `tools/pre-execute` policy. A runtime-issued grant is required for dispatch; collection, planning, and review allow exact inspection tools only. Worker calls reserve assignment budgets before their handlers. Tests use the real ToolRuntime pipeline and check denial before shell, mutation, delegation, and Code Mode execution, plus hook disposal.

`AgentCycleProvider` creates a stage child through `AgentRegistry.create`, supplies the dedicated preset and pinned provider/model, and binds the grant during unpublished setup before the first tool call. Cancellation reaches the child; teardown drains the owned handle. The final assistant reply must be complete JSON validated by `parseStageResult`; malformed replies cannot advance the cycle. These provider lifecycle paths still require a Loader-composition test and real-provider acceptance.

Workers are limited to recognized filesystem tools and paths inside the assignment's physical root; traversal, existing symlink escapes, and sandbox escalation are denied. Shell, Code Mode, delegation, and unknown extensions remain denied even when a plan names them. This pre-dispatch path check is not a race-free filesystem sandbox: recursive search behavior, hardlinks, and concurrent symlink replacement require enforcement by the filesystem provider. Plans must also be constrained to an owner-authorized root before execution.

The cycle and guard are not yet mounted into the running clone or persisted. Loader composition, durable tasks, race-free filesystem policy, bounded shell execution, and real provider routing remain unaccepted.

## Model Experience

### Request context and condition

#### What the model sees

One optional plugin user reminder containing a Memory Broker capsule, or an explicit empty-memory notice.

##### Verbatim text for this field, when needed

```markdown
<system-reminder>Memory Broker: no relevant durable memory for this human message.</system-reminder>
```

#### Token effect

Conditional and capped: at most `brokerOutputTokens` heuristic tokens per human message, injected once per authentic human id.

#### KV Cache effect

Append-only after the reusable system+tools+history prefix. The reminder is not written into the canonical system prompt. Compaction must restore the canonical system prompt from source rather than from this capsule.

## Known Limitations and Deferred Work

- **Cheap filter transport** — this package packs and injects capsules; the live cheap-model HTTP call is supplied by the Golden Land plugin that mounts it.
- **No cross-process expert lock** — episode maps are process-local; a second harness process does not see them.
- **Experimental** — not part of the dsh release family; mounted only by the isolated witches test profile.
