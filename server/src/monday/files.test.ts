import { describe, expect, it, vi } from 'vitest'
import { MONDAY_API_VERSION } from './client'
import { MONDAY_FILE_URL, mondayFileUpload } from './files'

const answer = (body: unknown, status = 200) =>
  vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify(body), { status }))

describe('mondayFileUpload (add_file_to_update over /v2/file)', () => {
  it('POSTs multipart with the mutation in query and the file in variables[file]', async () => {
    const fetchImpl = answer({ data: { add_file_to_update: { id: '9' } } })
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47])
    await mondayFileUpload(async () => 'user-token', fetchImpl)('123', png, 'battle.png')

    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe(MONDAY_FILE_URL)
    expect(init!.headers).toEqual({ Authorization: 'user-token', 'API-Version': MONDAY_API_VERSION })
    const form = init!.body as FormData
    expect(form.get('query')).toBe('mutation ($file: File!) { add_file_to_update(update_id: 123, file: $file) { id } }')
    const file = form.get('variables[file]') as File
    expect(file.name).toBe('battle.png')
    expect(file.type).toBe('image/png')
    expect(Buffer.from(await file.arrayBuffer())).toEqual(png)
  })

  it('throws on GraphQL errors, HTTP errors and a non-numeric update id', async () => {
    const up = (f: ReturnType<typeof answer>) => mondayFileUpload(async () => 't', f)
    await expect(up(answer({ errors: [{ message: 'no access' }] }))('1', Buffer.alloc(1), 'a.png')).rejects.toThrow(/no access/)
    await expect(up(answer({ error_message: 'bad' }, 500))('1', Buffer.alloc(1), 'a.png')).rejects.toThrow(/bad/)
    const f = answer({})
    await expect(up(f)('1) { id } } mutation {', Buffer.alloc(1), 'a.png')).rejects.toThrow(/bad update id/)
    expect(f).not.toHaveBeenCalled()
  })
})
