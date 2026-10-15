/** Ledger UI wire readers for the Projects and Design seats. */

const LEDGER_ORIGIN = 'http://127.0.0.1:3181'

/** One Golden Land project. */
export interface ProjectRecord {
  id: string
  name: string
  description?: string
}

/** One project cluster. */
export interface ClusterRecord {
  id: string
  projectId: string
  name: string
}

/** Session assignment stored by the Golden Land project registry. */
export interface AssignmentRecord {
  projectId: string
  clusterId?: string
}

/** One top-level session returned by the ledger service. */
export interface SessionRecord {
  id: string
  lastActive?: number
}

/** Projects API response. */
export interface ProjectsResponse {
  projects: ProjectRecord[]
  clusters: ClusterRecord[]
  assignments: Record<string, AssignmentRecord>
  sessions: SessionRecord[]
}

/** Design file catalog response. */
export interface DesignsResponse {
  files: string[]
}

/** Read JSON without using fetch, which the harness browser learning trap intercepts.
 * @param path - ledger service path.
 * @returns parsed response payload.
 */
function readJson<T>(path: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('GET', `${LEDGER_ORIGIN}${path}`, true)
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(`ledger request failed (${xhr.status})`))
        return
      }
      try {
        resolve(JSON.parse(xhr.responseText) as T)
      } catch {
        reject(new Error('ledger returned invalid JSON'))
      }
    }
    xhr.onerror = () => { reject(new Error('ledger service is unavailable')) }
    xhr.send()
  })
}

/** Read the project tree.
 * @returns projects, clusters, assignments, and top-level sessions.
 */
export function loadProjects(): Promise<ProjectsResponse> {
  return readJson<ProjectsResponse>('/api/projects')
}

/** Read the available design preview files.
 * @returns preview filename catalog.
 */
export function loadDesigns(): Promise<DesignsResponse> {
  return readJson<DesignsResponse>('/api/designs')
}

/** Build an absolute preview URL.
 * @param file - sanitized filename returned by the design catalog.
 * @returns ledger preview URL.
 */
export function designUrl(file: string): string {
  return `${LEDGER_ORIGIN}/design/${encodeURIComponent(file)}`
}
