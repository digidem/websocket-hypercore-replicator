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
  t.ok(core1Replication.destroyed, '1st replication stream is destroyed')
  t.ok(core2Replication.destroyed, '2nd replication stream is destroyed')
  server.close()
  await once(server, 'close')
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
  server.close()
  await once(server, 'close')
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
  t.ok(core1Replication.destroyed, '1st replication stream is destroyed')
  t.ok(core2Replication.destroyed, '2nd replication stream is destroyed')
  server.close()
  await once(server, 'close')
})

// This tests the WebSocketSafetyTransform, which stops data being written to a
// closing websocket connection.
test('closing websocket during replication', async (t) => {
  const core1 = await createCore()
  const core2 = await createCore(core1.key)
  await core1.append(['a', 'b', 'c', 'd'])

  const { server, port } = await createServer()
  const clientWs = new WebSocket('ws://localhost:' + port)
  const core1Replication = core1.replicate(true)
  const wshr = new WebSocketHypercoreReplicator(clientWs, core1Replication)

  const [serverWs] = /** @type {[import('ws').WebSocket]} */ (
    await once(server, 'connection')
  )
  const core2Replication = core2.replicate(false)
  // Without the WebSocketSafetyTransform, the replication stream will emit a
  // error "WebSocket is not open: readyState 2 (CLOSING)"
  core1Replication.on('error', t.fail)
  core2Replication.on('error', t.fail)
  new WebSocketHypercoreReplicator(serverWs, core2Replication)
  await core2.update({ wait: true })
  core2.download({ start: 0, end: core1.length })
  await Promise.all([
    wshr.close().then(() => {
      t.pass('closed replicator on the client')
    }),
    once(serverWs, 'close').then(() => {
      t.pass('server websocket was closed')
    }),
  ])
  t.ok(core1Replication.destroyed, '1st replication stream is destroyed')
  t.ok(core2Replication.destroyed, '2nd replication stream is destroyed')
  server.close()
  await once(server, 'close')
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
