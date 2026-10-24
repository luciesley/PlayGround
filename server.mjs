import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, resolve, sep } from 'node:path'

const root = resolve(process.argv[2] || 'dist')
const port = Number(process.argv[3] || process.env.PORT || 3000)

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.webmanifest': 'application/manifest+json'
}

function safePath(urlPath) {
  const path = resolve(root, '.' + decodeURIComponent(urlPath))
  return path === root || path.startsWith(root + sep) ? path : ''
}

function resolveFile(path) {
  if (!path || !existsSync(path)) return ''
  try {
    return statSync(path).isDirectory() ? join(path, 'index.html') : path
  } catch {
    return ''
  }
}

const server = createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' })
    res.end('Method not allowed')
    return
  }

  let pathname
  try {
    pathname = new URL(req.url, 'http://localhost').pathname
  } catch {
    res.writeHead(400)
    res.end('Bad request')
    return
  }

  let file = resolveFile(safePath(pathname))
  if (!file && !extname(pathname)) file = resolveFile(join(root, 'index.html'))

  if (!file || !existsSync(file)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Not found')
    return
  }

  res.writeHead(200, {
    'Content-Type': mime[extname(file).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff'
  })

  if (req.method === 'HEAD') {
    res.end()
    return
  }

  createReadStream(file)
    .on('error', () => {
      if (!res.headersSent) res.writeHead(500)
      res.end()
    })
    .pipe(res)
})

server.listen(port, '0.0.0.0', () => {
  console.log(`Serving ${root} on http://0.0.0.0:${port}`)
})

function shutdown() {
  server.close(() => process.exit(0))
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
