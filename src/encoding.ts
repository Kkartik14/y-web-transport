/**
 * Binary encoding/decoding utilities for the y-webtransport protocol
 */

/**
 * Frame a message with a 2-byte length prefix (big-endian)
 */
export function frameMessage(data: Uint8Array): Uint8Array {
  const length = data.byteLength;
  if (length > 65535) {
    throw new Error(`Message too large: ${length} bytes (max 65535)`);
  }

  const framed = new Uint8Array(2 + length);
  framed[0] = (length >> 8) & 0xff;
  framed[1] = length & 0xff;
  framed.set(data, 2);

  return framed;
}

/**
 * Read framed messages from a buffer.
 * Returns [completeMessages, remainingBuffer]
 */
export function readFramedMessages(
  buffer: Uint8Array
): [Uint8Array[], Uint8Array] {
  const messages: Uint8Array[] = [];
  let offset = 0;

  while (offset + 2 <= buffer.byteLength) {
    const length = (buffer[offset] << 8) | buffer[offset + 1];

    if (offset + 2 + length > buffer.byteLength) {
      // Incomplete message, return remaining buffer
      break;
    }

    const message = buffer.slice(offset + 2, offset + 2 + length);
    messages.push(message);
    offset += 2 + length;
  }

  const remaining = buffer.slice(offset);
  return [messages, remaining];
}

/**
 * Create a sync step 1 message (request state vector)
 */
export function encodeSyncStep1(stateVector: Uint8Array): Uint8Array {
  const msg = new Uint8Array(1 + stateVector.byteLength);
  msg[0] = 0x00; // MSG_SYNC_STEP1
  msg.set(stateVector, 1);
  return msg;
}

/**
 * Create a sync step 2 message (send missing updates)
 */
export function encodeSyncStep2(update: Uint8Array): Uint8Array {
  const msg = new Uint8Array(1 + update.byteLength);
  msg[0] = 0x01; // MSG_SYNC_STEP2
  msg.set(update, 1);
  return msg;
}

/**
 * Create an update message
 */
export function encodeUpdate(update: Uint8Array): Uint8Array {
  const msg = new Uint8Array(1 + update.byteLength);
  msg[0] = 0x02; // MSG_UPDATE
  msg.set(update, 1);
  return msg;
}

/**
 * Create an awareness message for stream transport
 */
export function encodeAwarenessMessage(awarenessUpdate: Uint8Array): Uint8Array {
  const msg = new Uint8Array(1 + awarenessUpdate.byteLength);
  msg[0] = 0x03; // MSG_AWARENESS
  msg.set(awarenessUpdate, 1);
  return msg;
}

/**
 * Encode awareness state for datagram transport.
 * Format: [clientId:4 bytes][clock:4 bytes][state:variable]
 */
export function encodeAwarenessDatagram(
  clientId: number,
  clock: number,
  state: Uint8Array
): Uint8Array {
  const datagram = new Uint8Array(8 + state.byteLength);
  const view = new DataView(datagram.buffer);

  view.setUint32(0, clientId, false); // big-endian
  view.setUint32(4, clock, false); // big-endian
  datagram.set(state, 8);

  return datagram;
}

/**
 * Decode awareness datagram
 */
export function decodeAwarenessDatagram(
  data: Uint8Array
): { clientId: number; clock: number; state: Uint8Array } {
  if (data.byteLength < 8) {
    throw new Error('Invalid awareness datagram: too short');
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const clientId = view.getUint32(0, false);
  const clock = view.getUint32(4, false);
  const state = data.slice(8);

  return { clientId, clock, state };
}

/**
 * Simple MessagePack-like encoding for awareness state.
 * This is a simplified version - consider using a proper msgpack library for production.
 */
export function encodeState(state: Record<string, unknown>): Uint8Array {
  const json = JSON.stringify(state);
  return new TextEncoder().encode(json);
}

/**
 * Decode state from bytes
 */
export function decodeState(data: Uint8Array): Record<string, unknown> {
  const json = new TextDecoder().decode(data);
  return JSON.parse(json);
}

