/**
 * Collect Memory Broker candidates from local stores without injecting dumps.
 * @module @deepseek-ai/dsh-experimental-witches-runtime/candidates
 */

import { readFile } from 'node:fs/promises'
import { estimateTokens, type MemoryCandidate } from './broker.ts'

const DEFAULT_LEDGER = '/Users/user0/golden-land-new/runtime/memory-ledger/ledger.jsonl'
const GREETING = /^(привет|hello|hi|hey|здрасте|добрый\s+(день|вечер)|как дела)([.!?,\s].*)?$/iu

/**
 * Whether the human text is a greeting that must not pull project memory.
 * @param text - authentic human message.
 */
export function isGreetingQuery(text: string): boolean {
  return GREETING.test(text.trim())
}

/**
 * Score a candidate against a query by token overlap.
 * @param query - human request.
 * @param text - candidate body.
 */
export function overlapScore(query: string, text: string): number {
  const q = tokens(query)
  const t = tokens(text)
  if (q.size === 0 || t.size === 0) return 0
  let hit = 0
  for (const word of q) if (t.has(word)) hit += 1
  return hit / q.size
}

/**
 * Keep only candidates that overlap the query above a floor.
 * Greetings return no semantic memory.
 * @param query - human request.
 * @param candidates - raw hits.
 * @param minScore - overlap floor.
 */
export function selectRelevant(
  query: string,
  candidates: readonly MemoryCandidate[],
  minScore = 0.18,
): MemoryCandidate[] {
  if (isGreetingQuery(query)) return []
  return candidates
    .map(candidate => ({ candidate, score: overlapScore(query, `${candidate.id} ${candidate.text}`) }))
    .filter(row => row.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, 12)
    .map(row => row.candidate)
}

/**
 * Load active ledger claims as broker candidates.
 * @param ledgerPath - JSONL path.
 */
export async function loadLedgerCandidates(ledgerPath = DEFAULT_LEDGER): Promise<MemoryCandidate[]> {
  let text = ''
  try {
    text = await readFile(ledgerPath, 'utf8')
  } catch {
    return []
  }
  const records = text.split('\n').filter(line => line.trim()).map(line => {
    try {
      return JSON.parse(line) as Record<string, unknown>
    } catch {
      return null
    }
  }).filter((row): row is Record<string, unknown> => row !== null)
  const superseded = new Set<string>()
  for (const record of records) {
    if (record.type !== 'claim') continue
    for (const id of Array.isArray(record.supersedes) ? record.supersedes : []) {
      if (typeof id === 'string') superseded.add(id)
    }
  }
  const out: MemoryCandidate[] = []
  for (const record of records) {
    if (record.type !== 'claim') continue
    const id = typeof record.id === 'string' ? record.id : ''
    if (id.length === 0 || superseded.has(id)) continue
    const trust = Number(record.trust)
    if (Number.isFinite(trust) && trust < 0.5) continue
    const statement = typeof record.statement === 'string' ? record.statement : ''
    if (statement.trim().length === 0) continue
    out.push({
      id,
      kind: 'claim',
      text: statement.trim().slice(0, 400),
    })
  }
  return out
}

/**
 * Pack selected candidates under a heuristic token budget.
 * @param candidates - already filtered hits.
 * @param maxTokens - remaining candidate budget.
 */
export function budgetCandidates(
  candidates: readonly MemoryCandidate[],
  maxTokens = 1600,
): MemoryCandidate[] {
  const kept: MemoryCandidate[] = []
  let used = 0
  for (const candidate of candidates) {
    const cost = estimateTokens(candidate.text) + 8
    if (used + cost > maxTokens) break
    kept.push(candidate)
    used += cost
  }
  return kept
}

function tokens(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(word => word.length >= 3))
}
