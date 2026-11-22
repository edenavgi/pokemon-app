// How the app talks to our server (Phase 2). Every call carries a FRESH monday sessionToken,
// which the server verifies to know who is calling (server/src/auth/sessionToken.ts).
// sessionTokens expire quickly, so one is asked for per request instead of being kept.

/** A failed call: `status` is the HTTP status (0 = no answer), `code` the server's error code. */
export class ServerError extends Error {
  readonly status: number
  readonly code: string
  // (no constructor parameter properties: the app's tsconfig is erasableSyntaxOnly)
  constructor(status: number, code: string) {
    super(`Server error ${status} ${code}`)
    this.name = 'ServerError'
    this.status = status
    this.code = code
  }
}

export interface ServerClient {
  get<T>(path: string): Promise<T>
  post<T>(path: string, body?: unknown): Promise<T>
  put(path: string, body: unknown): Promise<void>
}

/**
 * @param baseUrl the server's URL; '' = same origin (the Vite dev proxy forwards /api to it)
 * @param getSessionToken monday.get('sessionToken') in the app
 */
export function createServerClient(
  baseUrl: string,
  getSessionToken: () => Promise<string>,
  fetchImpl: typeof fetch = (...args) => fetch(...args),
): ServerClient {
  async function call(method: string, path: string, body?: unknown): Promise<Response> {
    const headers: Record<string, string> = { Authorization: `Bearer ${await getSessionToken()}` }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    let res: Response
    try {
      res = await fetchImpl(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
    } catch {
      throw new ServerError(0, 'NETWORK') // offline, CORS refused, server down
    }
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: unknown }
      throw new ServerError(res.status, typeof data.error === 'string' ? data.error : `HTTP_${res.status}`)
    }
    return res
  }

  return {
    get: async <T,>(path: string) => (await (await call('GET', path)).json()) as T,
    post: async <T,>(path: string, body?: unknown) => (await (await call('POST', path, body)).json()) as T,
    put: async (path: string, body: unknown) => {
      await call('PUT', path, body)
    },
  }
}
