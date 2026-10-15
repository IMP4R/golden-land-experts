// Isolation proof for the witches clone: every Golden Land store path is either
// bounded to the clone DSH_HOME or the profile refuses to start.
//
// These are the checks the acceptance review asked for: an unset variable must
// fail loudly instead of silently falling back to a live default, and a path
// that escapes the clone home must be rejected rather than written.

import assert from 'node:assert/strict'
import test from 'node:test'

import { checkCloneStores, OPENVIKING_WRITE_TOOLS } from '../lib/store-guard.js'

const HOME = '/clone/dsh-home-witches'

/** A complete, correctly bounded environment for the isolated profile. */
function fullEnv(overrides = {}) {
  return {
    GOLDEN_LAND_WITCHES_ISOLATED: '1',
    GOLDEN_LAND_LEDGER_PATH: `${HOME}/memory/ledger.jsonl`,
    GOLDEN_LAND_HOT_DIR: `${HOME}/memory/hot`,
    GOLDEN_LAND_SKILL_CANDIDATES_DIR: `${HOME}/memory/skill-candidates`,
    GOLDEN_LAND_USAGE_LEDGER_PATH: `${HOME}/memory/usage-ledger.jsonl`,
    GOLDEN_LAND_PROJECTS_PATH: `${HOME}/memory/projects.json`,
    GOLDEN_LAND_SOURCES_DIR: `${HOME}/memory/sources`,
    ...overrides,
  }
}

const REQUIRED = [
  'GOLDEN_LAND_LEDGER_PATH',
  'GOLDEN_LAND_HOT_DIR',
  'GOLDEN_LAND_SKILL_CANDIDATES_DIR',
  'GOLDEN_LAND_USAGE_LEDGER_PATH',
  'GOLDEN_LAND_PROJECTS_PATH',
  'GOLDEN_LAND_SOURCES_DIR',
]

test('a fully configured clone resolves every store under its own DSH_HOME', () => {
  const resolved = checkCloneStores(fullEnv(), HOME)
  assert.deepEqual(Object.keys(resolved).sort(), [...REQUIRED].sort())
  for (const path of Object.values(resolved)) assert.ok(path.startsWith(`${HOME}/`), path)
})

test('each unset store variable refuses to start instead of falling back to live', () => {
  for (const variable of REQUIRED) {
    const env = fullEnv()
    delete env[variable]
    assert.throws(
      () => checkCloneStores(env, HOME),
      new RegExp(`refusing to start with unset store paths.*${variable}`),
      `unset ${variable} must fail loudly`,
    )
  }
})

test('an empty or whitespace store variable counts as unset', () => {
  for (const blank of ['', '   ']) {
    assert.throws(
      () => checkCloneStores(fullEnv({ GOLDEN_LAND_LEDGER_PATH: blank }), HOME),
      /refusing to start with unset store paths/,
    )
  }
})

test('a store path outside the clone DSH_HOME is rejected', () => {
  const live = '/Users/user0/golden-land-new/runtime/memory-ledger/ledger.jsonl'
  assert.throws(
    () => checkCloneStores(fullEnv({ GOLDEN_LAND_LEDGER_PATH: live }), HOME),
    /outside DSH_HOME/,
  )
  assert.throws(
    () => checkCloneStores(fullEnv({ GOLDEN_LAND_HOT_DIR: '/Users/user0/golden-land-new/runtime/memory-hot' }), HOME),
    /outside DSH_HOME/,
  )
})

test('a sibling directory sharing the clone prefix is not accepted as inside', () => {
  assert.throws(
    () => checkCloneStores(fullEnv({ GOLDEN_LAND_HOT_DIR: `${HOME}-live/memory/hot` }), HOME),
    /outside DSH_HOME/,
  )
})

test('mounting the guard outside isolation refuses rather than guarding nothing', () => {
  const env = fullEnv()
  delete env.GOLDEN_LAND_WITCHES_ISOLATED
  assert.throws(() => checkCloneStores(env, HOME), /mounted outside the isolated witches profile/)
})

test('the guard cannot bound stores without DSH_HOME', () => {
  assert.throws(() => checkCloneStores(fullEnv(), ''), /DSH_HOME is required/)
})

test('OpenViking writers are denied, readers are not', () => {
  assert.deepEqual(OPENVIKING_WRITE_TOOLS, [
    'viking_remember',
    'viking_ingest_local',
    'viking_add_resource',
    'viking_forget',
  ])
  const readTools = ['viking_search', 'viking_read', 'viking_browse', 'viking_grep']
  for (const reader of readTools) assert.equal(OPENVIKING_WRITE_TOOLS.includes(reader), false, reader)
})

test('the guard rejects live defaults rather than trusting the caller', () => {
  // The live profile's own store locations, as they appear with no env set.
  const liveDefaults = [
    ['GOLDEN_LAND_LEDGER_PATH', '/Users/user0/golden-land-new/runtime/memory-ledger/ledger.jsonl'],
    ['GOLDEN_LAND_HOT_DIR', '/Users/user0/golden-land-new/runtime/memory-hot'],
    ['GOLDEN_LAND_USAGE_LEDGER_PATH', '/Users/user0/golden-land-new/runtime/usage-ledger.jsonl'],
    ['GOLDEN_LAND_PROJECTS_PATH', '/Users/user0/golden-land-new/runtime/projects.json'],
    ['GOLDEN_LAND_SKILL_CANDIDATES_DIR', '/Users/user0/golden-land-new/runtime/skill-candidates'],
    ['GOLDEN_LAND_SOURCES_DIR', '/Users/user0/golden-land-new/runtime/memory-ledger/sources'],
  ]
  for (const [variable, path] of liveDefaults) {
    assert.throws(
      () => checkCloneStores(fullEnv({ [variable]: path }), HOME),
      /outside DSH_HOME/,
      `${variable} pointing at ${path} must be refused`,
    )
  }
})
