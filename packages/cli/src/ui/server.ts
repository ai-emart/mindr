import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { MemoryBackend } from '@ai-emart/mindr-core'

export interface UiServerOptions {
  backend: MemoryBackend
  port?: number
}

const PAGES = ['Overview', 'Memories', 'Decisions', 'Conventions', 'Technical Debt', 'Sessions']
const UI_DIR = dirname(fileURLToPath(import.meta.url))

function ok(res: ServerResponse, body: string, type = 'text/html'): void {
  res.writeHead(200, { 'content-type': `${type}; charset=utf-8` })
  res.end(body)
}

function escapeHtml(input: string): string {
  return input.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] ?? ch))
}

async function renderPage(backend: MemoryBackend, page: string): Promise<string> {
  const type = page === 'Memories' ? undefined : page.toLowerCase().replace('technical debt', 'debt').replace('sessions', 'session_checkpoint')
  const memories = await backend.listByTags(type ? [{ key: 'type', value: type }] : [], 50)
  const rows = memories.map((m) => `<tr><td><a href="/memories/${m.id}">${m.id.slice(0, 8)}</a></td><td>${escapeHtml(m.tags.find((t) => t.key === 'type')?.value ?? '')}</td><td>${escapeHtml(m.content)}</td></tr>`).join('')
  return `<!doctype html>
<html><head><title>Mindr ${page}</title><link rel="stylesheet" href="/static/style.css"><script src="/static/htmx.min.js"></script><script src="/static/alpine.min.js" defer></script></head>
<body><header><strong>Mindr</strong><nav>${PAGES.map((p) => `<a href="/${p.toLowerCase().replaceAll(' ', '-')}">${p}</a>`).join('')}</nav></header>
<main><h1>${page}</h1><table data-page="${page}"><thead><tr><th>ID</th><th>Type</th><th>Content</th></tr></thead><tbody>${rows}</tbody></table></main></body></html>`
}

async function renderMemoryDetail(backend: MemoryBackend, id: string): Promise<string> {
  const memory = await backend.getById(id)
  if (!memory) return '<section data-memory-detail>Memory not found</section>'
  return `<section data-memory-detail><h2>${memory.id}</h2><p>${escapeHtml(memory.content)}</p><pre>${escapeHtml(JSON.stringify(memory.tags, null, 2))}</pre></section>`
}

export function createUiServer(opts: UiServerOptions) {
  const backend = opts.backend
  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const host = req.headers.host ?? ''
    if (!host.startsWith('127.0.0.1') && !host.startsWith('localhost')) {
      res.writeHead(403)
      res.end('Forbidden')
      return
    }
    const url = new URL(req.url ?? '/', `http://${host || '127.0.0.1'}`)
    if (url.pathname.startsWith('/static/')) {
      const path = join(UI_DIR, 'static', url.pathname.slice('/static/'.length))
      const type = path.endsWith('.css') ? 'text/css' : 'application/javascript'
      ok(res, readFileSync(path, 'utf8'), type)
      return
    }
    if (url.pathname.startsWith('/memories/')) {
      ok(res, await renderMemoryDetail(backend, url.pathname.slice('/memories/'.length)))
      return
    }
    const page = PAGES.find((p) => `/${p.toLowerCase().replaceAll(' ', '-')}` === url.pathname) ?? 'Overview'
    ok(res, await renderPage(backend, page))
  })
}
