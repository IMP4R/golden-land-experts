import { mkdtemp, mkdir, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkWorkerScope } from '../src/worker-scope.ts'

describe('checkWorkerScope', () => {
  it('allows new descendants but rejects traversal, sibling prefixes and symlink escape', async () => {
    const temp = await mkdtemp(join(tmpdir(), 'witch-scope-'))
    const root = join(temp, 'root')
    const outside = join(temp, 'root-other')
    await mkdir(root); await mkdir(outside)
    await symlink(outside, join(root, 'escape'))
    try {
      await checkWorkerScope('write', { file_path: 'new/sub/file.txt' }, root, root)
      await expect(checkWorkerScope('edit', { file_path: '../root-other/file' }, root, root)).rejects.toThrow('outside')
      await expect(checkWorkerScope('write', { file_path: 'escape/file' }, root, root)).rejects.toThrow('outside')
      await expect(checkWorkerScope('grep', {}, root, outside)).rejects.toThrow('outside')
      await expect(checkWorkerScope('bash', {}, root, root)).rejects.toThrow('isolated')
      await expect(checkWorkerScope('edit', { file_path: 'safe', sandbox_permissions: 'danger-full-access' }, root, root)).rejects.toThrow('widen')
    } finally { await rm(temp, { recursive: true, force: true }) }
  })
})
