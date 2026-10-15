// Terminal stage validation and human-facing cycle status.

/** Refuses partial output before JSON parsing, preserving provider diagnostics. */
export function stageOutput(settled, role, turnReason) {
  if (settled?.stopReason !== 'completed') {
    const detail = settled?.diagnostic || turnReason?.error?.message || ''
    const error = new Error(`${role}: ${settled?.stopReason || 'unknown'}${detail ? ` — ${detail}` : ''}`)
    error.code = turnReason?.error?.code || 'STAGE_FAILED'
    throw error
  }
  return (settled.output || []).filter(block => block?.type === 'text').map(block => block.text).join('\n')
}

/** Worker allowance counts tool calls, not retries or pending work. */
export function terminalReport(cycleId, result) {
  return {
    cycleId,
    status: result.accepted ? 'completed' : result.paused ? 'paused' : 'failed',
    accepted: result.accepted === true,
    automaticContinuation: false,
    reviewPending: false,
    failure: result.error || (result.paused ? 'review_budget_exhausted' : null),
    workers: (result.workers || []).map(worker => ({
      id: worker.id, finished: worker.finished, unusedToolCalls: worker.remaining,
    })),
    evidence: result.evidence || [],
    effectVerified: result.accepted === true,
    instruction: result.accepted
      ? 'Report only verified review evidence.'
      : 'The run is settled. No worker or reviewer is still running. Unused tool calls are NOT retries. Do not promise another message or automatic continuation. Report the failure; effects are unverified, not necessarily absent. A new explicitly started run is required to retry.',
  }
}
