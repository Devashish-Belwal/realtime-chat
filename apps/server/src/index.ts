import http from "node:http";

import app from "./app";
import { env } from "./config/env";
import { createWebSocketServer } from "./websocket/websocket.server";

const server = http.createServer(app);
const wss = createWebSocketServer(server);

function shutdown() {
  console.log("Shutting down server gracefully...");
  wss.clients.forEach((client) => {
    client.close();
  });
  server.close(() => {
    console.log("Server closed.");
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 2000);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

server.listen(env.PORT, () => {
  console.log(`Server running on http://localhost:${env.PORT}`);
});
