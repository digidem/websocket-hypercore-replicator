import Hypercore from 'hypercore'
import RAM from 'random-access-memory'
import test from 'tape'
import { WebSocketServer, WebSocket } from 'ws'

import { once } from 'node:events'

import WebSocketHypercoreReplicator from './index.js'

test('replicate over websocket', async (t) => {
  const core1 = await createCore()
  const core2 = await createCore(core1.key)
  await core1.append(['a', 'b', 'c', 'd'])

  const { server, port } = await createServer()
  const clientWs = new WebSocket('ws://localhost:' + port)
  const core1Replication = core1.replicate(true)
  const wshr1 = new WebSocketHypercoreReplicator(clientWs, core1Replication)

  const [serverWs] = /** @type {[import('ws').WebSocket]} */ (
    await once(server, 'connection')
  )
  const core2Replication = core2.replicate(false)
  const wshr2 = new WebSocketHypercoreReplicator(serverWs, core2Replication)
  await core2.update({ wait: true })
  t.equal(core2.length, core1.length, 'length is updated')
  t.equal(core2.peers.length, 1, 'is connected to peer')

  await core2.download({ start: 0, end: core1.length }).done()
  t.deepEqual(await core2.get(2), Buffer.from('c'), 'data is replicated')

  await Promise.all([wshr1.close(), wshr2.close()])
  server.close()
  once(server, 'close')
})

test('websocket error before replication', async (t) => {
  const core = await createCore()
  const ws = new WebSocket('ws://localhost:999')
  const coreReplication = core.replicate(true)
  new WebSocketHypercoreReplicator(ws, coreReplication)
  const [error] = await once(coreReplication, 'error')
  t.equal(
    error.code,
    'ECONNREFUSED',
    'Websocket stream error forwarded to replication stream'
  )
})

test('graceful end before websocket has connected', async (t) => {
  const core = await createCore()
  const { port, server } = await createServer()
  const ws = new WebSocket('ws://localhost:' + port)
  const coreReplication = core.replicate(true)
  let closed = false
  coreReplication.on('close', () => {
    closed = true
  })
  const wshr = new WebSocketHypercoreReplicator(ws, coreReplication)
  t.equal(ws.readyState, ws.CONNECTING, 'websocket is still connecting')
  await wshr.close()
  t.equal(ws.readyState, ws.CLOSED, 'Websocket is closed')
  t.ok(closed, 'replication stream is also closed')
  await server.close()
})

test('close after websocket close', async (t) => {
  const core1 = await createCore()
  const core2 = await createCore(core1.key)
  await core1.append(['a', 'b', 'c', 'd'])

  const { server, port } = await createServer()
  const clientWs = new WebSocket('ws://localhost:' + port)
  const core1Replication = core1.replicate(true)
  const wshr1 = new WebSocketHypercoreReplicator(clientWs, core1Replication)

  const [serverWs] = /** @type {[import('ws').WebSocket]} */ (
    await once(server, 'connection')
  )
  const core2Replication = core2.replicate(false)
  const wshr2 = new WebSocketHypercoreReplicator(serverWs, core2Replication)
  await core2.update({ wait: true })

  clientWs.close()
  await once(clientWs, 'close')

  await Promise.all([wshr1.close(), wshr2.close()])
  // This tests the code that checks the websocket is closed in the close() function.
  t.pass('closed replication')
  server.close()
  once(server, 'close')
})

// This tests the WebSocketSafetyTransform, but currently this test does not
// fail if I remove WebSocketSafetyTransform. When experimenting with this I did
// get errors, which is why I added that, I just can't replicate now in a test.
test('closing websocket during replication', async (t) => {
  const core1 = await createCore()
  const core2 = await createCore(core1.key)
  await core1.append(['a', 'b', 'c', 'd'])

  const { server, port } = await createServer()
  const clientWs = new WebSocket('ws://localhost:' + port)
  const core1Replication = core1.replicate(true)
  new WebSocketHypercoreReplicator(clientWs, core1Replication)

  const [serverWs] = /** @type {[import('ws').WebSocket]} */ (
    await once(server, 'connection')
  )
  const core2Replication = core2.replicate(false)
  new WebSocketHypercoreReplicator(serverWs, core2Replication)
  await core2.update({ wait: true })
  core2.download({ start: 0, end: core1.length })
  clientWs.close()
  await once(serverWs, 'close')
  t.pass('closed replication')
  server.close()
  once(server, 'close')
})

/** @param {Buffer} [key] */
async function createCore(key) {
  const core = new Hypercore(RAM, key)
  await core.ready()
  return core
}

async function createServer() {
  const server = new WebSocketServer({ port: 0 })
  await once(server, 'listening')
  const { port } = /** @type {import('ws').AddressInfo} */ (server.address())
  return { server, port }
}
