const http = require('node:http')

const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAFAgIACQIBXAAAAABJRU5ErkJggg=='
const port = Number(process.env.CAPTIVELA_MOCK_IMAGES_PORT || 18765)
const expectedKey = process.env.CAPTIVELA_QA_SYNTHETIC_KEY || ''

const server = http.createServer((request, response) => {
  if (request.method !== 'POST' || request.url !== '/v1/images/generations') {
    response.writeHead(404).end()
    return
  }
  if (request.headers.authorization !== `Bearer ${expectedKey}`) {
    response.writeHead(401, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: { message: 'unauthorized' } }))
    return
  }
  let body = ''
  request.setEncoding('utf8')
  request.on('data', (chunk) => {
    body += chunk
    if (body.length > 64 * 1024) request.destroy()
  })
  request.on('end', () => {
    try {
      const parsed = JSON.parse(body)
      if (!parsed.model || !parsed.prompt || parsed.response_format !== 'b64_json')
        throw new Error('invalid request')
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ data: [{ b64_json: png }] }))
    } catch {
      response.writeHead(400, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: 'invalid request' } }))
    }
  })
})

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`READY ${port}\n`)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)))
}
