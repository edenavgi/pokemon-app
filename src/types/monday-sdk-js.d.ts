// Local types for monday-sdk-js.
// The package ships its types as .ts files that fail our strict compiler flags
// (verbatimModuleSyntax / erasableSyntaxOnly), so tsconfig maps the module here instead.
// Only what we use is typed; extend as needed. Runtime behaviour is unchanged.

export interface MondayResponse<T = unknown> {
  data: T
}

export interface MondayClientSdk {
  get(type: 'context' | 'settings' | 'itemIds' | 'sessionToken' | 'location' | 'filter', params?: object): Promise<MondayResponse>
  listen(
    type: string | string[],
    callback: (res: MondayResponse & { type?: string }) => void,
    params?: object,
  ): () => void
  execute(type: string, params?: object): Promise<MondayResponse>
  api(query: string, options?: { variables?: Record<string, unknown>; apiVersion?: string }): Promise<MondayResponse>
  setApiVersion(version: string): void
  storage: {
    getItem(key: string): Promise<MondayResponse<{ value: string | null; version?: string }>>
    setItem(key: string, value: string, options?: { previous_version?: string }): Promise<MondayResponse>
    deleteItem(key: string): Promise<MondayResponse>
  }
}

declare function mondaySdk(config?: { clientId?: string; apiVersion?: string }): MondayClientSdk
export default mondaySdk
