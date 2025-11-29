import * as Y from 'yjs';
import { Observable } from 'lib0/observable';
import { Awareness } from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

import { ConnectionManager } from './connection';
import { AwarenessManager } from './awareness-manager';
import {
  type WebTransportProviderOptions,
  type ConnectionStatus,
  Protocol,
} from './types';
// Encoding utilities available for advanced use cases
// import { frameMessage, encodeUpdate } from './encoding';

/**
 * WebTransportProvider - Y.js provider using WebTransport for real-time collaboration.
 *
 * Features:
 * - Reliable document sync over QUIC streams
 * - Unreliable awareness (cursors/presence) over QUIC datagrams
 * - Automatic reconnection with exponential backoff
 * - Cross-tab communication support
 *
 * @example
 * ```typescript
 * import * as Y from 'yjs';
 * import { WebTransportProvider } from 'y-webtransport';
 *
 * const doc = new Y.Doc();
 * const provider = new WebTransportProvider(
 *   'https://your-server.com',
 *   'room-name',
 *   doc
 * );
 *
 * provider.on('synced', (synced) => {
 *   console.log('Synced:', synced);
 * });
 * ```
 */
export class WebTransportProvider extends Observable<string> {
  readonly doc: Y.Doc;
  readonly roomName: string;
  readonly awareness: Awareness;

  private _serverUrl: string;
  private options: WebTransportProviderOptions;
  private connection: ConnectionManager;
  private awarenessManager: AwarenessManager | null = null;

  private _synced = false;
  private _connected = false;
  private destroyed = false;

  constructor(
    serverUrl: string,
    roomName: string,
    doc: Y.Doc,
    options: WebTransportProviderOptions = {}
  ) {
    super();

    this._serverUrl = serverUrl;
    this.roomName = roomName;
    this.doc = doc;
    this.options = options;

    // Initialize awareness
    this.awareness = options.awareness || new Awareness(doc);

    // Initialize connection manager
    this.connection = new ConnectionManager(serverUrl, roomName, {
      serverCertificateHashes: options.serverCertificateHashes,
      maxReconnectAttempts: options.maxReconnectAttempts,
      reconnectBaseDelay: options.reconnectBaseDelay,
      reconnectMaxDelay: options.reconnectMaxDelay,
    });

    // Set up connection callbacks
    this.connection.onStatusChange = this.handleStatusChange.bind(this);
    this.connection.onSyncMessage = this.handleSyncMessage.bind(this);
    this.connection.onDatagram = this.handleDatagram.bind(this);
    this.connection.onError = this.handleError.bind(this);
    this.connection.onClose = this.handleClose.bind(this);

    // Set up Y.js document observer
    this.doc.on('update', this.handleDocUpdate.bind(this));

    // Connect if auto-connect enabled (default)
    if (options.connect !== false) {
      this.connect();
    }
  }

  /**
   * The server URL this provider is connected to
   */
  get serverUrl(): string {
    return this._serverUrl;
  }

  /**
   * Whether the provider is connected
   */
  get connected(): boolean {
    return this._connected;
  }

  /**
   * Whether the document is synced
   */
  get synced(): boolean {
    return this._synced;
  }

  /**
   * Connect to the server
   */
  async connect(): Promise<void> {
    if (this.destroyed) {
      throw new Error('Provider has been destroyed');
    }

    try {
      await this.connection.connect();
    } catch (error) {
      console.error('[y-webtransport] Connection failed:', error);
      throw error;
    }
  }

  /**
   * Disconnect from the server
   */
  disconnect(): void {
    this.connection.disconnect();
    this.awarenessManager?.stop();
  }

  /**
   * Destroy the provider and clean up resources
   */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;

    // Remove awareness
    this.awareness.destroy();

    // Clean up awareness manager
    this.awarenessManager?.destroy();

    // Disconnect
    this.connection.destroy();

    // Remove doc observer
    this.doc.off('update', this.handleDocUpdate.bind(this));

    super.destroy();
  }

  /**
   * Handle connection status changes
   */
  private handleStatusChange(status: ConnectionStatus): void {
    console.log('[y-webtransport] Status:', status);

    const wasConnected = this._connected;
    this._connected = status === 'connected';

    if (status === 'connected' && !wasConnected) {
      // Just connected - start sync
      this.startSync();
    } else if (status === 'disconnected' && wasConnected) {
      // Lost connection
      this._synced = false;
      this.emit('synced', [false]);
    }

    this.emit('status', [{ status }]);
  }

  /**
   * Start the sync protocol
   */
  private startSync(): void {
    console.log('[y-webtransport] Starting sync');

    // Initialize awareness manager
    this.awarenessManager = new AwarenessManager(
      this.awareness,
      (data) => this.connection.sendSyncMessage(data),
      (data) => this.connection.sendDatagram(data),
      {
        useDatagrams: this.options.useUnreliableAwareness !== false,
        broadcastInterval: this.options.awarenessUpdateInterval,
      }
    );

    // Send sync step 1 (state vector)
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, Protocol.MSG_SYNC_STEP1);
    syncProtocol.writeSyncStep1(encoder, this.doc);

    const message = encoding.toUint8Array(encoder);
    this.connection.sendSyncMessage(message);

    // Start awareness broadcasts
    this.awarenessManager.start();
  }

  /**
   * Handle incoming sync message
   */
  private handleSyncMessage(data: Uint8Array): void {
    if (data.length === 0) return;

    const messageType = data[0];

    switch (messageType) {
      case Protocol.MSG_SYNC_STEP1:
        this.handleSyncStep1(data.slice(1));
        break;

      case Protocol.MSG_SYNC_STEP2:
        this.handleSyncStep2(data.slice(1));
        break;

      case Protocol.MSG_UPDATE:
        this.handleRemoteUpdate(data.slice(1));
        break;

      case Protocol.MSG_AWARENESS:
        this.awarenessManager?.handleStreamMessage(data);
        break;

      default:
        console.warn('[y-webtransport] Unknown message type:', messageType);
    }
  }

  /**
   * Handle sync step 1 (remote state vector)
   */
  private handleSyncStep1(data: Uint8Array): void {
    console.log('[y-webtransport] Received sync step 1');

    const decoder = decoding.createDecoder(data);
    const encoder = encoding.createEncoder();

    encoding.writeVarUint(encoder, Protocol.MSG_SYNC_STEP2);
    syncProtocol.readSyncStep1(decoder, encoder, this.doc);

    const response = encoding.toUint8Array(encoder);
    if (response.length > 1) {
      this.connection.sendSyncMessage(response);
    }

    // Also send our sync step 1 if we haven't
    if (!this._synced) {
      const step1Encoder = encoding.createEncoder();
      encoding.writeVarUint(step1Encoder, Protocol.MSG_SYNC_STEP1);
      syncProtocol.writeSyncStep1(step1Encoder, this.doc);
      this.connection.sendSyncMessage(encoding.toUint8Array(step1Encoder));
    }
  }

  /**
   * Handle sync step 2 (missing updates)
   */
  private handleSyncStep2(data: Uint8Array): void {
    console.log('[y-webtransport] Received sync step 2');

    const decoder = decoding.createDecoder(data);
    syncProtocol.readSyncStep2(decoder, this.doc, this);

    if (!this._synced) {
      this._synced = true;
      this.emit('synced', [true]);
      this.emit('sync', [true]);
      console.log('[y-webtransport] Document synced!');
    }
  }

  /**
   * Handle remote Y.js update
   */
  private handleRemoteUpdate(data: Uint8Array): void {
    Y.applyUpdate(this.doc, data, this);
  }

  /**
   * Handle local Y.js document update
   */
  private handleDocUpdate(update: Uint8Array, origin: unknown): void {
    // Don't echo back remote updates
    if (origin === this) return;

    if (!this._connected) {
      console.debug('[y-webtransport] Queuing update (not connected)');
      return;
    }

    // Send update to server
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, Protocol.MSG_UPDATE);
    encoding.writeVarUint8Array(encoder, update);

    const message = encoding.toUint8Array(encoder);
    this.connection.sendSyncMessage(message);
  }

  /**
   * Handle incoming datagram (awareness)
   */
  private handleDatagram(data: Uint8Array): void {
    this.awarenessManager?.handleDatagram(data);
  }

  /**
   * Handle connection error
   */
  private handleError(error: Error): void {
    console.error('[y-webtransport] Error:', error);
    this.emit('connection-error', [error]);
  }

  /**
   * Handle connection close
   */
  private handleClose(event: { code: number; reason: string }): void {
    console.log('[y-webtransport] Closed:', event);
    this.emit('connection-close', [event]);
  }
}

