/**
 * y-webtransport - WebTransport provider for Y.js
 *
 * The first WebTransport provider for Y.js, featuring:
 * - Reliable document sync over QUIC streams
 * - Unreliable awareness (cursors/presence) over QUIC datagrams
 * - Sub-10ms cursor latency
 * - Automatic reconnection
 *
 * @packageDocumentation
 */

export { WebTransportProvider } from './provider';
export { ConnectionManager } from './connection';
export { AwarenessManager } from './awareness-manager';

export type {
  WebTransportProviderOptions,
  ConnectionStatus,
  WebTransportProviderEvents,
  LatencyMeasurement,
} from './types';

export { Protocol } from './types';

// Re-export useful utilities
export {
  frameMessage,
  readFramedMessages,
  encodeUpdate,
  encodeAwarenessDatagram,
  decodeAwarenessDatagram,
} from './encoding';

