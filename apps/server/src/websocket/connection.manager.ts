import type { ServerMessage } from "./types";
import type { ConnectedUser } from "../types/user";

export class ConnectionManager {
  private users = new Map<string, ConnectedUser>();

  add(user: ConnectedUser): void {
    this.users.set(user.id, user);
  }

  remove(userId: string): void {
    this.users.delete(userId);
  }

  get(userId: string): ConnectedUser | undefined {
    return this.users.get(userId);
  }

  getAll(): ConnectedUser[] {
    return Array.from(this.users.values());
  }

  broadcastToRoom(roomId: string, message: ServerMessage): void {
    this.getUsersInRoom(roomId).forEach((user) => this.sendTo(user.id, message));
  }

  getUsersInRoom(roomId: string): ConnectedUser[] {
    return this.getAll().filter((u) => u.roomId === roomId);
  }

  getCount(): number {
    return this.users.size;
  }

  broadcast(message: ServerMessage): void {
    this.users.forEach((user) => this.sendTo(user.id, message));
  }

  sendTo(userId: string, message: ServerMessage): void {
    const user = this.get(userId);
    if (user && user.socket.readyState === user.socket.OPEN) {
      user.socket.send(JSON.stringify(message));
    }
  }
}

export const connectionManager = new ConnectionManager();
