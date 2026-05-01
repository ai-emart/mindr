import { afterEach, describe, expect, it } from 'vitest'
import { request } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createUiServer } from '../../src/ui/server.js'
import { MockBackend } from '../helpers/mock-backend.js'

const servers: Array<{ close: (cb?: () => void) => void }> = []

afterEach(async () => {
  await Promise.all(servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
  servers.length = 0
})

async function start() {
  const server = createUiServer({ backend: new MockBackend([]) })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  servers.push(server)
  const port = (server.address() as AddressInfo).port
  return `http://127.0.0.1:${port}`
}

describe('Mindr UI server', () => {
  it.each([
    ['/', 'Overview'],
    ['/memories', 'Memories'],
    ['/decisions', 'Decisions'],
    ['/conventions', 'Conventions'],
    ['/technical-debt', 'Technical Debt'],
    ['/sessions', 'Sessions'],
  ])('returns 200 for %s', async (path, marker) => {
    const base = await start()
    const res = await fetch(`${base}${path}`)
    const text = await res.text()
    expect(res.status).toBe(200)
    expect(text).toContain(marker)
    expect(text).toContain('data-page')
  })

  it('refuses non-localhost Host headers', async () => {
    const base = await start()
    const url = new URL(base)
    const status = await new Promise<number>((resolve, reject) => {
      const req = request({
        hostname: url.hostname,
        port: url.port,
        path: '/',
        headers: { host: 'example.com' },
      }, (res) => {
        res.resume()
        res.on('end', () => resolve(res.statusCode ?? 0))
      })
      req.on('error', reject)
      req.end()
    })
    expect(status).toBe(403)
  })
})
