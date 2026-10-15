// Shared expert pool used by the isolated witches host plugin.
// Canonical typed source: dsh-witches-clone/packages/experimental/witches-runtime/src/experts.ts

import { randomUUID } from 'node:crypto'

export function expertById(experts, id) {
  return experts.find((expert) => expert.id === id)
}

export function canCancelEpisode(episode, witchSessionId) {
  return episode.witchSessionId === witchSessionId
}

export function parseContract(raw, fallbackScope) {
  const text = String(raw || '').trim()
  const field = (name) => {
    const match = text.match(new RegExp(`(?:^|\\n)${name}:\\s*(.+)$`, 'im'))
    return match && match[1] ? match[1].trim() : undefined
  }
  const list = (name) => {
    const block = text.match(new RegExp(`(?:^|\\n)${name}:\\s*\\n((?:\\s*-\\s*.+\\n?)+)`, 'i'))
    if (!block || !block[1]) {
      const one = field(name)
      return one ? [one] : []
    }
    return block[1].split('\n').map((line) => line.replace(/^\s*-\s*/, '').trim()).filter(Boolean)
  }
  const calls = Number((text.match(/calls:\s*(\d+)/i) || [])[1] || 12)
  return {
    type: 'task',
    id: field('id') || `T-${randomUUID().slice(0, 8)}`,
    goal: field('goal') || text.slice(0, 240),
    scope: field('scope') || fallbackScope,
    inputs: list('inputs'),
    constraints: list('constraints'),
    accept: list('accept'),
    budget: { calls: Math.max(1, calls), remaining: Math.max(1, calls) },
    stopIf: list('stop_if'),
  }
}

function cloneEpisode(episode) {
  return {
    ...episode,
    contract: {
      ...episode.contract,
      inputs: [...episode.contract.inputs],
      constraints: [...episode.contract.constraints],
      accept: [...episode.contract.accept],
      stopIf: [...episode.contract.stopIf],
      budget: { ...episode.contract.budget },
    },
    route: { ...episode.route },
    privateNotes: [...episode.privateNotes],
    message: episode.message ? { ...episode.message } : undefined,
  }
}

export class ExpertPool {
  constructor(experts, seed) {
    this.experts = experts
    this.domain = new Map()
    this.episodes = new Map()
    for (const expert of experts) {
      this.domain.set(expert.id, [...((seed && seed[expert.id]) || [])])
    }
  }

  memoryOf(expertId) {
    return this.domain.get(expertId) || []
  }

  remember(expertId, text) {
    if (!expertById(this.experts, expertId)) throw new Error(`unknown expert "${expertId}"`)
    const fact = { id: `mem-${randomUUID().slice(0, 8)}`, text: String(text).trim(), status: 'verified' }
    const list = this.domain.get(expertId) || []
    list.push(fact)
    this.domain.set(expertId, list)
    return fact
  }

  ask(witchSessionId, expertId, mode, contractText) {
    const expert = expertById(this.experts, expertId)
    if (!expert) throw new Error(`unknown expert "${expertId}"`)
    const now = new Date().toISOString()
    const contract = parseContract(contractText, expert.scope)
    if (contract.scope && !expert.scope.includes(contract.scope) && !contract.scope.includes(expert.scope)) {
      throw new Error(`contract scope "${contract.scope}" is outside expert "${expert.id}"`)
    }
    const episode = {
      id: randomUUID(),
      expertId,
      witchSessionId,
      mode,
      contract,
      status: 'queued',
      version: 1,
      route: { provider: '', model: '' },
      privateNotes: [],
      createdAt: now,
      updatedAt: now,
    }
    this.episodes.set(episode.id, episode)
    return this.run(episode.id, witchSessionId)
  }

  inspect(episodeId) {
    const episode = this.episodes.get(episodeId)
    return episode ? cloneEpisode(episode) : undefined
  }

  episodesOf(expertId) {
    return [...this.episodes.values()].filter((episode) => episode.expertId === expertId).map(cloneEpisode)
  }

  pause(episodeId, witchSessionId) {
    const episode = this.requireOwned(episodeId, witchSessionId)
    if (!['running', 'queued', 'waiting'].includes(episode.status)) {
      throw new Error(`cannot pause episode in status ${episode.status}`)
    }
    episode.status = 'paused'
    episode.updatedAt = new Date().toISOString()
    return cloneEpisode(episode)
  }

  resume(episodeId, witchSessionId) {
    const episode = this.requireOwned(episodeId, witchSessionId)
    if (episode.status !== 'paused') throw new Error(`cannot resume episode in status ${episode.status}`)
    episode.version += 1
    return this.run(episode.id, witchSessionId)
  }

  cancel(episodeId, witchSessionId) {
    const episode = this.requireOwned(episodeId, witchSessionId)
    episode.status = 'cancelled'
    episode.updatedAt = new Date().toISOString()
    episode.message = {
      type: 'blocked',
      task: episode.contract.id,
      status: 'failed',
      delta: 'Episode cancelled by owning witch.',
    }
    return cloneEpisode(episode)
  }

  requireOwned(episodeId, witchSessionId) {
    const episode = this.episodes.get(episodeId)
    if (!episode) throw new Error(`missing episode "${episodeId}"`)
    if (!canCancelEpisode(episode, witchSessionId)) {
      throw new Error('a witch may cancel only its own expert episode')
    }
    return episode
  }

  run(episodeId, witchSessionId) {
    const episode = this.requireOwned(episodeId, witchSessionId)
    if (episode.status === 'cancelled' || episode.status === 'completed') return cloneEpisode(episode)
    episode.status = 'running'
    episode.contract.budget.remaining = Math.max(0, episode.contract.budget.remaining - 1)
    const stop = episode.contract.stopIf.find((rule) => /migrat|production|policy/i.test(`${rule} ${episode.contract.goal}`))
    if (stop) {
      episode.status = 'waiting'
      episode.message = {
        type: 'decision',
        task: episode.contract.id,
        status: 'blocked',
        blocker: stop,
        options: [
          { id: 'A', text: 'Escalate to the witch / prime for authorization.' },
          { id: 'B', text: 'Stay inside current scope and report residual risk.' },
        ],
        recommend: 'A',
        need: 'Authorization to leave the expert scope.',
      }
      episode.updatedAt = new Date().toISOString()
      return cloneEpisode(episode)
    }
    const hits = this.relevantFacts(episode.expertId, episode.contract.goal)
    if (episode.mode === 'context') {
      episode.status = 'completed'
      episode.message = {
        type: 'result',
        task: episode.contract.id,
        status: 'done',
        delta: hits.length === 0 ? 'No stored competence matched this request.' : hits.map((f) => f.text).join(' '),
        evidence: hits.map((f) => f.id),
        checks: 'context-only; no tools executed',
      }
      episode.updatedAt = new Date().toISOString()
      return cloneEpisode(episode)
    }
    const checks = this.checkAccept(episode.contract, hits)
    const failed = checks.filter((row) => !row.ok)
    episode.status = failed.length === 0 ? 'completed' : 'waiting'
    episode.message = failed.length === 0
      ? {
        type: 'result',
        task: episode.contract.id,
        status: 'done',
        delta: hits.length === 0
          ? `Executed one cheap iteration on ${episode.contract.goal}. No stored method; residual risk remains.`
          : `Executed one cheap iteration on ${episode.contract.goal}. Applied stored method: ${hits[0].text}`,
        evidence: hits.map((f) => f.id),
        checks: checks.map((row) => `${row.text}: PASS`).join('; ') || 'no explicit accept tests',
      }
      : {
        type: 'decision',
        task: episode.contract.id,
        status: 'blocked',
        blocker: failed.map((row) => row.text).join('; '),
        options: [
          { id: 'A', text: 'Gather more evidence and retry locally.' },
          { id: 'B', text: 'Escalate the failed accept checks.' },
        ],
        recommend: 'A',
        need: 'Direction after failed accept checks.',
      }
    episode.updatedAt = new Date().toISOString()
    return cloneEpisode(episode)
  }

  relevantFacts(expertId, goal) {
    const words = new Set(String(goal).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3))
    return this.memoryOf(expertId).filter((fact) => {
      const body = new Set(fact.text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3))
      let hit = 0
      for (const word of words) if (body.has(word)) hit += 1
      return words.size === 0 ? true : hit / words.size >= 0.12
    }).slice(0, 8)
  }

  checkAccept(contract, hits) {
    if (!contract.accept.length) return []
    const blob = hits.map((f) => f.text).join(' ').toLowerCase()
    return contract.accept.map((text) => {
      const keys = text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4)
      return { text, ok: keys.length === 0 || keys.some((word) => blob.includes(word)) }
    })
  }
}
