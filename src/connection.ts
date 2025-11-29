import { Protocol, type ConnectionStatus } from './types';

/**
 * Manages the WebTransport connection lifecycle
 */
export class ConnectionManager {
  private url: string;
  private roomName: string;
  private serverCertificateHashes?: Array<{
    algorithm: 'sha-256';
    value: ArrayBuffer;
  }>;

  private transport: WebTransport | null = null;
  private syncStream: WebTransportBidirectionalStream | null = null;
  private syncWriter: WritableStreamDefaultWriter | null = null;
  private syncReader: ReadableStreamDefaultReader | null = null;

  private reconnectAttempts = 0;
  private maxReconnectAttempts: number;
  private reconnectBaseDelay: number;
  private reconnectMaxDelay: number;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  // Callbacks
  public onStatusChange: ((status: ConnectionStatus) => void) | null = null;
  public onSyncMessage: ((data: Uint8Array) => void) | null = null;
  public onDatagram: ((data: Uint8Array) => void) | null = null;
  public onError: ((error: Error) => void) | null = null;
  public onClose: ((event: { code: number; reason: string }) => void) | null = null;

  constructor(
    url: string,
    roomName: string,
    options: {
      serverCertificateHashes?: Array<{
        algorithm: 'sha-256';
        value: ArrayBuffer;
      }>;
      maxReconnectAttempts?: number;
      reconnectBaseDelay?: number;
      reconnectMaxDelay?: number;
    } = {}
  ) {
    this.url = url;
    this.roomName = roomName;
    this.serverCertificateHashes = options.serverCertificateHashes;
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? 10;
    this.reconnectBaseDelay = options.reconnectBaseDelay ?? 1000;
    this.reconnectMaxDelay = options.reconnectMaxDelay ?? 30000;
  }

  /**
   * Check if WebTransport is supported in this environment
   */
  static isSupported(): boolean {
    return typeof WebTransport !== 'undefined';
  }

  /**
   * Get current connection status
   */
  get connected(): boolean {
    return this.transport !== null && this.syncWriter !== null;
  }

  /**
   * Connect to the WebTransport server
   */
  async connect(): Promise<void> {
    if (this.destroyed) {
      throw new Error('Connection manager has been destroyed');
    }

    if (!ConnectionManager.isSupported()) {
      throw new Error('WebTransport is not supported in this browser');
    }

    this.onStatusChange?.('connecting');

    try {
      // Build connection URL
      const connectionUrl = `${this.url}/collab/${this.roomName}`;
      console.log(`[y-webtransport] Connecting to ${connectionUrl}`);

      // Create WebTransport connection
      const options: WebTransportOptions = {};
      if (this.serverCertificateHashes) {
        options.serverCertificateHashes = this.serverCertificateHashes;
      }

      this.transport = new WebTransport(connectionUrl, options);

      // Wait for connection to be ready
      await this.transport.ready;
      console.log('[y-webtransport] WebTransport connection ready');

      // Open sync stream
      await this.openSyncStream();

      // Start listening for datagrams
      this.listenDatagrams();

      // Handle connection close
      this.transport.closed.then((closeInfo) => {
        console.log('[y-webtransport] Connection closed:', closeInfo);
        this.handleClose(closeInfo);
      }).catch((error) => {
        console.error('[y-webtransport] Connection error:', error);
        this.handleError(error);
      });

      // Reset reconnect attempts on successful connection
      this.reconnectAttempts = 0;
      this.onStatusChange?.('connected');

    } catch (error) {
      console.error('[y-webtransport] Failed to connect:', error);
      this.handleError(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Open the sync stream for Y.js document synchronization
   */
  private async openSyncStream(): Promise<void> {
    if (!this.transport) {
      throw new Error('No transport connection');
    }

    // Create bidirectional stream
    this.syncStream = await this.transport.createBidirectionalStream();
    this.syncWriter = this.syncStream.writable.getWriter();
    this.syncReader = this.syncStream.readable.getReader();

    // Send stream type identifier
    await this.syncWriter.write(new Uint8Array([Protocol.STREAM_SYNC]));
    console.log('[y-webtransport] Sync stream opened');

    // Start reading from stream
    this.readSyncStream();
  }

  /**
   * Read messages from the sync stream
   */
  private async readSyncStream(): Promise<void> {
    if (!this.syncReader) return;

    let buffer = new Uint8Array(0);

    try {
      while (true) {
        const { value, done } = await this.syncReader.read();
        if (done) {
          console.log('[y-webtransport] Sync stream closed');
          break;
        }

        // Append to buffer
        const newBuffer = new Uint8Array(buffer.length + value.length);
        newBuffer.set(buffer);
        newBuffer.set(value, buffer.length);
        buffer = newBuffer;

        // Process complete messages
        while (buffer.length >= 2) {
          const msgLen = (buffer[0] << 8) | buffer[1];
          if (buffer.length < 2 + msgLen) break;

          const message = buffer.slice(2, 2 + msgLen);
          buffer = buffer.slice(2 + msgLen);

          this.onSyncMessage?.(message);
        }
      }
    } catch (error) {
      if (!this.destroyed) {
        console.error('[y-webtransport] Error reading sync stream:', error);
        this.handleError(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  /**
   * Listen for incoming datagrams (awareness updates)
   */
  private async listenDatagrams(): Promise<void> {
    if (!this.transport) return;

    const reader = this.transport.datagrams.readable.getReader();

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        this.onDatagram?.(value);
      }
    } catch (error) {
      if (!this.destroyed) {
        console.error('[y-webtransport] Error reading datagrams:', error);
      }
    }
  }

  /**
   * Send a message on the sync stream
   */
  async sendSyncMessage(data: Uint8Array): Promise<void> {
    if (!this.syncWriter) {
      console.warn('[y-webtransport] Cannot send: sync stream not open');
      return;
    }

    // Frame with length prefix
    const framed = new Uint8Array(2 + data.length);
    framed[0] = (data.length >> 8) & 0xff;
    framed[1] = data.length & 0xff;
    framed.set(data, 2);

    await this.syncWriter.write(framed);
  }

  /**
   * Send a datagram (unreliable, for awareness)
   */
  async sendDatagram(data: Uint8Array): Promise<void> {
    if (!this.transport) {
      return;
    }

    try {
      const writer = this.transport.datagrams.writable.getWriter();
      await writer.write(data);
      writer.releaseLock();
    } catch (error) {
      // Datagrams can fail silently - that's fine
      console.debug('[y-webtransport] Datagram send failed:', error);
    }
  }

  /**
   * Handle connection error
   */
  private handleError(error: Error): void {
    this.cleanup();
    this.onError?.(error);

    if (!this.destroyed) {
      this.scheduleReconnect();
    }
  }

  /**
   * Handle connection close
   */
  private handleClose(closeInfo: WebTransportCloseInfo): void {
    this.cleanup();
    this.onClose?.({
      code: closeInfo.closeCode ?? 0,
      reason: closeInfo.reason ?? '',
    });
    this.onStatusChange?.('disconnected');

    if (!this.destroyed) {
      this.scheduleReconnect();
    }
  }

  /**
   * Schedule a reconnection attempt
   */
  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log('[y-webtransport] Max reconnect attempts reached');
      return;
    }

    // Exponential backoff with jitter
    const delay = Math.min(
      this.reconnectBaseDelay * Math.pow(2, this.reconnectAttempts) +
        Math.random() * 1000,
      this.reconnectMaxDelay
    );

    console.log(
      `[y-webtransport] Reconnecting in ${Math.round(delay)}ms (attempt ${this.reconnectAttempts + 1}/${this.maxReconnectAttempts})`
    );

    this.onStatusChange?.('reconnecting');
    this.reconnectAttempts++;

    this.reconnectTimeout = setTimeout(() => {
      this.connect().catch((error) => {
        console.error('[y-webtransport] Reconnect failed:', error);
      });
    }, delay);
  }

  /**
   * Clean up resources
   */
  private cleanup(): void {
    if (this.syncWriter) {
      try {
        this.syncWriter.releaseLock();
      } catch {}
      this.syncWriter = null;
    }

    if (this.syncReader) {
      try {
        this.syncReader.releaseLock();
      } catch {}
      this.syncReader = null;
    }

    this.syncStream = null;
    this.transport = null;
  }

  /**
   * Disconnect from the server
   */
  disconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.transport) {
      try {
        this.transport.close({
          closeCode: 1000,
          reason: 'Client disconnect',
        });
      } catch {}
    }

    this.cleanup();
    this.onStatusChange?.('disconnected');
  }

  /**
   * Destroy the connection manager
   */
  destroy(): void {
    this.destroyed = true;
    this.disconnect();
  }
}

