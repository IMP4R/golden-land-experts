/**
 * Heuristic token budgeting and human-message isolation for Memory Broker.
 * @module @deepseek-ai/dsh-experimental-witches-runtime/broker
 */

import type { Message } from '@deepseek-ai/dsh-llm'
import type { MemoryCapsule } from './types.ts'

/** Fixed density used until an exact tokenizer is wired. */
export const CHARS_PER_TOKEN = 4

/** HANDOFF §11 Memory Broker token budgets. Code enforces these, not the prompt. */
export const BROKER_BUDGET = {
  instruction: 400,
  task: 600,
  tail: 2400,
  candidates: 1600,
  total: 5000,
  output: 300,
} as const

/** Cheap-filter instruction. Must stay inside the 400-token instruction budget. */
export const BROKER_FILTER_INSTRUCTION = [
  'Select only memory useful to the current human request.',
  'Do not solve the task. Do not invent facts. Empty output is valid.',
  'Keep sources. Drop duplicates and off-topic hits, including other projects that only share generic words.',
  'Output YAML with facts (text, source, status), constraints, missing. Empty facts are valid.',
].join(' ')

/**
 * Price UTF-8 text under the same 4-chars-per-token heuristic as dsh-token-meter.
 * @param text - raw text.
 * @returns heuristic token count.
 */
export function estimateTokens(text: string): number {
  if (text.length === 0) return 0
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

/** One candidate memory hit collected before the cheap filter. */
export interface MemoryCandidate {
  /** Stable id or URI. */
  id: string
  /** Kind of store. */
  kind: 'claim' | 'viking' | 'graphiti' | 'hot' | 'constraint'
  /** Body shown to the filter. */
  text: string
}

/** Inputs assembled for one Memory Broker call. */
export interface BrokerInput {
  /** Authentic human-message id. */
  humanMessageId: string
  /** Human text, already truncated. */
  humanText: string
  /** Optional active task contract. */
  contract: string
  /** Candidate memories, already de-duplicated. */
  candidates: readonly MemoryCandidate[]
  /** Optional recent relevant tail, already truncated by the caller if needed. */
  tail?: string
}

/**
 * Whether a user-role message is authentic human input rather than a plugin dump.
 * @param message - model-visible message.
 * @returns true only for source.kind === 'user'.
 */
export function isHumanUserMessage(message: Message): boolean {
  return message.role === 'user' && message.source?.kind === 'user'
}

/**
 * Concatenate text blocks of one message.
 * @param message - model-visible message.
 * @returns joined text.
 */
export function textOf(message: Message): string {
  return message.content
    .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
    .map(block => block.text)
    .join('\n')
}

/**
 * Take the latest authentic human user message from a transcript.
 * Plugin reminders, capsules, and tool-attributed user rows are ignored.
 * @param messages - transcript in surface order.
 * @returns the last human message, or undefined.
 */
export function latestHumanMessage(messages: readonly Message[]): Message | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]
    if (message !== undefined && isHumanUserMessage(message)) return message
  }
  return undefined
}

/**
 * Clip UTF-8 text to a heuristic token budget.
 * @param text - raw text.
 * @param maxTokens - ceiling.
 */
export function clipToTokens(text: string, maxTokens: number): string {
  if (estimateTokens(text) <= maxTokens) return text
  return text.slice(0, Math.max(0, maxTokens * CHARS_PER_TOKEN))
}

/**
 * Pack broker input into HANDOFF §11 section budgets. Instruction and the
 * current human request survive; tail and candidates are truncated first.
 * @param input - unbounded broker input.
 * @param maxTokens - hard ceiling for the complete packed string.
 */
export function packBrokerInput(input: BrokerInput, maxTokens: number = BROKER_BUDGET.total): {
  packed: string
  tokens: number
  parts: { instruction: number; task: number; tail: number; candidates: number }
} {
  const instruction = clipToTokens(BROKER_FILTER_INSTRUCTION, BROKER_BUDGET.instruction)
  const taskBody = [input.humanText, input.contract.trim()].filter(s => s.length > 0).join('\n')
  const task = clipToTokens(`HUMAN: ${taskBody}`, BROKER_BUDGET.task)
  const tailRaw = (input.tail ?? '').trim()
  const tail = tailRaw.length === 0 ? '' : clipToTokens(`TAIL:\n${tailRaw}`, BROKER_BUDGET.tail)
  const candidateLines = input.candidates.map(c => `- [${c.kind}:${c.id}] ${c.text}`)
  while (estimateTokens(candidateLines.join('\n')) > BROKER_BUDGET.candidates && candidateLines.length > 0) {
    candidateLines.pop()
  }
  const candidates = candidateLines.join('\n')
  let packed = [instruction, task, tail, candidates].filter(s => s.length > 0).join('\n')
  if (estimateTokens(packed) > maxTokens) packed = clipToTokens(packed, maxTokens)
  return {
    packed,
    tokens: estimateTokens(packed),
    parts: {
      instruction: estimateTokens(instruction),
      task: estimateTokens(task),
      tail: estimateTokens(tail),
      candidates: estimateTokens(candidates),
    },
  }
}

/**
 * Truncate a filter response to the output token budget.
 * @param text - raw filter output.
 * @param maxTokens - output ceiling.
 * @returns truncated text.
 */
export function clipCapsuleText(text: string, maxTokens: number): string {
  const trimmed = text.trim()
  if (estimateTokens(trimmed) <= maxTokens) return trimmed
  return trimmed.slice(0, maxTokens * CHARS_PER_TOKEN).trimEnd()
}

/**
 * Build the single model-visible reminder for a capsule.
 * @param capsule - selected memory.
 * @returns reminder text.
 */
export function capsuleReminder(capsule: MemoryCapsule): string {
  if (capsule.text.length === 0) {
    return '<system-reminder>Memory Broker: no relevant durable memory for this human message.</system-reminder>'
  }
  const sources = capsule.sources.length === 0 ? '' : `\nSources: ${capsule.sources.join(', ')}`
  return `<system-reminder>Memory Broker capsule for human message ${capsule.humanMessageId}. Treat as leads, not current state.${sources}\n${capsule.text}\n</system-reminder>`
}
