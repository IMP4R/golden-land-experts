// Host half: Memory Broker, dual cheap/expensive routes, shared experts,
// addressable history. Mounted only by the isolated witches test profile.

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BlockAssembler } from '@deepseek-ai/dsh-llm'
import { ExpertPool } from './expert-pool.js'
import {
  AGENT_ROLE,
  EVENT_ORIGIN,
  classifyEventOrigin,
  resolveAgentRole,
  shouldDispatchExpert,
  shouldRunBroker,
  stampAgentRole,
  taskIdentity,
} from './agent-role.js'
import {
  BROKER_CAPSULE_TOKENS,
  BROKER_DEFAULT_MAX_OUTPUT_TOKENS,
  BROKER_FILTER_INSTRUCTION,
  answerFromFilter,
  candidateMessage,
  estimateTokens,
  fitCapsule,
  isGreeting,
  isTopicalStudy,
  isProjectWork,
  selectCandidates,
  validateFilterAnswer,
} from './broker.js'
import { ExecutionCycle } from './execution-cycle.js'
import { runExpertCycle } from './cycle-orchestrator.js'
import { installCycleGuard } from './execution-guard.js'
import { stageOutput, terminalReport } from './cycle-report.js'
import { deliverReport } from './report-delivery.js'

export const name = 'witches-experts'
export const inject = ['tools', 'systemPrompt', 'llm', 'subagents']

function renderAssembly(assembly) {
  const interpolate = (input) => String(input.text || '').replace(/{{\s*([A-Za-z0-9_.:-]+)\s*}}/g, (_match, key) => {
    const value = assembly.variables?.[key]
    if (value === undefined) throw new Error(`Memory Broker cannot resolve system prompt variable ${key}`)
    return value
  })
  return (assembly.sections || []).map(interpolate).filter(Boolean).join('\n\n')
}

const WITCH_DISPATCH = [
  'In Code Mode, use the `rlm` namespace: search or read durable history inside the program, then call `rlm.spawn` from code when a shared expert must work on selected source events.',
  'You are a witch: the human-facing session. Do not personally walk the filesystem for a topical project study.',
  'Project work is executed by the runtime expert cycle, not by you: a cheap collector gathers facts, the expensive expert plans contracted assignments, cheap workers execute them, and the expensive expert reviews. Your own tool calls for mutation, shell, and code are denied while your cycle executes.',
  'After Memory Broker, if the human asks to study, find, implement, or operate a project, the runtime starts the cycle automatically; report that it is running and wait for the reviewer verdict instead of redesigning it yourself.',
  'Experts run on their own configured routes: dialogue stays cheap, planning and review use the expensive route. You do not copy the witch conversation into the expert.',
  'Use history_search / history_read as the RLM: inspect indexed fragments instead of replaying the full archive in this prompt.',
  'Independent read-only tools (glob, grep, read, viking_search) must be issued together in one assistant message, not one request per tool.',
  'Greetings and route toggles stay local. Do not dump OpenViking or ledger on a greeting.',
].join(' ')

/** Where the broker writes its per-call diagnostic journal. */
function brokerTracePath() {
  return join(dshHome(), 'memory', 'broker-trace.jsonl')
}

/**
 * Append one broker diagnostic record.
 *
 * Diagnostics never fail a turn: a trace write that cannot land is dropped
 * rather than propagated into the conversation.
 * @param record - JSON-serializable record.
 */
async function appendBrokerTrace(record) {
  try {
    const tracePath = brokerTracePath()
    await mkdir(dirname(tracePath), { recursive: true })
    await writeFile(tracePath, `${JSON.stringify(record)}\n`, { flag: 'a' })
  } catch { /* diagnostics only */ }
}

/**
 * True for a message the model sees as a typed human turn.
 * @param message - candidate message.
 * @returns whether its source is the human-client kind.
 */
function isHuman(message) {
  return message && message.role === 'user' && message.source && message.source.kind === 'user'
}

/**
 * Join the text blocks of one message.
 * @param message - message whose text blocks are joined.
 * @returns the joined text, or an empty string.
 */
function textOf(message) {
  return (message?.content || [])
    .filter((b) => b && b.type === 'text')
    .map((b) => b.text)
    .join('\n')
}

function latestHuman(messages) {
  for (let i = (messages || []).length - 1; i >= 0; i -= 1) {
    if (isHuman(messages[i])) return messages[i]
  }
  return undefined
}

/**
 * Read the newest authentic human message from the session's own event history.
 *
 * The pre-step inbox is empty for most steps and never carries the message that
 * opened the conversation, so the history is the reliable source. Returning the
 * index lets the caller report how many human messages the session has seen.
 * @param agent - the acting agent.
 * @returns the newest `user/message` event with a human source, or undefined.
 */
function latestHumanEvent(agent) {
  const events = agent?.session?.events
  if (!Array.isArray(events)) return undefined
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i]
    if (event?.type !== 'user/message') continue
    if (!isHuman(event.data)) continue
    return { id: event.data.id || `seq-${String(event.seq ?? i)}`, message: event.data, index: i }
  }
  return undefined
}

function jsonOutput() {
  return {
    schema: { type: 'object', additionalProperties: true },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
  }
}

async function loadLedgerCandidates() {
  const isolated = process.env.GOLDEN_LAND_WITCHES_ISOLATED === '1'
  const path = process.env.GOLDEN_LAND_LEDGER_PATH
    || (isolated
      ? join(dshHome(), 'memory', 'ledger.jsonl')
      : '/Users/user0/golden-land-new/runtime/memory-ledger/ledger.jsonl')
  if (isolated && path.includes('/runtime/memory-ledger/ledger.jsonl') && !path.includes('dsh-home-witches')) {
    throw new Error('witches-experts: refusing live ledger path under GOLDEN_LAND_WITCHES_ISOLATED=1')
  }
  let text = ''
  try { text = await readFile(path, 'utf8') } catch { return [] }
  const records = text.split('\n').filter((line) => line.trim()).flatMap((line) => {
    try { return [JSON.parse(line)] } catch { return [] }
  })
  const superseded = new Set()
  for (const record of records) {
    if (record.type !== 'claim') continue
    for (const id of record.supersedes || []) if (typeof id === 'string') superseded.add(id)
  }
  const out = []
  for (const record of records) {
    if (record.type !== 'claim' || superseded.has(record.id)) continue
    const trust = Number(record.trust)
    if (Number.isFinite(trust) && trust < 0.5) continue
    const statement = typeof record.statement === 'string' ? record.statement.trim() : ''
    if (!statement) continue
    out.push({
      id: String(record.id),
      scope: String(record.scope || ''),
      source: String(record.source || record.source_uri || ''),
      freshness: String(record.freshness || 'unknown'),
      status: String(record.status || 'active'),
      kind: 'claim',
      text: statement,
    })
  }
  return out
}

function cloneRoutes(routes) {
  return {
    cheap: { ...routes.cheap },
    expensive: { ...routes.expensive },
    active: routes.active,
    revision: Number.isSafeInteger(routes.revision) ? routes.revision : 0,
  }
}

function dshHome() {
  return process.env.DSH_HOME || join(process.cwd(), 'runtime/dsh-home-witches')
}

function routesPath() {
  return join(dshHome(), 'storages', 'witch-routes.json')
}

async function loadAllRoutes() {
  try {
    const raw = JSON.parse(await readFile(routesPath(), 'utf8'))
    return raw && typeof raw === 'object' ? raw : {}
  } catch {
    return {}
  }
}

async function saveAllRoutes(all) {
  const file = routesPath()
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, `${JSON.stringify(all, null, 2)}\n`, 'utf8')
}

export function apply(ctx, config) {
  const cfg = {
    brokerCapsuleTokens: BROKER_CAPSULE_TOKENS,
    brokerMaxOutputTokens: undefined,
    brokerTimeoutMs: 15000,
    brokerCandidateTopK: 24,
    cheapProvider: 'cheapvibecode',
    cheapModel: 'deepseek-v4.1-flash',
    expensiveProvider: 'cheapvibecode',
    expensiveModel: 'gpt-6-astra',
    maxCycleReviews: 2,
    ...(config && typeof config === 'object' ? config : {}),
  }
  const defaults = {
    cheap: { provider: cfg.cheapProvider, model: cfg.cheapModel },
    expensive: { provider: cfg.expensiveProvider, model: cfg.expensiveModel },
    active: 'cheap',
    revision: 0,
  }
  const capsules = new Map()
  const brokerFlights = new Map()
  const acceptanceDelayMs = process.env.WITCHES_BROKER_ACCEPTANCE_DELAY_MS === undefined
    ? 0
    : Number(process.env.WITCHES_BROKER_ACCEPTANCE_DELAY_MS)
  const latestHumanBySession = new Map()
  const dispatchedHumans = new Set()
  // One active expert cycle per witch session: the runtime authority a guard
  // checks before any project tool call from that witch or her stage children.
  const cycleRegistry = new Map()
  ctx.effect(() => installCycleGuard(ctx, cycleRegistry), 'witches-experts: cycle guard')

  // Boot marker. Without it a plugin that never receives a pre-step is
  // indistinguishable from a broker that ran and legitimately found nothing.
  void appendBrokerTrace({
    at: new Date().toISOString(),
    pid: process.pid,
    kind: 'plugin-applied',
    pluginFile: fileURLToPath(import.meta.url),
    inject: inject.slice(),
    hasLlm: Boolean(ctx.llm),
    hasSubagents: Boolean(ctx.subagents || (ctx.get && ctx.get('subagents'))),
    hasTools: Boolean(ctx.tools),
    hasSystemPrompt: Boolean(ctx.systemPrompt),
    dshHome: process.env.DSH_HOME || null,
  })
  const experts = [
    { id: 'payments', title: 'Payments', scope: 'payments', tools: 'payments-dev' },
    { id: 'code', title: 'Code', scope: 'implementation', tools: 'dev' },
    { id: 'research', title: 'Research', scope: 'investigation', tools: 'research' },
    { id: 'repo-audit', title: 'Repository Audit', scope: 'repository', tools: 'dev' },
  ]
  const pool = new ExpertPool(experts, {
    payments: [{
      id: 'm-webhook',
      text: 'Webhook idempotency uses a unique constraint on delivery id so a replay does not change the balance.',
      status: 'verified',
    }],
  })
  let writeChain = Promise.resolve()
  const durableHistory = ctx.get('witches-durable-history')
  const sessionIdOf = (exec) => {
    const agent = exec && exec.agent
    if (!agent) return ''
    if (agent.session && agent.session.id) return String(agent.session.id)
    return String(agent.id)
  }

  const getRoutes = async (sessionId) => {
    const all = await loadAllRoutes()
    const stored = all[sessionId]
    if (stored) return cloneRoutes(stored)
    return cloneRoutes(defaults)
  }

  const setRoutes = async (sessionId, routes) => {
    let committed
    writeChain = writeChain.then(async () => {
      const all = await loadAllRoutes()
      const previous = all[sessionId] ? cloneRoutes(all[sessionId]) : cloneRoutes(defaults)
      committed = cloneRoutes({ ...routes, revision: previous.revision + 1 })
      all[sessionId] = committed
      await saveAllRoutes(all)
    })
    await writeChain
    return cloneRoutes(committed)
  }

  const assemble = (routes) => routes[routes.active]

  const cheapRouteOf = async (sessionId) => {
    const routes = await getRoutes(sessionId)
    return { requestedRoute: 'cheap', resolvedProvider: routes.cheap.provider, resolvedModel: routes.cheap.model, routeRevision: routes.revision }
  }

  if (durableHistory) {
    durableHistory.experts = experts
    durableHistory.expertRoute = cheapRouteOf
  }

  /** Dispatch one direct cheap-route Broker call over the canonical compacted session surface. */
  const cheapFilter = async ({ parentAgent, enteringMessages, candidates, parentSignal, route }) => {
    const llm = ctx.llm
    const assembly = await ctx.systemPrompt.assemble({ agent: parentAgent, scope: parentAgent, signal: parentSignal })
    const systemText = `${renderAssembly(assembly)}\n\n${BROKER_FILTER_INSTRUCTION}`
    const history = []
    const seenMessageIds = new Set()
    for (const message of [...parentAgent.session.deriveMessages(), ...(enteringMessages || [])]) {
      const messageId = message?.id
      if (messageId !== undefined && seenMessageIds.has(String(messageId))) continue
      if (messageId !== undefined) seenMessageIds.add(String(messageId))
      history.push(message)
    }
    const candidateText = candidateMessage(candidates)
    if (process.env.WITCHES_BROKER_ACCEPTANCE_TRACE === '1') {
      await appendBrokerTrace({
        at: new Date().toISOString(),
        pid: process.pid,
        kind: 'broker-request',
        route,
        system: systemText,
        history: history.map(message => ({
          id: message?.id ?? null,
          role: message?.role ?? null,
          source: message?.source ?? null,
          text: textOf(message),
          contentTypes: (message?.content || []).map(block => block?.type || null),
        })),
        candidates: JSON.parse(candidateText),
        tools: [],
      })
    }
    const candidateInput = {
      role: 'user',
      id: `msg-${randomUUID()}`,
      content: [{ type: 'text', text: candidateText }],
      source: { kind: 'plugin', plugin: name, form: 'memory-broker-candidates' },
    }
    const requested = {
      provider: route.resolvedProvider,
      model: route.resolvedModel,
      maxTokens: Number(cfg.brokerMaxOutputTokens || BROKER_DEFAULT_MAX_OUTPUT_TOKENS),
      temperature: 0,
    }
    const prepared = await llm.prepareCall(requested, parentSignal)
    const generationLimit = Number(prepared.config.maxTokens)
    const contextWindow = prepared.context?.contextWindow
    const inputEstimate = estimateTokens(`${systemText}\n${history.map(textOf).join('\n')}\n${candidateText}`)
    if (contextWindow !== undefined && inputEstimate + generationLimit > contextWindow) {
      const error = new Error(`Memory Broker context_overflow: estimated ${inputEstimate}+${generationLimit} > ${contextWindow}`)
      error.code = 'context_overflow'
      error.context = { contextWindow, inputEstimate, generationLimit }
      throw error
    }
    const startedAt = Date.now()
    let timeoutFired = false
    if (acceptanceDelayMs > 0) {
      await appendBrokerTrace({
        at: new Date().toISOString(),
        pid: process.pid,
        kind: 'broker-delay',
        route,
        delayMs: acceptanceDelayMs,
      })
      await new Promise(resolve => setTimeout(resolve, acceptanceDelayMs))
    }
    const controller = new AbortController()
    const abortFromParent = () => controller.abort(parentSignal?.reason)
    if (parentSignal?.aborted) abortFromParent()
    else parentSignal?.addEventListener('abort', abortFromParent, { once: true })
    const timeout = setTimeout(() => {
      timeoutFired = true
      controller.abort(new Error('Memory Broker timeout'))
    }, Number(cfg.brokerTimeoutMs))
    const assembler = new BlockAssembler()
    const chunkTypes = []
    try {
      for await (const chunk of prepared.stream({
        ...prepared.config,
        system: systemText,
        messages: [...history, candidateInput],
        tools: [],
        signal: controller.signal,
      })) {
        chunkTypes.push(chunk.type)
        assembler.push(chunk)
      }
    } finally {
      clearTimeout(timeout)
      parentSignal?.removeEventListener('abort', abortFromParent)
    }
    const finish = assembler.finish
    if (finish?.kind === 'error') {
      const error = new Error(finish.failure?.message || 'Memory Broker provider error')
      error.code = finish.failure?.code || 'provider_error'
      throw error
    }
    if (finish?.kind === 'aborted') {
      const error = new Error(timeoutFired ? 'Memory Broker timeout' : 'Memory Broker cancelled')
      error.code = timeoutFired ? 'broker_timeout' : 'broker_cancelled'
      throw error
    }
    const blocks = assembler.blocks()
    const visible = blocks.filter(block => block.type === 'text').map(block => block.text).join('\n')
    const reasoningChars = blocks.filter(block => block.type === 'reasoning').reduce((sum, block) => sum + block.text.length, 0)
    return {
      answer: answerFromFilter(visible),
      usage: assembler.usage,
      call: {
        requestedRoute: route.requestedRoute,
        resolvedProvider: route.resolvedProvider,
        resolvedModel: route.resolvedModel,
        routeRevision: route.routeRevision,
        contextWindow: contextWindow ?? null,
        generationLimitTokens: generationLimit,
        canonicalHistoryMessages: history.length,
        systemChars: systemText.length,
        candidatePlacement: 'final-user-message',
        candidateCount: candidates.length,
        inputEstimate,
        noSilentTruncation: true,
        tools: [],
        subagents: false,
        memoryInjection: false,
        brokerHook: false,
        inputTokens: assembler.usage?.inputTokens ?? null,
        outputTokens: assembler.usage?.outputTokens ?? null,
        reasoningTokens: assembler.usage?.reasoningTokens ?? null,
        visibleOutput: visible,
        visibleChars: visible.length,
        reasoningChars,
        elapsedMs: Date.now() - startedAt,
        cost: null,
        chunkTypes: chunkTypes.slice(0, 12),
      },
    }
  }

  ctx.systemPrompt.section({
    name: 'tool:witches-experts',
    order: 118,
    text: WITCH_DISPATCH,
  })

  const indexHistory = (sid, rec) => {
    const list = history.get(sid) || []
    const next = list.filter((r) => r.id !== rec.id).concat([rec])
    history.set(sid, next)
    return next.length
  }

  const spawnCheapExpert = async (exec, expert, mode, contract, episode) => {
    const subagents = ctx.subagents || (ctx.get && ctx.get('subagents'))
    const parent = (exec && exec.agent) || ctx.agent
    if (!subagents || !parent || typeof subagents.start !== 'function') {
      return {
        spawned: false,
        reason: `subagents unavailable; local expert cycle only (hasService=${Boolean(subagents)} hasParent=${Boolean(parent)})`,
      }
    }
    const prompt = [
      `You are the shared expert "${expert.id}" (${expert.title}). Scope: ${expert.scope}.`,
      'Work on the cheap route. Do not inherit the witch conversation.',
      'Issue independent read-only tools together in one assistant message.',
      'Return a compact result: delta, evidence, checks, unknown. Do not dump archives.',
      'Do not re-delegate this contract. Narrow subtasks you own may still be delegated.',
      `Mode: ${mode}`,
      `Contract:\n${contract}`,
      episode.message && episode.message.delta ? `Local competence: ${episode.message.delta}` : '',
    ].filter(Boolean).join('\n')
    const cheap = await cheapRouteOf(sessionIdOf(exec))
    await appendBrokerTrace({
      at: new Date().toISOString(),
      pid: process.pid,
      kind: 'spawn-attempt',
      expertId: expert?.id ?? null,
      route: cheap,
      parentSessionId: parent?.session?.header?.id ?? null,
      hasStart: typeof subagents.start === 'function',
    })
    try {
      const run = await subagents.start('spawn', {
        label: `${expert.id}:${mode}`,
        prompt: [{ type: 'text', text: prompt }],
        parent,
        signal: exec.signal || new AbortController().signal,
        // The role is declared here because only the dispatcher knows why this
        // session exists; downstream decisions read it instead of guessing.
        agentOptions: stampAgentRole({ provider: cheap.resolvedProvider, model: cheap.resolvedModel }, AGENT_ROLE.EXPERT),
        persona: `Shared ${expert.title} expert. Cheap execution. Compact results only. Do not call expert_ask.`,
        toolFilter: { deny: ['expert_ask', 'expert_pause', 'expert_resume', 'expert_cancel'] },
        maxDepth: 1,
      })
      await appendBrokerTrace({
        at: new Date().toISOString(),
        pid: process.pid,
        kind: 'spawn-started',
        runId: run.id,
        hasResult: run.result !== undefined,
      })
      // The child runs concurrently with the witch's own turn. Awaiting its
      // result HERE would deadlock: this listener is inside the very step whose
      // completion the child's spawn is waiting on. The result is delivered
      // through the run itself, and the trace records it when it lands.
      void Promise.resolve(run.result)
        .then(async (settled) => {
          const output = Array.isArray(settled && settled.output) ? settled.output : []
          const text = output
            .flatMap((block) => (block && block.type === 'text' ? [block.text] : []))
            .join('\n')
            .slice(0, 4000)
          try { await run.dispose() } catch { /* one-shot child already closed */ }
          await appendBrokerTrace({
            at: new Date().toISOString(),
            pid: process.pid,
            kind: 'spawn-result',
            runId: run.id,
            stopReason: settled && settled.stopReason,
            outputChars: text.length,
            outputPreview: text.slice(0, 800),
          })
          // The result reaches the witch as queued context rather than as this
          // step's return value: the step already ran, and the child's work is
          // evidence for the next one.
          if (typeof parent.followup === 'function') {
            deliverReport(parent, {
              role: 'user',
              id: `msg-${randomUUID()}`,
              content: [{
                type: 'text',
                text: `<system-reminder>Runtime expert dispatch (not a prompt). expert=code route=${cheap.resolvedProvider}/${cheap.resolvedModel} run=${run.id}\n${text.slice(0, 1500)}</system-reminder>`,
              }],
              source: { kind: 'plugin', plugin: name, form: 'expert-result' },
            })
          }
        })
        .catch(async (error) => {
          await appendBrokerTrace({
            at: new Date().toISOString(),
            pid: process.pid,
            kind: 'spawn-result',
            runId: run.id,
            failed: true,
            reason: String(error && error.message ? error.message : error),
          })
        })
      return {
        spawned: true,
        runId: run.id,
        route: cheap,
        output: '',
        pending: true,
        stopReason: undefined,
      }
    } catch (error) {
      return { spawned: false, reason: String(error && error.message ? error.message : error) }
    }
  }

  /**
   * Runs one cycle stage as a one-shot child on its own route and returns its
   * final text. Read-only stages cannot mutate; a worker carries the runtime
   * authority of its assignment, so the executor can charge its call budget and
   * refuse anything outside the plan.
   */
  const runCycleStage = async ({ role, route, prompt, parent, signal, cycleId, version, assignment }) => {
    const subagents = ctx.subagents || (ctx.get && ctx.get('subagents'))
    if (!subagents || typeof subagents.start !== 'function') throw new Error('subagents unavailable')
    const worker = role === 'worker'
    const run = await subagents.start('spawn', {
      label: `cycle:${role}`,
      prompt: [{ type: 'text', text: prompt }],
      parent,
      signal,
      agentOptions: stampAgentRole({
        provider: route.provider,
        model: route.model,
        ...(worker ? { cycleAuthority: { cycleId, version, assignmentId: assignment.id } } : {}),
      }, worker ? AGENT_ROLE.WORKER : AGENT_ROLE.EXPERT),
      persona: worker
        ? `Contracted worker for ${assignment.id}. Only your assignment. Never delegate. Report JSON evidence.`
        : `Shared expert in the ${role} stage. Read-only. Report one JSON object.`,
      toolFilter: worker
        ? { allow: [...assignment.allowedTools], deny: ['subagent', 'workflow', 'expert_ask'] }
        : { deny: ['write', 'edit', 'subagent', 'workflow', 'expert_ask'] },
      maxDepth: 1,
    })
    try {
      const settled = await run.result
      await appendBrokerTrace({
        at: new Date().toISOString(),
        pid: process.pid,
        kind: 'cycle-child-settled',
        cycleId,
        role,
        runId: run.id,
        stopReason: settled && settled.stopReason,
        route,
      })
      const events = run.localAgent?.session?.events || []
      const lastEnd = [...events].reverse().find(event => event.type === 'turn/end')
      return stageOutput(settled, role, lastEnd?.data?.reason)
    } finally {
      try { await run.dispose() } catch { /* one-shot child already closed */ }
    }
  }

  /**
   * Executes one witch task through collector → planner → workers → reviewer and
   * reports the terminal cycle state back to her session. Runs detached: her
   * own turn continues while the cycle works, and the verdict arrives as the
   * next plugin-attributed message.
   */
  const startExpertCycle = ({ parent, sessionId, goal, sources, signal }) => {
    const cycle = new ExecutionCycle(sessionId, goal)
    const cycleId = randomUUID()
    cycleRegistry.set(sessionId, { cycleId, cycle, owner: sessionId })
    // The witch's own configured slots decide who executes: cheap runs the
    // collector and the workers, expensive runs planning and review.
    return getRoutes(sessionId).then((routes) => runExpertCycle({
      owner: sessionId,
      goal,
      factsHint: sources,
      maxReviews: Number(cfg.maxCycleReviews) > 0 ? Number(cfg.maxCycleReviews) : 2,
      routes: {
        cheap: { provider: routes.cheap.provider, model: routes.cheap.model },
        expensive: { provider: routes.expensive.provider, model: routes.expensive.model },
      },
      signal: signal || new AbortController().signal,
      cycle,
      trace: (record) => appendBrokerTrace({ at: new Date().toISOString(), pid: process.pid, cycleId, witchSessionId: sessionId, ...record }),
      stage: (spec) => runCycleStage({
        role: spec.role,
        route: spec.route,
        prompt: spec.prompt,
        parent,
        signal: spec.signal,
        cycleId,
        version: cycle.version,
        ...(spec.assignment ? { assignment: spec.assignment } : {}),
      }),
    })).then(async (result) => {
      cycleRegistry.delete(sessionId)
      const report = terminalReport(cycleId, result)
      await appendBrokerTrace({ at: new Date().toISOString(), pid: process.pid, kind: 'cycle-terminal', ...report })
      if (typeof parent.followup === 'function') {
        deliverReport(parent, {
          role: 'user',
          id: `msg-${randomUUID()}`,
          content: [{
            type: 'text',
            text: `<system-reminder>Authoritative terminal cycle report (not an active task): ${JSON.stringify(report)}</system-reminder>`,
          }],
          source: { kind: 'plugin', plugin: name, form: 'cycle-result' },
        })
      }
      return result
    }).catch((error) => {
      cycleRegistry.delete(sessionId)
      return appendBrokerTrace({
        at: new Date().toISOString(),
        pid: process.pid,
        cycleId,
        witchSessionId: sessionId,
        kind: 'cycle-failed',
        message: String(error && error.message ? error.message : error),
      })
    })
  }

  ctx.on('agent/pre-step', async (payload, next) => {
    // Entry marker written before anything else, so a throw anywhere below is
    // distinguishable from the listener never being called at all.
    await appendBrokerTrace({
      at: new Date().toISOString(),
      pid: process.pid,
      kind: 'pre-step-enter',
      turn: payload?.turn ?? null,
      step: payload?.step ?? null,
    })
    const decision = await next()
    try {
      const signal = payload && payload.signal
      const parentAgent = (payload && payload.agent) || ctx.agent
      if (!decision || decision.kind !== 'enter' || (signal && signal.aborted)) return decision

      // The claimed inbox carries the human turn that opens a conversation but
      // is empty on later steps; the session history holds those later turns but
      // is not yet written when the first step is proposed. Prefer the claimed
      // input and fall back to the history, so neither timing blinds the broker.
      const claimedHuman = latestHuman(payload?.messages ?? [])
      const historyHuman = latestHumanEvent(parentAgent)
      const human = claimedHuman
        ? { id: claimedHuman.id || `claimed-${String(payload?.turn ?? 0)}`, message: claimedHuman }
        : historyHuman
      const role = resolveAgentRole(parentAgent)
      const origin = human ? classifyEventOrigin(human.message, parentAgent) : EVENT_ORIGIN.SYSTEM
      const id = human ? human.id : null

      await appendBrokerTrace({
        at: new Date().toISOString(),
        pid: process.pid,
        kind: 'pre-step',
        role,
        origin,
        turn: payload?.turn ?? null,
        step: payload?.step ?? null,
        payloadMessages: Array.isArray(payload?.messages) ? payload.messages.length : null,
        sourceUsed: claimedHuman ? 'payload' : (historyHuman ? 'history' : 'none'),
        humanMessageId: id,
        sessionId: sessionIdOf({ agent: parentAgent }),
        willRunBroker: shouldRunBroker(human?.message, parentAgent),
        alreadyCapsuled: id !== null && capsules.has(`${sessionIdOf({ agent: parentAgent })}:${id}`),
      })

      if (!human) return decision
      if (!shouldRunBroker(human.message, parentAgent)) return decision
      const sessionId = sessionIdOf({ agent: parentAgent }) || (parentAgent && parentAgent.session && parentAgent.session.id) || ''
      const fingerprint = `${String(sessionId)}:${id}`
      if (capsules.has(fingerprint)) return decision
      const humanText = textOf(human.message)
      const cheap = await cheapRouteOf(sessionId)
      const currentBatch = decision.messages || []
      const currentContextText = currentBatch.map(textOf).join('\n')
      const ranked = selectCandidates(`${humanText}\n${currentContextText}`, await loadLedgerCandidates(), {
        topK: Number(cfg.brokerCandidateTopK),
      })
      latestHumanBySession.set(String(sessionId), id)
      let flight = brokerFlights.get(fingerprint)
      if (!flight) {
        flight = cheapFilter({ parentAgent, enteringMessages: currentBatch, candidates: ranked, parentSignal: signal, route: cheap })
        brokerFlights.set(fingerprint, flight)
      }
      let outcome
      let filterStatus = null
      try {
        outcome = await flight
      } catch (error) {
        const message = String(error && error.message ? error.message : error)
        const code = String(error && error.code ? error.code : '')
        ctx.logger?.warn?.(`${name}: cheap filter error: ${message}`)
        outcome = { answer: '', usage: undefined, call: { requestedRoute: 'cheap', resolvedProvider: cheap.resolvedProvider, resolvedModel: cheap.resolvedModel, routeRevision: cheap.routeRevision, failed: true, error: message, code, ...(error?.context || {}) } }
        filterStatus = signal?.aborted ? 'cancelled' : (code === 'context_overflow' ? 'context_overflow' : (/timeout/i.test(message) ? 'timeout' : 'provider_error'))
      } finally {
        brokerFlights.delete(fingerprint)
      }

      const validated = validateFilterAnswer(outcome.answer, ranked)
      if (filterStatus === null) filterStatus = validated.status
      const fitted = ['selected', 'empty'].includes(filterStatus)
        ? fitCapsule(validated, ranked, cfg.brokerCapsuleTokens || BROKER_CAPSULE_TOKENS)
        : { text: '', items: [], droppedForBudget: [] }
      const capsuleText = filterStatus === 'selected' ? fitted.text : ''
      const late = latestHumanBySession.get(String(sessionId)) !== id
      const capsule = {
        humanMessageId: id,
        text: capsuleText,
        sources: filterStatus === 'selected' ? validated.selectedIds : [],
        validationReason: validated.reason,
        droppedForBudget: fitted.droppedForBudget,
        filterStatus: late ? 'cancelled' : filterStatus,
        route: cheap,
        late,
      }
      if (!late) capsules.set(fingerprint, capsule)

      // The three quantities the acceptance review separates, recorded per call.
      await appendBrokerTrace({
        at: new Date().toISOString(),
        pid: process.pid,
        kind: 'broker-call',
        humanMessageId: id,
        agentRole: role,
        eventOrigin: origin,
        delegationDepth: parentAgent?.session?.header?.delegationDepth ?? null,
        filterStatus,
        requestedRoute: cheap.requestedRoute,
        resolvedProvider: cheap.resolvedProvider,
        resolvedModel: cheap.resolvedModel,
        routeRevision: cheap.routeRevision,
        context: {
          canonicalSurfaceMessages: parentAgent.session.deriveMessages().length,
          enteringMessages: currentBatch.length,
          candidateCount: ranked.length,
          candidatePlacement: 'final-user-message',
          toolSchemaCount: 0,
          silentTruncation: false,
        },
        generation: outcome.call,
        validation: {
          status: validated.status,
          reason: validated.reason,
        },
        capsule: {
          serialized: capsuleText,
          chars: capsuleText.length,
          tokenEstimate: estimateTokens(capsuleText),
          budget: cfg.brokerCapsuleTokens || BROKER_CAPSULE_TOKENS,
          sources: capsule.sources,
          droppedForBudget: fitted.droppedForBudget,
          late,
        },
      })

      if (late) return decision
      const statusLine = filterStatus === 'selected' || filterStatus === 'empty'
        ? ''
        : `\nBrokerStatus: ${filterStatus}`
      const body = capsule.text
        ? `<system-reminder>Memory Broker capsule for human message ${id}. Treat as leads, not current state.${statusLine}\nSources: ${capsule.sources.join(', ')}\n${capsule.text}\n</system-reminder>`
        : `<system-reminder>Memory Broker: no relevant durable memory for this human message.${statusLine}</system-reminder>`
      const reminder = {
        role: 'user',
        id: `msg-${randomUUID()}`,
        content: [{ type: 'text', text: body }],
        source: { kind: 'plugin', plugin: name, form: 'memory-capsule' },
      }
      // One dispatcher per contract: the task identity, not just the message id,
      // so a re-presented turn cannot spawn a second executor.
      // `human` is the broker's own wrapper; the classifier takes the message
      // itself. Passing the wrapper classified it as a non-human source and
      // silently blocked every dispatch.
      const taskKey = taskIdentity(human.message, parentAgent)
      const mayDispatch = shouldDispatchExpert(human.message, parentAgent)
      const topical = isTopicalStudy(humanText) || isProjectWork(humanText)
      await appendBrokerTrace({
        at: new Date().toISOString(),
        pid: process.pid,
        kind: 'dispatch-gate',
        humanMessageId: id,
        mayDispatch,
        topical,
        topicalStudy: isTopicalStudy(humanText),
        projectWork: isProjectWork(humanText),
        taskKey,
        alreadyDispatched: dispatchedHumans.has(taskKey),
        roleSeen: role,
        originSeen: origin,
        headerKeys: parentAgent?.session?.header ? Object.keys(parentAgent.session.header) : null,
        declaredRole: parentAgent?.options?.agentRole ?? null,
        headerOrigin: parentAgent?.session?.header?.origin ?? null,
        headerParent: parentAgent?.session?.header?.parentSession ?? null,
      })
      if (mayDispatch && !dispatchedHumans.has(taskKey) && topical) {
        dispatchedHumans.add(taskKey)
        // The cycle runs detached: her turn completes with the Broker capsule,
        // and the expensive reviewer's verdict returns as the next plugin
        // message. Awaiting it here would deadlock inside this very step.
        const cycleRun = startExpertCycle({
          parent: parentAgent,
          sessionId: String(sessionId),
          goal: humanText,
          sources: capsule.sources,
          signal,
        })
        void cycleRun
        await appendBrokerTrace({
          at: new Date().toISOString(),
          pid: process.pid,
          kind: 'expert-dispatch',
          humanMessageId: id,
          taskIdentity: taskKey,
          dispatchedByRole: role,
          eventOrigin: origin,
          mode: 'expert-cycle',
          collectorRoute: { provider: cfg.cheapProvider, model: cfg.cheapModel },
          expertRoute: { provider: cfg.expensiveProvider, model: cfg.expensiveModel },
        })
        const expertNote = '<system-reminder>Runtime expert cycle started for this task (collector cheap → planner expensive → contracted cheap workers → reviewer expensive). Report that it is running and do not perform the project work yourself; the reviewer verdict arrives in the next message.</system-reminder>'
        const expertMsg = {
          role: 'user',
          id: `msg-${randomUUID()}`,
          content: [{ type: 'text', text: expertNote }],
          source: { kind: 'plugin', plugin: name, form: 'expert-result' },
        }
        return { kind: 'enter', messages: [...decision.messages, reminder, expertMsg] }
      }
      return { kind: 'enter', messages: [...decision.messages, reminder] }
    } catch (error) {
      ctx.logger?.warn?.(`${name}: broker degraded: ${String(error && error.message ? error.message : error)}`)
      // A swallowed broker failure is indistinguishable from a broker that ran
      // and selected nothing, so the failure itself is recorded.
      await appendBrokerTrace({
        at: new Date().toISOString(),
        pid: process.pid,
        kind: 'broker-error',
        message: String(error && error.message ? error.message : error),
        stack: String(error && error.stack ? error.stack : '').split('\n').slice(0, 4),
      })
      return decision
    }
  })

  const commands = ctx.get && ctx.get('commands')
  if (commands && typeof commands.register === 'function') {
    ctx.effect(() => commands.register({
      name: 'cheap',
      description: 'Switch this witch to the cheap model route',
      handler: async (invocation) => {
        const sessionId = String(invocation.agent.session.id)
        const routes = await setRoutes(sessionId, { ...(await getRoutes(sessionId)), active: 'cheap' })
        return { kind: 'success', text: `Cheap route: ${routes.cheap.provider}/${routes.cheap.model}` }
      },
    }), 'witches-experts: /cheap')
    ctx.effect(() => commands.register({
      name: 'expensive',
      description: 'Switch this witch to the expensive model route',
      handler: async (invocation) => {
        const sessionId = String(invocation.agent.session.id)
        const routes = await setRoutes(sessionId, { ...(await getRoutes(sessionId)), active: 'expensive' })
        return { kind: 'success', text: `Expensive route: ${routes.expensive.provider}/${routes.expensive.model}` }
      },
    }), 'witches-experts: /expensive')
  }

  ctx.effect(() => ctx.tools.register({
    name: 'witch_route',
    description: 'Read or switch this witch between cheap and expensive model routes. Does not retarget an in-flight request. Cheap failure never promotes to expensive. The composer picker writes the currently active slot.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: { type: 'string', enum: ['status', 'cheap', 'expensive', 'apply_picker'] },
        provider: { type: 'string' },
        model: { type: 'string' },
      },
      required: ['action'],
    },
    output: jsonOutput(),
    execute: async (args, exec) => {
      const sessionId = sessionIdOf(exec)
      if (!sessionId) throw new Error('witch_route requires a calling agent')
      let routes = await getRoutes(sessionId)
      const action = String(args.action || 'status')
      if (action === 'cheap' || action === 'expensive') {
        routes = await setRoutes(sessionId, { ...routes, active: action })
      } else if (action === 'apply_picker') {
        const provider = String(args.provider || '')
        const model = String(args.model || '')
        if (!provider || !model) throw new Error('apply_picker requires provider and model')
        routes = await setRoutes(sessionId, {
          ...routes,
          [routes.active]: { provider, model },
        })
      }
      return { ...routes, assembled: assemble(routes) }
    },
  }), 'witches-experts: witch_route')

  ctx.effect(() => ctx.tools.register({
    name: 'expert_ask',
    description: 'Ask a shared expert for context, consultation, or execution. Returns a contract-sized result. Does not copy the witch conversation.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        expertId: { type: 'string' },
        mode: { type: 'string', enum: ['context', 'consult', 'execute'] },
        contract: { type: 'string' },
      },
      required: ['expertId', 'mode', 'contract'],
    },
    output: jsonOutput(),
    execute: async (args, exec) => {
      const witchSessionId = sessionIdOf(exec) || 'unknown'
      const expertId = String(args.expertId)
      const mode = String(args.mode)
      const contract = String(args.contract)
      const episode = pool.ask(witchSessionId, expertId, mode, contract)
      const expert = experts.find((row) => row.id === expertId)
      let child = { spawned: false, reason: 'context-only local cycle' }
      if (mode !== 'context') {
        child = await spawnCheapExpert(exec, expert, mode, contract, episode)
      }
      const rec = {
        id: `expert:${episode.id}`,
        text: [
          `expert ${expertId} ${mode} ${episode.status}`,
          contract.slice(0, 500),
          episode.message && episode.message.delta ? episode.message.delta : '',
          child.output || '',
        ].filter(Boolean).join('\n'),
        startSeq: 0,
        endSeq: 0,
      }
      indexHistory(witchSessionId, rec)
      return {
        episodeId: episode.id,
        expert: episode.expertId,
        mode: episode.mode,
        status: episode.status,
        route: episode.route,
        version: episode.version,
        budget: episode.contract.budget,
        message: episode.message,
        child,
        rlm: { indexed: rec.id },
        note: 'Shared expert episode on the cheap route. Cancel/pause only this episode. Inspect later with history_search.',
      }
    },
  }), 'witches-experts: expert_ask')

  ctx.effect(() => ctx.tools.register({
    name: 'expert_cancel',
    description: "Cancel this witch's expert episode. Refuses if the episode belongs to another witch.",
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: { episodeId: { type: 'string' } },
      required: ['episodeId'],
    },
    output: jsonOutput(),
    execute: (args, exec) => {
      const witchSessionId = sessionIdOf(exec)
      try {
        const episode = pool.cancel(String(args.episodeId), witchSessionId)
        return { cancelled: true, episodeId: episode.id, status: episode.status }
      } catch (error) {
        if (String(error.message || error).includes('missing')) return { cancelled: false, reason: 'missing' }
        throw error
      }
    },
  }), 'witches-experts: expert_cancel')

  ctx.effect(() => ctx.tools.register({
    name: 'expert_pause',
    description: "Pause this witch's expert episode. Other witches' episodes keep running.",
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: { episodeId: { type: 'string' } },
      required: ['episodeId'],
    },
    output: jsonOutput(),
    execute: (args, exec) => pool.pause(String(args.episodeId), sessionIdOf(exec)),
  }), 'witches-experts: expert_pause')

  ctx.effect(() => ctx.tools.register({
    name: 'expert_resume',
    description: "Resume this witch's paused expert episode and continue the cheap local cycle.",
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: { episodeId: { type: 'string' } },
      required: ['episodeId'],
    },
    output: jsonOutput(),
    execute: (args, exec) => pool.resume(String(args.episodeId), sessionIdOf(exec)),
  }), 'witches-experts: expert_resume')

  ctx.effect(() => ctx.tools.register({
    name: 'expert_inspect',
    description: 'Inspect an expert episode without an LLM. Returns status, cheap route, budget remainder, and last protocol message.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: { episodeId: { type: 'string' } },
      required: ['episodeId'],
    },
    output: jsonOutput(),
    execute: (args) => {
      const episode = pool.inspect(String(args.episodeId))
      if (!episode) return { found: false }
      return { found: true, episode }
    },
  }), 'witches-experts: expert_inspect')

}
