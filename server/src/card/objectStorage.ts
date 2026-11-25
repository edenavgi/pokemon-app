// monday code Object storage (a Google Cloud Storage bucket per app) for the battle cards.
// The SDK's ObjectStorage throws in its constructor when OBJECT_STORAGE_BUCKET is not set, so it is
// created on first use: a server without the bucket still starts, and only the card fails (best effort).
import { ObjectStorage } from '@mondaycom/apps-sdk'

export interface ObjectStoragePort {
  upload(name: string, content: Buffer, contentType: string): Promise<void>
  /** null when the file can't be read (missing, or storage trouble) */
  download(name: string): Promise<{ content: Buffer; contentType: string } | null>
}

export const cardFileName = (battleId: string) => `cards/${battleId}.png`

export function sdkObjectStorage(): ObjectStoragePort {
  let storage: ObjectStorage | undefined
  const get = () => (storage ??= new ObjectStorage())
  return {
    async upload(name, content, contentType) {
      const res = await get().uploadFile(name, content, { contentType })
      if (!res.success) throw new Error(`Object storage upload failed: ${res.error ?? 'unknown error'}`)
    },
    async download(name) {
      const res = await get().downloadFile(name)
      if (!res.success || !res.content) return null
      return { content: res.content, contentType: res.contentType ?? 'application/octet-stream' }
    },
  }
}
