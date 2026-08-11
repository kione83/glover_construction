import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { WebSocketServer, WebSocket } from "ws";

const directory = dirname(fileURLToPath(import.meta.url));
const viewerHtml = await readFile(join(directory, "live-viewer.html"));
const rooms = new Map();

const server = createServer((request, response) => {
  if (request.url?.startsWith("/health")) {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
    return;
  }
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(viewerHtml);
});

const webSocketServer = new WebSocketServer({ server, path: "/signal" });

webSocketServer.on("connection", (socket) => {
  let membership;
  socket.on("message", (rawMessage) => {
    let message;
    try { message = JSON.parse(rawMessage.toString()); } catch { return; }
    if (message.type === "join") {
      if (!isRole(message.role) || typeof message.room !== "string" || !message.room.trim()) return;
      membership = { room: message.room.trim(), role: message.role };
      const room = rooms.get(membership.room) ?? {};
      if (room[membership.role] && room[membership.role] !== socket) room[membership.role].close(4000, "Replaced by a newer connection");
      room[membership.role] = socket;
      rooms.set(membership.room, room);
      if (
        room.publisher?.readyState === WebSocket.OPEN
        && room.viewer?.readyState === WebSocket.OPEN
      ) {
        room.publisher.send(JSON.stringify({ type: "viewer-ready" }));
      }
      socket.send(JSON.stringify({ type: "joined", room: membership.room, role: membership.role }));
      return;
    }
    if (!membership) return;
    const peer = rooms.get(membership.room)?.[membership.role === "publisher" ? "viewer" : "publisher"];
    if (peer?.readyState === WebSocket.OPEN) peer.send(JSON.stringify(message));
  });
  socket.on("close", () => {
    if (!membership) return;
    const room = rooms.get(membership.room);
    if (room?.[membership.role] === socket) delete room[membership.role];
    if (room && !room.publisher && !room.viewer) rooms.delete(membership.room);
  });
});

function isRole(value) { return value === "publisher" || value === "viewer"; }

const port = Number(process.env.PORT ?? 8080);
server.listen(port, "0.0.0.0", () => console.log(`Live viewer: http://localhost:${port}?room=construction-demo`));
