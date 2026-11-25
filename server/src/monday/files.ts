// Attaching a file to an update. GraphQL itself can't carry a file, so monday has a separate
// endpoint, /v2/file, that takes multipart/form-data: the mutation in `query` and the file in
// `variables[file]` (https://developer.monday.com/api-reference/reference/assets-1).
// It is not in the shared gateway: that one speaks JSON GraphQL only (the app's iframe can't do this).
import type { Id } from '@app/api/GameApi'
import { currentEvent } from '../log/wideEvent'
import { MONDAY_API_VERSION } from './client'

export const MONDAY_FILE_URL = 'https://api.monday.com/v2/file'

export type AddFileToUpdate = (updateId: Id, file: Buffer, filename: string, contentType?: string) => Promise<void>

export function mondayFileUpload(getToken: () => Promise<string>, fetchImpl: typeof fetch = (...a) => fetch(...a)): AddFileToUpdate {
  return async (updateId, file, filename, contentType = 'image/png') => {
    if (!/^\d+$/.test(updateId)) throw new Error(`bad update id ${updateId}`) // it goes into the query text
    const form = new FormData()
    form.set('query', `mutation ($file: File!) { add_file_to_update(update_id: ${updateId}, file: $file) { id } }`)
    form.set('variables[file]', new Blob([new Uint8Array(file)], { type: contentType }), filename)
    currentEvent()?.inc('mondayCalls')
    const res = await fetchImpl(MONDAY_FILE_URL, {
      method: 'POST',
      headers: { Authorization: await getToken(), 'API-Version': MONDAY_API_VERSION },
      body: form,
    })
    const body = (await res.json().catch(() => ({}))) as { data?: { add_file_to_update?: { id?: unknown } }; errors?: { message?: string }[]; error_message?: string }
    if (!res.ok || body.errors?.length || !body.data?.add_file_to_update?.id) {
      const why = body.errors?.[0]?.message ?? body.error_message ?? `HTTP ${res.status}`
      throw new Error(`add_file_to_update failed: ${why}`)
    }
  }
}
