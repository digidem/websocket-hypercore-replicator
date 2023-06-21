import { pipeline, Transform } from 'streamx'
import { TypedEmitter } from 'tiny-typed-emitter'
import { createWebSocketStream } from 'ws'

import { once } from 'node:events'

/**
 * @typedef {object} Events
 * @property {(data: import('ws').RawData, isBinary: boolean) => void} message
 * @property {(error: Error) => void} error
 */

/** @extends {TypedEmitter<Events>} */
export default class WebSocketHypercoreReplicator extends TypedEmitter {
  #ws
  /** @type {any} */
  #protocolStream
  #closed = false
  /**
   *
   * @param {import('ws').WebSocket} ws
   * @param {any} protocolStream Hypercore or Corestore replication stream
   */
  constructor(ws, protocolStream) {
    super()
    this.#protocolStream = protocolStream
    this.#ws = ws
    const conn = createWebSocketStream(ws)

    /** @param {Error} error */
    const onError = (error) => {
      /* c8 ignore next - swallow errors if manually closed */
      this.#protocolStream.destroy(this.#closed ? undefined : error)
    }

    const onOpen = () => {
      // only start replicating once the websocket is connected, bail if close() already called
      if (this.#closed) return
      // Can remove this now, since the pipeline handles error forwarding
      conn.off('error', onError)

      pipeline(
        conn,
        protocolStream,
        new WebSocketSafetyTransform(ws),
        conn,
        onError
      )
    }

    conn.on('error', onError)

    if (ws.readyState === ws.CONNECTING) {
      ws.once('open', onOpen)
    } else {
      onOpen()
    }
  }

  /**
   * Gracefully close the replication stream and the websocket
   */
  async close() {
    this.#closed = true
    const ws = this.#ws
    const protocolStream = this.#protocolStream

    if (ws.readyState === ws.CLOSED) {
      if (protocolStream.destroyed) return
      /* c8 ignore next 4 */
      // Can't think of a test scenario that would result in the websocket
      // closing without the protocol stream being destroyed, but just in case
      protocolStream.destroy()
      return once(protocolStream, 'close')
    } else if (ws.readyState === ws.CONNECTING) {
      // Trying to close before it has opened creates hard to catch errors
      await once(ws, 'open')
      // The protocolStream has not been piped anywhere at this stage, so need
      // to destroy it manually
      protocolStream.destroy()
    }
    ws.close()

    await Promise.all([once(ws, 'close'), once(protocolStream, 'close')])
  }
}

/** @typedef {Transform<Buffer, Buffer>} TStream */

/**
 * Ensures that data is not written to a Websocket that is closing or is closed
 * (which would throw an error).
 *
 * @extends {Transform<Buffer, Buffer>}
 */
class WebSocketSafetyTransform extends Transform {
  #ws

  /**
   *
   * @param {import('ws').WebSocket} ws
   * @param {import('streamx').TransformOptions<TStream, Buffer, Buffer>} [opts]
   */
  constructor(ws, opts) {
    super(opts)
    this.#ws = ws
  }

  /** @type {TStream['_transform']} */
  _transform(data, cb) {
    if (this.#ws.readyState >= this.#ws.CLOSING) return cb()
    cb(null, data)
  }
}
