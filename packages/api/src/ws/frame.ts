/**
 * Minimal RFC 6455 frame codec — just enough to run a server that pushes JSON
 * text frames to connected clients and answers pings, without depending on the
 * `ws` package (no npm registry access in this environment). Single-frame
 * messages only (no continuation handling): every message we send or expect to
 * receive here is a small JSON control message, well under one frame.
 */

export const OPCODE = { CONTINUATION: 0x0, TEXT: 0x1, BINARY: 0x2, CLOSE: 0x8, PING: 0x9, PONG: 0xa } as const;

/** Server -> client frames are never masked (masking is a client-to-server-only requirement). */
export function encodeFrame(opcode: number, payload: Buffer): Buffer {
  const len = payload.length;
  let header: Buffer;
  if (len < 126) {
    header = Buffer.from([0x80 | opcode, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

export function encodeText(text: string): Buffer {
  return encodeFrame(OPCODE.TEXT, Buffer.from(text, "utf8"));
}

export interface DecodedFrame {
  opcode: number;
  payload: Buffer;
  fin: boolean;
}

/**
 * Pulls complete frames out of `buf` (client -> server, so always masked per
 * spec). Returns the frames found and the unconsumed remainder, so the caller
 * can keep appending to it as more data arrives over the socket.
 */
export function decodeFrames(buf: Buffer): { frames: DecodedFrame[]; rest: Buffer } {
  const frames: DecodedFrame[] = [];
  let offset = 0;
  while (true) {
    if (buf.length - offset < 2) break;
    const b0 = buf[offset]!, b1 = buf[offset + 1]!;
    const fin = (b0 & 0x80) !== 0;
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f;
    let pos = offset + 2;

    if (len === 126) {
      if (buf.length - pos < 2) break;
      len = buf.readUInt16BE(pos);
      pos += 2;
    } else if (len === 127) {
      if (buf.length - pos < 8) break;
      const big = buf.readBigUInt64BE(pos);
      if (big > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("frame too large");
      len = Number(big);
      pos += 8;
    }

    let maskKey: Buffer | null = null;
    if (masked) {
      if (buf.length - pos < 4) break;
      maskKey = buf.subarray(pos, pos + 4);
      pos += 4;
    }
    if (buf.length - pos < len) break;

    let payload = buf.subarray(pos, pos + len);
    if (maskKey) {
      const unmasked = Buffer.alloc(len);
      for (let i = 0; i < len; i++) unmasked[i] = payload[i]! ^ maskKey[i % 4]!;
      payload = unmasked;
    }
    frames.push({ opcode, payload: Buffer.from(payload), fin });
    offset = pos + len;
  }
  return { frames, rest: buf.subarray(offset) };
}
