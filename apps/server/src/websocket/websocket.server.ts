import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "node:http";
import { connectionManager } from "./connection.manager";
import type { ConnectedUser } from "../types/user";
import type { PrivateMessage, ServerMessage } from "./types";
import { randomUUID } from "node:crypto";
import { createDefaultRooms, getRoom, getAllRooms, createRoom } from "./rooms";

export function createWebSocketServer(server: Server) {
  createDefaultRooms();
  const wss = new WebSocketServer({ server });

  const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((socket) => {
      const s = socket as WebSocket & { isAlive?: boolean };
      if (s.isAlive === false) {
        s.terminate();
        return;
      }
      s.isAlive = false;
      s.ping();
    });
  }, 30000);

  wss.on("close", () => {
    clearInterval(heartbeatInterval);
  });

  wss.on("connection", (socket: WebSocket) => {
    console.log("WebSocket client connected");
    (socket as WebSocket & { isAlive?: boolean }).isAlive = true;

    socket.on("pong", () => {
      (socket as WebSocket & { isAlive?: boolean }).isAlive = true;
    });

    socket.on("message", (data: Buffer | ArrayBuffer | Buffer[]) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(data.toString());
      } catch {
        parsed = null;
      }

      if (parsed && typeof parsed === "object" && parsed !== null && (parsed as Record<string, unknown>).type === "join") {
        const msg = parsed as { type: "join"; username?: unknown };
        const username = typeof msg.username === "string" ? msg.username.trim() : "";
        if (!username) {
          socket.send(JSON.stringify({ type: "error", message: "Username required" }));
          return;
        }

        const taken = connectionManager.getAll().some((u) => u.username === username);
        if (taken) {
          socket.send(JSON.stringify({ type: "error", message: "Username already taken" }));
          return;
        }

        const userId = randomUUID();
        const user: ConnectedUser = { id: userId, username, socket, roomId: "general" };
        connectionManager.add(user);

        socket.send(JSON.stringify({ type: "welcome", userId, username }));

        const usersPayload = {
          type: "users" as const,
          users: connectionManager.getUsersInRoom("general").map((u) => ({ id: u.id, username: u.username })),
        };
        connectionManager.broadcastToRoom("general", usersPayload);

        const roomsPayload = {
          type: "rooms" as const,
          rooms: getAllRooms(),
        };
        socket.send(JSON.stringify(roomsPayload));

        socket.send(JSON.stringify({ type: "room_joined", room: { id: "general", name: "General" } }));
        socket.send(JSON.stringify(usersPayload));

        connectionManager.getUsersInRoom("general").forEach((ru) => {
          if (ru.id !== userId && ru.socket.readyState === ru.socket.OPEN) {
            ru.socket.send(JSON.stringify({ type: "user_joined", user: { id: userId, username }, roomId: "general" }));
          }
        });
        return;
      }

      if (parsed && typeof parsed === "object" && parsed !== null && (parsed as Record<string, unknown>).type === "chat") {
        const msg = parsed as { type: "chat"; content?: unknown };
        const user = connectionManager.getAll().find((u) => u.socket === socket);
        if (!user) {
          socket.send(JSON.stringify({ type: "error", message: "Not joined" }));
          return;
        }
        const content = typeof msg.content === "string" ? msg.content.trim() : "";
        if (!content) {
          socket.send(JSON.stringify({ type: "error", message: "Message cannot be empty" }));
          return;
        }
        const chatMsg = {
          id: randomUUID(),
          userId: user.id,
          username: user.username,
          content,
          timestamp: new Date().toISOString(),
          roomId: user.roomId,
        };
        const roomUsers = connectionManager.getUsersInRoom(user.roomId);
        roomUsers.forEach((roomUser) => {
          connectionManager.sendTo(roomUser.id, { type: "chat", message: chatMsg } as ServerMessage);
        });
        return;
      }

      if (parsed && typeof parsed === "object" && parsed !== null && (parsed as Record<string, unknown>).type === "typing") {
        const user = connectionManager.getAll().find((u) => u.socket === socket);
        if (user) {
          const roomUsers = connectionManager.getUsersInRoom(user.roomId);
          roomUsers.forEach((roomUser) => {
            if (roomUser.id !== user.id && roomUser.socket.readyState === roomUser.socket.OPEN) {
              roomUser.socket.send(JSON.stringify({ type: "user_typing", user: { id: user.id, username: user.username } }));
            }
          });
        }
        return;
      }

      if (parsed && typeof parsed === "object" && parsed !== null && (parsed as Record<string, unknown>).type === "stop_typing") {
        const user = connectionManager.getAll().find((u) => u.socket === socket);
        if (user) {
          const roomUsers = connectionManager.getUsersInRoom(user.roomId);
          roomUsers.forEach((roomUser) => {
            if (roomUser.id !== user.id && roomUser.socket.readyState === roomUser.socket.OPEN) {
              roomUser.socket.send(JSON.stringify({ type: "user_stopped_typing", user: { id: user.id, username: user.username } }));
            }
          });
        }
        return;
      }

      if (parsed && typeof parsed === "object" && parsed !== null && (parsed as Record<string, unknown>).type === "private_message") {
        const msg = parsed as { type: "private_message"; toUserId?: unknown; content?: unknown };
        const user = connectionManager.getAll().find((u) => u.socket === socket);
        if (!user) {
          socket.send(JSON.stringify({ type: "error", message: "Not joined" }));
          return;
        }
        const recipient = connectionManager.get(msg.toUserId as string);
        const content = typeof msg.content === "string" ? msg.content.trim() : "";
        if (!content) {
          socket.send(JSON.stringify({ type: "error", message: "Message cannot be empty" }));
          return;
        }
        if (msg.toUserId === user.id) {
          socket.send(JSON.stringify({ type: "error", message: "Cannot send a private message to yourself" }));
          return;
        }
        if (!recipient || recipient.socket.readyState !== recipient.socket.OPEN) {
          socket.send(JSON.stringify({ type: "error", message: "Recipient not found or not connected" }));
          return;
        }
        const pm: PrivateMessage = {
          id: randomUUID(),
          userId: user.id,
          username: user.username,
          recipientUserId: msg.toUserId as string,
          content,
          timestamp: new Date().toISOString(),
        };
        const serverMsg: ServerMessage = { type: "private_message", message: pm };
        socket.send(JSON.stringify(serverMsg));
        connectionManager.sendTo(msg.toUserId as string, serverMsg);
        return;
      }

      if (parsed && typeof parsed === "object" && parsed !== null && (parsed as Record<string, unknown>).type === "private_typing") {
        const msg = parsed as { type: "private_typing"; toUserId?: unknown };
        const user = connectionManager.getAll().find((u) => u.socket === socket);
        if (user) {
          const recipient = connectionManager.get(msg.toUserId as string);
          if (recipient && recipient.socket.readyState === recipient.socket.OPEN && msg.toUserId !== user.id) {
            recipient.socket.send(JSON.stringify({ type: "private_user_typing", user: { id: user.id, username: user.username }, conversationWithUserId: user.id }));
          }
        }
        return;
      }

      if (parsed && typeof parsed === "object" && parsed !== null && (parsed as Record<string, unknown>).type === "private_stop_typing") {
        const msg = parsed as { type: "private_stop_typing"; toUserId?: unknown };
        const user = connectionManager.getAll().find((u) => u.socket === socket);
        if (user) {
          const recipient = connectionManager.get(msg.toUserId as string);
          if (recipient && recipient.socket.readyState === recipient.socket.OPEN && msg.toUserId !== user.id) {
            recipient.socket.send(JSON.stringify({ type: "private_user_stopped_typing", user: { id: user.id, username: user.username }, conversationWithUserId: user.id }));
          }
        }
        return;
      }

      if (parsed && typeof parsed === "object" && parsed !== null && (parsed as Record<string, unknown>).type === "join_room") {
        const msg = parsed as { type: "join_room"; roomId?: unknown };
        const user = connectionManager.getAll().find((u) => u.socket === socket);
        if (!user) {
          socket.send(JSON.stringify({ type: "error", message: "Not joined" }));
          return;
        }
        const roomId = typeof msg.roomId === "string" ? msg.roomId.trim() : "";
        const room = getRoom(roomId);
        if (!room) {
          socket.send(JSON.stringify({ type: "error", message: "Room not found" }));
          return;
        }
        if (user.roomId === roomId) {
          socket.send(JSON.stringify({ type: "room_joined", room: { id: room.id, name: room.name } }));
          return;
        }
        const oldRoomId = user.roomId;
        // Old room: remove, notify, update
        const oldRoomUsers = connectionManager.getUsersInRoom(oldRoomId);
        oldRoomUsers.forEach((ru) => {
          if (ru.id !== user.id && ru.socket.readyState === ru.socket.OPEN) {
            ru.socket.send(JSON.stringify({ type: "user_left", user: { id: user.id, username: user.username }, roomId: oldRoomId }));
          }
        });
        user.roomId = roomId;
        const oldUsersPayload = { type: "users" as const, users: connectionManager.getUsersInRoom(oldRoomId).map((u) => ({ id: u.id, username: u.username })) };
        connectionManager.broadcastToRoom(oldRoomId, oldUsersPayload);
        // New room: add (already set), notify, update
        const newRoomUsers = connectionManager.getUsersInRoom(roomId);
        newRoomUsers.forEach((ru) => {
          if (ru.id !== user.id && ru.socket.readyState === ru.socket.OPEN) {
            ru.socket.send(JSON.stringify({ type: "user_joined", user: { id: user.id, username: user.username }, roomId: roomId }));
          }
        });
        const usersPayload = { type: "users" as const, users: connectionManager.getUsersInRoom(roomId).map((u) => ({ id: u.id, username: u.username })) };
        connectionManager.broadcastToRoom(roomId, usersPayload);
        socket.send(JSON.stringify({ type: "room_joined", room: { id: room.id, name: room.name } }));
        socket.send(JSON.stringify(usersPayload));
        return;
      }

      if (parsed && typeof parsed === "object" && parsed !== null && (parsed as Record<string, unknown>).type === "create_room") {
        const msg = parsed as { type: "create_room"; name?: unknown };
        const user = connectionManager.getAll().find((u) => u.socket === socket);
        if (!user) {
          socket.send(JSON.stringify({ type: "error", message: "Not joined" }));
          return;
        }
        const name = typeof msg.name === "string" ? msg.name.trim() : "";
        if (!name || name.length > 100) {
          socket.send(JSON.stringify({ type: "error", message: "Room name cannot be empty" }));
          return;
        }
        const idNormalized = name.toLowerCase().replace(/\s+/g, "-");
        const created = createRoom(idNormalized, name);
        if (!created) {
          socket.send(JSON.stringify({ type: "error", message: "Room already exists" }));
          return;
        }
        const newRoom = getRoom(idNormalized)!;
        socket.send(JSON.stringify({ type: "room_created", room: { id: newRoom.id, name: newRoom.name } }));
        const roomsPayload = { type: "rooms" as const, rooms: getAllRooms() };
        connectionManager.getAll().forEach((user) => {
          user.socket.send(JSON.stringify({ type: "room_created", room: { id: newRoom.id, name: newRoom.name } }));
          user.socket.send(JSON.stringify(roomsPayload));
        });
        return;
      }

      if (parsed && typeof parsed === "object" && parsed !== null && (parsed as Record<string, unknown>).type === "leave_room") {
        const user = connectionManager.getAll().find((u) => u.socket === socket);
        if (!user) {
          socket.send(JSON.stringify({ type: "error", message: "Not joined" }));
          return;
        }
        if (user.roomId !== "general") {
          const oldRoomUsers = connectionManager.getUsersInRoom(user.roomId);
          const oldRoomLeaveId = user.roomId;
          oldRoomUsers.forEach((ru) => {
            if (ru.id !== user.id && ru.socket.readyState === ru.socket.OPEN) {
              ru.socket.send(JSON.stringify({ type: "user_left", user: { id: user.id, username: user.username }, roomId: oldRoomLeaveId }));
            }
          });
          user.roomId = "general";
          const generalUsers = connectionManager.getUsersInRoom("general");
          generalUsers.forEach((ru) => {
            if (ru.id !== user.id && ru.socket.readyState === ru.socket.OPEN) {
              ru.socket.send(JSON.stringify({ type: "user_joined", user: { id: user.id, username: user.username }, roomId: "general" }));
            }
          });
          socket.send(JSON.stringify({ type: "room_joined", room: { id: "general", name: "General" } }));
          const usersPayload = { type: "users" as const, users: connectionManager.getUsersInRoom("general").map((u) => ({ id: u.id, username: u.username })) };
          connectionManager.broadcastToRoom("general", usersPayload);
          socket.send(JSON.stringify(usersPayload));
          const oldUsersPayload = { type: "users" as const, users: connectionManager.getUsersInRoom(oldRoomLeaveId).map((u) => ({ id: u.id, username: u.username })) };
          connectionManager.broadcastToRoom(oldRoomLeaveId, oldUsersPayload);
        }
        return;
      }

      // Fallback: ignore unhandled messages
    });

    socket.on("close", () => {
      console.log("WebSocket client disconnected");
      const user = connectionManager.getAll().find((u) => u.socket === socket);
      if (user) {
        const roomId = user.roomId;
        wss.clients.forEach((client) => {
          if (client.readyState === client.OPEN && client !== socket) {
            const clientUser = connectionManager.getAll().find((u) => u.socket === client);
            if (clientUser && clientUser.roomId === roomId) {
              client.send(JSON.stringify({ type: "user_left", user: { id: user.id, username: user.username }, roomId: roomId }));
            }
          }
        });
        connectionManager.remove(user.id);
        const usersPayload = {
          type: "users" as const,
          users: connectionManager.getUsersInRoom(roomId).map((u) => ({ id: u.id, username: u.username })),
        };
        connectionManager.broadcastToRoom(roomId, usersPayload);
      }
    });
  });

  return wss;
}