/**
 * A tiny WebSocket server with no dependency on the `ws` package: handles the
 * RFC 6455 upgrade handshake on a Node http.Server and keeps one "room" of
 * sockets per eventId, so WsEvent broadcasts from the domain layer only reach
 * clients watching that event. Clients connect to `/ws/<eventId>`.
 */
import { createHash, randomUUID } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import type { Socket } from "node:net";
import type { WsEvent } from "../../../shared/src/index.ts";
import { decodeFrames, encodeFrame, encodeText, OPCODE } from "./frame.ts";

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

interface Connection {
  id: string;
  socket: Socket;
  eventId: string;
  buffer: Buffer;
}

export class WsHub {
  private rooms = new Map<string, Map<string, Connection>>();

  attach(server: Server): void {
    server.on("upgrade", (req, socket, head) => this.handleUpgrade(req, socket as Socket, head));
  }

  private handleUpgrade(req: IncomingMessage, socket: Socket, head: Buffer): void {
    const url = new URL(req.url ?? "/", "http://internal");
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length !== 2 || parts[0] !== "ws") {
      socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
      return;
    }
    const eventId = parts[1]!;
    const key = req.headers["sec-websocket-key"];
    if (typeof key !== "string") {
      socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
      return;
    }
    const accept = createHash("sha1").update(key + WS_GUID).digest("base64");
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );

    const conn: Connection = { id: randomUUID(), socket, eventId, buffer: head.length ? Buffer.from(head) : Buffer.alloc(0) };
    this.addToRoom(conn);

    socket.on("data", (chunk: Buffer) => this.onData(conn, chunk));
    socket.on("close", () => this.removeFromRoom(conn));
    socket.on("error", () => this.removeFromRoom(conn));
    if (conn.buffer.length) this.onData(conn, Buffer.alloc(0));
  }

  private onData(conn: Connection, chunk: Buffer): void {
    conn.buffer = chunk.length ? Buffer.concat([conn.buffer, chunk]) : conn.buffer;
    const { frames, rest } = decodeFrames(conn.buffer);
    conn.buffer = rest;
    for (const frame of frames) {
      if (frame.opcode === OPCODE.CLOSE) {
        conn.socket.end(encodeFrame(OPCODE.CLOSE, Buffer.alloc(0)));
        this.removeFromRoom(conn);
      } else if (frame.opcode === OPCODE.PING) {
        conn.socket.write(encodeFrame(OPCODE.PONG, frame.payload));
      }
      // Text/binary frames from the client carry no protocol meaning here (the
      // table/director write paths are all plain HTTP) — received and ignored.
    }
  }

  private addToRoom(conn: Connection): void {
    const room = this.rooms.get(conn.eventId) ?? new Map();
    room.set(conn.id, conn);
    this.rooms.set(conn.eventId, room);
  }

  private removeFromRoom(conn: Connection): void {
    this.rooms.get(conn.eventId)?.delete(conn.id);
  }

  /** Sends `event` to every socket currently watching `eventId`. Dead sockets are dropped silently. */
  broadcast(eventId: string, event: WsEvent): void {
    const room = this.rooms.get(eventId);
    if (!room || room.size === 0) return;
    const frame = encodeText(JSON.stringify(event));
    for (const conn of room.values()) {
      try {
        conn.socket.write(frame);
      } catch {
        this.removeFromRoom(conn);
      }
    }
  }

  /** Number of sockets currently watching an event (test/diagnostic helper). */
  roomSize(eventId: string): number {
    return this.rooms.get(eventId)?.size ?? 0;
  }
}
