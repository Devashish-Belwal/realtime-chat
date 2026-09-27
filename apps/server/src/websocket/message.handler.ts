import type { WebSocket } from "ws";
import type { ServerMessage } from "./types";

export function handleMessage(
  _socket: WebSocket,
  _rawMessage: string,
  _userId: string
): ServerMessage | null {
  // Stub for future message handling (join/chat).
  return null;
}