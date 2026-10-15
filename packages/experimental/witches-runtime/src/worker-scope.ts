/** Conservative worker dispatch policy until a sandboxed shell is available. */
import { realpath } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'

/** Recognized filesystem tools; opaque execution and extensions cannot be confined by argument inspection. */
const FILE_TOOLS = new Set(['read', 'read_image', 'write', 'edit', 'glob', 'grep'])

/** Checks the requested path and existing ancestors against the physical assignment root. */
export async function checkWorkerScope(tool: string, rawArgs: unknown, scope: string, cwd: string | undefined): Promise<void> {
  if (!rawArgs || typeof rawArgs !== 'object' || Array.isArray(rawArgs)) throw new Error('Filesystem tool arguments must be an object')
  const args = rawArgs as Record<string, unknown>
  if (!FILE_TOOLS.has(tool)) throw new Error('Tool requires an isolated execution provider; opaque execution and delegation are not permitted')
  if (!isAbsolute(scope)) throw new Error('Worker scope must be an absolute filesystem root')
  if (args.sandbox_permissions !== undefined) throw new Error('Workers cannot widen sandbox permissions')
  const raw = tool === 'glob' || tool === 'grep' ? args.path : args.file_path
  if (raw !== undefined && typeof raw !== 'string') throw new Error('Invalid filesystem path')
  if (raw === undefined && tool !== 'glob' && tool !== 'grep') throw new Error('Filesystem path required')
  if (!cwd && (raw === undefined || !isAbsolute(raw as string))) throw new Error('Relative path requires an authenticated workspace')
  const root = await realpath(scope)
  let target = resolve(cwd ?? scope, raw as string | undefined ?? '.')
  const suffix: string[] = []
  for (;;) {
    try { target = resolve(await realpath(target), ...suffix); break } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      const parent = dirname(target)
      if (parent === target) throw error
      suffix.unshift(relative(parent, target))
      target = parent
    }
  }
  const within = relative(root, target)
  if (within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within)) throw new Error('Filesystem path outside worker assignment scope')
}
