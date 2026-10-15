import { readFile, writeFile } from 'node:fs/promises'

const input = process.argv[2]
const output = process.argv[3]
if (!input || !output) {
  throw new Error('usage: node summarize-acceptance-evidence.mjs <suite.json> <manifest.json>')
}

const suite = JSON.parse(await readFile(input, 'utf8'))
const fixturePath = new URL('./acceptance-candidates.jsonl', import.meta.url)
const fixture = new Map(
  (await readFile(fixturePath, 'utf8')).split('\n').filter(Boolean).map(line => {
    const record = JSON.parse(line)
    return [record.id, record.statement]
  }),
)

function requestOf(delta) {
  return [...(delta || [])].reverse().find(row => row.kind === 'broker-request')
}

function capsuleItems(serialized) {
  if (!serialized) return []
  try { return JSON.parse(serialized).items || [] } catch { return [] }
}

function summarize(run) {
  const call = run.call
  const request = requestOf(run.delta)
  const items = capsuleItems(call?.capsule?.serialized)
  return {
    sessionId: run.sessionId,
    humanMessageId: call?.humanMessageId ?? null,
    taskId: null,
    taskIdNote: 'Memory Broker pre-step call has no separate task identifier.',
    routeSnapshot: call ? {
      requestedRoute: call.requestedRoute,
      resolvedProvider: call.resolvedProvider,
      resolvedModel: call.resolvedModel,
      revision: call.routeRevision,
    } : null,
    requestSummary: request ? {
      systemChars: String(request.system || '').length,
      historyMessages: request.history?.length ?? 0,
      historyChars: (request.history || []).reduce((sum, message) => sum + String(message.text || '').length, 0),
      historyMessageIds: (request.history || []).map(message => message.id),
      historyRoles: (request.history || []).map(message => message.role),
      historyContainsEarlyProjectMarker: (request.history || []).some(message => String(message.text || '').includes('EARLY_PROJECT_MARKER_91F2')),
      historyContainsEarlyConstraintMarker: (request.history || []).some(message => String(message.text || '').includes('EARLY_CONSTRAINT_MARKER_73AC')),
      historyContainsContinue: (request.history || []).some(message => String(message.text || '').includes('продолжай')),
      candidateIds: request.candidates?.candidates?.map(candidate => candidate.id) ?? [],
      candidateCount: request.candidates?.candidates?.length ?? 0,
      toolSchemaCount: request.tools?.length ?? 0,
    } : null,
    providerUsage: call?.generation ? {
      inputTokens: call.generation.inputTokens ?? null,
      outputTokens: call.generation.outputTokens ?? null,
      reasoningTokens: call.generation.reasoningTokens ?? null,
      contextWindow: call.generation.contextWindow ?? null,
      generationLimitTokens: call.generation.generationLimitTokens ?? null,
      elapsedMs: call.generation.elapsedMs ?? null,
      monetaryCost: call.generation.cost ?? 'UNKNOWN',
      failureCode: call.generation.code ?? null,
    } : null,
    result: call ? {
      filterStatus: call.filterStatus,
      validation: call.validation,
      selectedIds: call.capsule?.sources ?? [],
      late: call.capsule?.late ?? null,
      exactSourceCopy: items.every(item => fixture.get(item.id) === item.text),
      capsuleItems: items,
    } : null,
  }
}

const scenarios = {}
for (const [name, value] of Object.entries(suite.scenarios)) {
  if (Array.isArray(value)) {
    scenarios[name] = value.map(item => ({ label: item.label, ...summarize(item) }))
  } else if (name === 'switch') {
    scenarios[name] = {
      sessionId: value.sessionId,
      first: summarize({ ...value.a, sessionId: value.sessionId }),
      second: summarize({ ...value.b, sessionId: value.sessionId }),
    }
  } else {
    scenarios[name] = {
      ...summarize(value),
      ...(value.compact === undefined ? {} : { compactCommandResponse: value.compact }),
    }
  }
}

const manifest = {
  generatedAt: new Date().toISOString(),
  suiteStartedAt: suite.at,
  driverPid: suite.pid,
  target: suite.base,
  input,
  fixture: fixturePath.pathname,
  scenarios,
}
await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`)
console.log(output)
