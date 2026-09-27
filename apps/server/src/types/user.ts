import type { WebSocket } from "ws";

export interface ConnectedUser {
  id: string;
  username: string;
  socket: WebSocket;
  roomId: string;
}
