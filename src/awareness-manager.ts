import { Awareness } from 'y-protocols/awareness';
import * as awarenessProtocol from 'y-protocols/awareness';
import {
  encodeAwarenessMessage,
  encodeAwarenessDatagram,
  decodeAwarenessDatagram,
  encodeState,
  decodeState,
} from './encoding';

/**
 * Manages awareness (cursors, presence, typing indicators) with support
 * for both reliable (stream) and unreliable (datagram) transport.
 */
export class AwarenessManager {
  private awareness: Awareness;
  private sendStream: (data: Uint8Array) => Promise<void>;
  private sendDatagram: (data: Uint8Array) => Promise<void>;
  private useDatagrams: boolean;
  private broadcastInterval: number;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private localClock = 0;

  // Track remote client clocks for deduplication
  private remoteClocks = new Map<number, number>();

  constructor(
    awareness: Awareness,
    sendStream: (data: Uint8Array) => Promise<void>,
    sendDatagram: (data: Uint8Array) => Promise<void>,
    options: {
      useDatagrams?: boolean;
      broadcastInterval?: number;
    } = {}
  ) {
    this.awareness = awareness;
    this.sendStream = sendStream;
    this.sendDatagram = sendDatagram;
    this.useDatagrams = options.useDatagrams ?? true;
    this.broadcastInterval = options.broadcastInterval ?? 50; // 20 updates/sec

    this.setupLocalAwarenessListener();
  }

  /**
   * Start broadcasting awareness updates
   */
  start(): void {
    if (this.useDatagrams) {
      this.startDatagramBroadcast();
    }

    // Send initial awareness state via reliable stream
    this.broadcastFullState();
  }

  /**
   * Stop broadcasting
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /**
   * Set up listener for local awareness changes
   */
  private setupLocalAwarenessListener(): void {
    this.awareness.on('update', ({ added, updated, removed }: {
      added: number[];
      updated: number[];
      removed: number[];
    }) => {
      const changedClients = [...added, ...updated, ...removed];
      
      // Check if local client changed
      const localClientId = this.awareness.clientID;
      if (changedClients.includes(localClientId)) {
        if (this.useDatagrams) {
          // Datagrams handle their own broadcast interval
          // Local changes trigger immediate datagram
          this.broadcastLocalStateDatagram();
        } else {
          // Send via reliable stream
          this.broadcastStateStream(changedClients);
        }
      }
    });
  }

  /**
   * Start periodic datagram broadcasts
   */
  private startDatagramBroadcast(): void {
    if (this.intervalId) return;

    this.intervalId = setInterval(() => {
      this.broadcastLocalStateDatagram();
    }, this.broadcastInterval);
  }

  /**
   * Broadcast local awareness state via datagram
   */
  private async broadcastLocalStateDatagram(): Promise<void> {
    const localState = this.awareness.getLocalState();
    if (!localState) return;

    this.localClock++;

    try {
      const stateBytes = encodeState(localState);
      const datagram = encodeAwarenessDatagram(
        this.awareness.clientID,
        this.localClock,
        stateBytes
      );

      await this.sendDatagram(datagram);
    } catch (error) {
      // Datagram failures are expected and OK
      console.debug('[y-webtransport] Datagram broadcast failed:', error);
    }
  }

  /**
   * Broadcast awareness state via reliable stream
   */
  private async broadcastStateStream(clients: number[]): Promise<void> {
    try {
      const update = awarenessProtocol.encodeAwarenessUpdate(
        this.awareness,
        clients
      );
      const message = encodeAwarenessMessage(update);
      await this.sendStream(message);
    } catch (error) {
      console.error('[y-webtransport] Stream awareness broadcast failed:', error);
    }
  }

  /**
   * Broadcast full awareness state (for initial sync)
   */
  async broadcastFullState(): Promise<void> {
    const clients = Array.from(this.awareness.getStates().keys());
    if (clients.length > 0) {
      await this.broadcastStateStream(clients);
    }
  }

  /**
   * Handle incoming awareness message from stream
   */
  handleStreamMessage(data: Uint8Array): void {
    try {
      // Skip message type byte (0x03)
      const awarenessData = data.slice(1);
      awarenessProtocol.applyAwarenessUpdate(
        this.awareness,
        awarenessData,
        'remote-stream'
      );
    } catch (error) {
      console.error('[y-webtransport] Failed to apply awareness update:', error);
    }
  }

  /**
   * Handle incoming awareness datagram
   */
  handleDatagram(data: Uint8Array): void {
    try {
      const { clientId, clock, state: stateBytes } = decodeAwarenessDatagram(data);

      // Ignore our own datagrams
      if (clientId === this.awareness.clientID) return;

      // Check clock for deduplication (only accept newer states)
      const lastClock = this.remoteClocks.get(clientId) ?? 0;
      if (clock <= lastClock) {
        // Old or duplicate datagram, ignore
        return;
      }
      this.remoteClocks.set(clientId, clock);

      // Decode and apply state
      const state = decodeState(stateBytes);
      
      // Update awareness directly
      // Note: We're setting the state directly rather than going through
      // the awareness protocol because datagrams may arrive out of order
      this.awareness.setLocalStateField('_remote', {
        [clientId]: {
          ...state,
          _clock: clock,
          _timestamp: Date.now(),
        },
      });

      // Emit change event
      this.awareness.emit('change', [{
        added: [],
        updated: [clientId],
        removed: [],
      }, 'remote-datagram']);

    } catch (error) {
      // Malformed datagrams are expected occasionally
      console.debug('[y-webtransport] Failed to parse awareness datagram:', error);
    }
  }

  /**
   * Clean up stale remote states (clients that stopped sending)
   */
  cleanupStaleStates(maxAge: number = 10000): void {
    const now = Date.now();
    const states = this.awareness.getStates();

    for (const [clientId, state] of states) {
      if (clientId === this.awareness.clientID) continue;

      const lastUpdate = (state as any)?._timestamp ?? 0;
      if (now - lastUpdate > maxAge) {
        // Remove stale client
        this.awareness.setLocalStateField('_remote', {
          [clientId]: null,
        });
        this.remoteClocks.delete(clientId);
      }
    }
  }

  /**
   * Destroy the awareness manager
   */
  destroy(): void {
    this.stop();
    this.remoteClocks.clear();
  }
}

