# yjs-webtransport

> WebTransport provider for Y.js — Real-time collaboration over QUIC with unreliable datagram support.

[![npm version](https://img.shields.io/npm/v/yjs-webtransport.svg)](https://www.npmjs.com/package/yjs-webtransport)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Features

- 🚀 **WebTransport/QUIC** — Modern transport, faster than WebSocket
- ⚡ **19ms round-trip latency** — Tested over real network conditions
- 🎯 **Unreliable datagrams** — Perfect for cursor/presence updates
- 🔄 **Reliable streams** — Document sync that never loses data
- 🔌 **Y.js compatible** — Works as a provider for Y.js CRDTs
- 📦 **Zero head-of-line blocking** — QUIC streams are independent

## Why WebTransport over WebSocket?

| Feature | WebSocket | yjs-webtransport |
|---------|-----------|-----------------|
| Transport | TCP | QUIC |
| Cursor latency | ~50ms+ under load | **~19ms consistent** |
| Head-of-line blocking | Yes | **No** |
| Packet loss handling | Waits for retransmit | **Datagrams skip it** |

## Installation

```bash
npm install yjs-webtransport yjs
```

## Quick Start

```typescript
import * as Y from 'yjs';
import { WebTransportProvider } from 'yjs-webtransport';

const doc = new Y.Doc();
const provider = new WebTransportProvider(
  'https://your-server.com',  // Your y-webtransport-go server
  'room-name',
  doc
);

// Listen for sync status
provider.on('synced', (synced) => {
  console.log('Document synced:', synced);
});

// Access awareness for cursors/presence
provider.awareness.setLocalStateField('user', {
  name: 'Alice',
  color: '#ff0000'
});

provider.awareness.setLocalStateField('cursor', {
  anchor: 0,
  head: 10
});
```

## How It Works

```
┌─────────────────────────────────────────────────────────────┐
│                  yjs-webtransport Architecture               │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│   Document Changes ──► QUIC Stream (reliable) ──► Server    │
│                                                              │
│   Cursor Updates ──► QUIC Datagram (unreliable) ──► Server  │
│                                                              │
│   ┌─────────────────────────────────────────────────────┐   │
│   │  Datagrams: No retransmit = No waiting = 19ms        │   │
│   └─────────────────────────────────────────────────────┘   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## API

### WebTransportProvider

```typescript
new WebTransportProvider(
  serverUrl: string,
  roomName: string,
  doc: Y.Doc,
  options?: WebTransportProviderOptions
)
```

#### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `awareness` | `Awareness` | `new Awareness(doc)` | Custom awareness instance |
| `connect` | `boolean` | `true` | Auto-connect on creation |
| `serverCertificateHashes` | `Array` | - | For self-signed certs (dev) |
| `useUnreliableAwareness` | `boolean` | `true` | Use datagrams for cursors |
| `awarenessUpdateInterval` | `number` | `50` | Datagram broadcast interval (ms) |
| `maxReconnectAttempts` | `number` | `10` | Max reconnection attempts |

#### Events

```typescript
provider.on('synced', (synced: boolean) => {});
provider.on('status', ({ status }) => {});
provider.on('connection-error', (error: Error) => {});
provider.on('connection-close', (event) => {});
```

#### Properties

```typescript
provider.connected  // boolean - connection status
provider.synced     // boolean - document sync status
provider.awareness  // Awareness - for cursors/presence
provider.doc        // Y.Doc - the Y.js document
```

#### Methods

```typescript
provider.connect(): Promise<void>
provider.disconnect(): void
provider.destroy(): void
```

## Server

You need a WebTransport server. Use our Go server:

### y-webtransport-go (Official Server)

```bash
go install github.com/Kkartik14/y-webtransport-go@latest
```

See [y-webtransport-go](https://github.com/Kkartik14/y-webtransport-go) for setup.

## TLS Certificates

WebTransport requires HTTPS.

**Production**: Use Let's Encrypt
```bash
sudo certbot certonly --standalone -d your-domain.com
```

**Development**: Self-signed + Chrome flag
```bash
# Enable chrome://flags/#webtransport-developer-mode
```

## Browser Support

| Browser | Support |
|---------|---------|
| Chrome | ✅ 97+ |
| Edge | ✅ 97+ |
| Firefox | ✅ 114+ |
| Safari | ⏳ Coming soon |

## Benchmarks

Real network test (MacBook Air → Oracle Cloud India):

```
┌─────────────────────────────────────────────────┐
│ WebTransport Datagram Round-Trip                │
│   Average: 19.4ms                               │
│   P50: 17.7ms                                   │
│   P99: 46.1ms                                   │
│   Delivery: 499/500 (99.8%)                     │
└─────────────────────────────────────────────────┘
```

## Related

- [y-webtransport-go](https://github.com/Kkartik14/y-webtransport-go) — Go server
- [Y.js](https://github.com/yjs/yjs) — CRDT implementation
- [TipTap](https://tiptap.dev) — Editor framework

## License

MIT © Kartik Gupta
