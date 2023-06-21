# websocket-hypercore-replicator

Replicate a Hypercore over a websocket connection

Handles some of the edge cases around replicating a [Hypercore](https://github.com/holepunchto/hypercore) over a websocket connection, in particular around gracefully closing the connection without causing an error on either side of the websocket connection.

## Table of Contents

- [Install](#install)
- [Usage](#usage)
- [API](#api)
- [Maintainers](#maintainers)
- [Contributing](#contributing)
- [License](#license)

## Install

```
npm install websocket-hypercore-replicator
```

## Usage

```js
import Hypercore from 'hypercore'
import WebSocketHypercoreReplicator from 'websocket-hypercore-replicator'
import { WebSocket } from 'ws'

const ws = new WebSocket('ws://www.example.com/websocket')
const core = new Hypercore()
const replicationStream = core.replicate(true)
const wshr = new WebSocketHypercoreReplicator(ws, replicationStream)

// Download hypercore etc...

// Gracefully close
await wshr.close()
```

## API

### `wshr = new WebSocketHypercoreReplicator(websocket, replicationStream)`

Where `websocket` is a [WebSocket](http://developer.mozilla.org/en-US/docs/Web/API/WebSocket) instance (use [`ws`](https://github.com/websockets/ws) on the server), and `replicationStream` is the stream returned by `core.replicate()`.

### `await wshr.close()`

Gracefully close the websocket and replication stream. Returns a promise that will fullfill when everything is closed.

## Maintainers

[@digidem](https://github.com/digidem)

## Contributing

PRs accepted.

Small note: If editing the README, please conform to the [standard-readme](https://github.com/RichardLitt/standard-readme) specification.

## License

MIT © 2023 Digital Democracy
