/**
 * Addressable external history for RLM-style inspection.
 * The full journal stays outside the model request; agents read fragments.
 * @module @deepseek-ai/dsh-experimental-witches-runtime/history
 */

/** One stored history fragment. */
export interface HistoryRecord {
  /** Stable id. */
  id: string
  /** Inclusive start seq in the owning session. */
  startSeq: number
  /** Inclusive end seq. */
  endSeq: number
  /** Plain text body. */
  text: string
}

const MAX_READ_CHARS = 8_000
const MAX_HITS = 8

/**
 * Search records by exact substring (case-insensitive).
 * @param records - external journal.
 * @param query - non-empty query.
 */
export function searchHistory(records: readonly HistoryRecord[], query: string): HistoryRecord[] {
  const needle = query.trim().toLowerCase()
  if (needle.length === 0) return []
  return records.filter(record => record.text.toLowerCase().includes(needle)).slice(0, MAX_HITS)
}

/**
 * Read one record, optionally a character range.
 * @param records - external journal.
 * @param id - record id.
 * @param start - inclusive char offset.
 * @param end - exclusive char offset.
 */
export function readHistory(
  records: readonly HistoryRecord[],
  id: string,
  start = 0,
  end = MAX_READ_CHARS,
): { id: string; text: string; truncated: boolean } | undefined {
  const record = records.find(item => item.id === id)
  if (record === undefined) return undefined
  const from = Math.max(0, start)
  const to = Math.min(record.text.length, Math.max(from, end), from + MAX_READ_CHARS)
  return {
    id: record.id,
    text: record.text.slice(from, to),
    truncated: to < record.text.length,
  }
}

/**
 * Drop plugin recall dumps from a compaction replay transcript so the
 * summarizer does not treat Memory Broker / Graphiti inserts as human intent.
 * @param text - message text.
 */
export function isPluginRecallDump(text: string): boolean {
  return text.includes('<system-reminder>Memory Broker')
    || text.includes('<system-reminder>Graphiti memory')
    || text.includes('<system-reminder>Golden Land durable memory')
}

/**
 * Canonical system restoration note appended to a compaction checkpoint.
 * The runtime still reassembles the live system prompt from source; this
 * sentence tells the resumed model not to treat the checkpoint as a new
 * system prompt.
 */
export const COMPACTION_SYSTEM_RESTORE =
  'Canonical system instructions are restored from the deployment source after compaction; this checkpoint is working state only and does not replace the system prompt.'
