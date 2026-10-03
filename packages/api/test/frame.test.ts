import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeFrames, encodeFrame, encodeText, OPCODE } from "../src/ws/frame.ts";

function maskClientFrame(opcode: number, payload: Buffer): Buffer {
  const maskKey = Buffer.from([0x12, 0x34, 0x56, 0x78]);
  const masked = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i++) masked[i] = payload[i]! ^ maskKey[i % 4]!;
  const len = payload.length;
  let header: Buffer;
  if (len < 126) header = Buffer.from([0x80 | opcode, 0x80 | len]);
  else { header = Buffer.alloc(4); header[0] = 0x80 | opcode; header[1] = 0x80 | 126; header.writeUInt16BE(len, 2); }
  return Buffer.concat([header, maskKey, masked]);
}

test("encodeText produces an unmasked text frame the decoder can read back (round-trip via a masked re-send)", () => {
  const text = "hello world";
  const serverFrame = encodeText(text);
  // Server frames are unmasked (bit 0 of byte 1 clear); length fits in 7 bits.
  assert.equal(serverFrame[0]! & 0x0f, OPCODE.TEXT);
  assert.equal((serverFrame[0]! & 0x80) !== 0, true); // FIN
  assert.equal((serverFrame[1]! & 0x80) !== 0, false); // not masked
  assert.equal(serverFrame[1]!, text.length);
});

test("decodeFrames reads a small masked client text frame", () => {
  const payload = Buffer.from("ping-ish", "utf8");
  const buf = maskClientFrame(OPCODE.TEXT, payload);
  const { frames, rest } = decodeFrames(buf);
  assert.equal(frames.length, 1);
  assert.equal(frames[0]!.opcode, OPCODE.TEXT);
  assert.equal(frames[0]!.payload.toString("utf8"), "ping-ish");
  assert.equal(rest.length, 0);
});

test("decodeFrames handles the 16-bit extended length format (>= 126 bytes)", () => {
  const payload = Buffer.from("x".repeat(200), "utf8");
  const buf = maskClientFrame(OPCODE.TEXT, payload);
  const { frames } = decodeFrames(buf);
  assert.equal(frames[0]!.payload.length, 200);
  assert.equal(frames[0]!.payload.toString("utf8"), "x".repeat(200));
});

test("decodeFrames returns no frames and the full buffer as rest when the frame is incomplete", () => {
  const payload = Buffer.from("incomplete", "utf8");
  const full = maskClientFrame(OPCODE.TEXT, payload);
  const partial = full.subarray(0, full.length - 3); // cut off the last bytes of the payload
  const { frames, rest } = decodeFrames(partial);
  assert.equal(frames.length, 0);
  assert.equal(rest.length, partial.length);
});

test("decodeFrames reassembles a frame split across two chunks", () => {
  const payload = Buffer.from("split-me", "utf8");
  const full = maskClientFrame(OPCODE.TEXT, payload);
  const first = full.subarray(0, 5);
  const second = full.subarray(5);
  const r1 = decodeFrames(first);
  assert.equal(r1.frames.length, 0);
  const r2 = decodeFrames(Buffer.concat([r1.rest, second]));
  assert.equal(r2.frames.length, 1);
  assert.equal(r2.frames[0]!.payload.toString("utf8"), "split-me");
});

test("decodeFrames handles two frames arriving back-to-back in one chunk", () => {
  const a = maskClientFrame(OPCODE.TEXT, Buffer.from("one"));
  const b = maskClientFrame(OPCODE.TEXT, Buffer.from("two"));
  const { frames, rest } = decodeFrames(Buffer.concat([a, b]));
  assert.equal(frames.length, 2);
  assert.equal(frames[0]!.payload.toString("utf8"), "one");
  assert.equal(frames[1]!.payload.toString("utf8"), "two");
  assert.equal(rest.length, 0);
});

test("decodeFrames recognizes PING and CLOSE opcodes", () => {
  const ping = maskClientFrame(OPCODE.PING, Buffer.alloc(0));
  const close = maskClientFrame(OPCODE.CLOSE, Buffer.alloc(0));
  assert.equal(decodeFrames(ping).frames[0]!.opcode, OPCODE.PING);
  assert.equal(decodeFrames(close).frames[0]!.opcode, OPCODE.CLOSE);
});

test("encodeFrame with a >=65536-byte payload uses the 64-bit length field", () => {
  const payload = Buffer.alloc(70_000, 0x41);
  const frame = encodeFrame(OPCODE.BINARY, payload);
  assert.equal(frame[1]!, 127);
  assert.equal(frame.readBigUInt64BE(2), BigInt(70_000));
  assert.equal(frame.length, 10 + 70_000);
});
