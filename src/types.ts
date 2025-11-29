import type { Awareness } from 'y-protocols/awareness';

/**
 * WebTransport provider options
 */
export interface WebTransportProviderOptions {
  /**
   * Custom awareness instance. If not provided, a new one will be created.
   */
  awareness?: Awareness;

  /**
   * Whether to connect immediately on construction.
   * @default true
   */
  connect?: boolean;

  /**
   * Certificate hashes for self-signed certificates (development only).
   * Required when using self-signed certs with WebTransport.
   */
  serverCertificateHashes?: Array<{
    algorithm: 'sha-256';
    value: ArrayBuffer;
  }>;

  /**
   * Whether to use unreliable datagrams for awareness updates.
   * This provides lower latency for cursor/presence updates.
   * @default true
   */
  useUnreliableAwareness?: boolean;

  /**
   * Interval in ms for broadcasting awareness updates via datagrams.
   * Only used when useUnreliableAwareness is true.
   * @default 50 (20 updates per second)
   */
  awarenessUpdateInterval?: number;

  /**
   * Maximum number of reconnection attempts before giving up.
   * @default 10
   */
  maxReconnectAttempts?: number;

  /**
   * Base delay in ms for reconnection backoff.
   * @default 1000
   */
  reconnectBaseDelay?: number;

  /**
   * Maximum delay in ms for reconnection backoff.
   * @default 30000
   */
  reconnectMaxDelay?: number;

  /**
   * Interval in ms to force a full resync. Set to 0 to disable.
   * @default 0
   */
  resyncInterval?: number;

  /**
   * Parameters to pass to the server via query string.
   */
  params?: Record<string, string>;
}

/**
 * Connection status events
 */
export type ConnectionStatus = 
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'reconnecting';

/**
 * Events emitted by WebTransportProvider
 */
export interface WebTransportProviderEvents {
  synced: (synced: boolean) => void;
  status: (status: { status: ConnectionStatus }) => void;
  'connection-error': (error: Error) => void;
  'connection-close': (event: { code: number; reason: string }) => void;
  sync: (synced: boolean) => void;
}

/**
 * Protocol constants
 */
export const Protocol = {
  // Stream types (first byte when opening a stream)
  STREAM_SYNC: 0x01,
  STREAM_AWARENESS: 0x02,
  STREAM_RESERVED_1: 0x03,

  // Message types within sync stream
  MSG_SYNC_STEP1: 0x00,
  MSG_SYNC_STEP2: 0x01,
  MSG_UPDATE: 0x02,
  MSG_AWARENESS: 0x03,

  // Datagram types
  DATAGRAM_AWARENESS: 0x00,
} as const;

/**
 * Latency measurement for benchmarking
 */
export interface LatencyMeasurement {
  timestamp: number;
  rtt: number;
  type: 'stream' | 'datagram';
}

