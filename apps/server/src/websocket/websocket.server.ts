import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "node:http";
import { connectionManager } from "./connection.manager";
import type { ConnectedUser } from "../types/user";
import type { PrivateMessage, ServerMessage } from "./types";
import { randomUUID } from "node:crypto";
import { createDefaultRooms, getRoom, getAllRooms, createRoom } from "./rooms";
import type { ClientMessage } from "./types";

function isString(v: unknown): v is string {
  return typeof v === "string";
}

function isClientMessage(v: unknown): v is ClientMessage {
  if (typeof v !== "object" || v === null) return false;
  const obj = v as Record<string, unknown>;
  if (!("type" in obj) || !isString(obj.type)) return false;
  switch (obj.type) {
    case "join":
      return isString(obj.username);
    case "chat":
      return isString(obj.content);
    case "private_message":
      return isString(obj.toUserId) && isString(obj.content);
    case "typing":
      return true;
    case "stop_typing":
      return true;
    case "private_typing":
      return isString(obj.toUserId);
    case "private_stop_typing":
      return isString(obj.toUserId);
    case "join_room":
      return isString(obj.roomId);
    case "create_room":
      return isString(obj.name);
    case "leave_room":
      return true;
    default:
      return false;
  }
}

export function createWebSocketServer(server: Server) {
  createDefaultRooms();
  const wss = new WebSocketServer({ server });

  const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((socket) => {
      const s = socket as WebSocket & {
        isAlive?: boolean;
        cleanedUp?: boolean;
      };
      if (s.isAlive === false) {
        if (!s.cleanedUp) {
          s.cleanedUp = true;
          const user = connectionManager
            .getAll()
            .find((u) => u.socket === socket);
          if (user) {
            const roomId = user.roomId;
            wss.clients.forEach((client) => {
              if (client.readyState === client.OPEN && client !== socket) {
                const clientUser = connectionManager
                  .getAll()
                  .find((u) => u.socket === client);
                if (clientUser && clientUser.roomId === roomId) {
                  const leftMsg: ServerMessage = {
                    type: "user_left",
                    user: { id: user.id, username: user.username },
                    roomId: roomId,
                  };
                  client.send(JSON.stringify(leftMsg));
                }
              }
            });
            connectionManager.remove(user.id);
            const usersPayload: ServerMessage = {
              type: "users",
              users: connectionManager
                .getUsersInRoom(roomId)
                .map((u) => ({ id: u.id, username: u.username })),
            };
            connectionManager.broadcastToRoom(roomId, usersPayload);
          }
        }
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
        const errMsg: ServerMessage = {
          type: "error",
          message: "Invalid JSON",
        };
        socket.send(JSON.stringify(errMsg));
        return;
      }

      if (isClientMessage(parsed) && parsed.type === "join") {
        const username =
          typeof parsed.username === "string" ? parsed.username.trim() : "";
        if (!username || username.length > 50) {
          const errMsg: ServerMessage = {
            type: "error",
            message: "Username must be between 1 and 50 characters",
          };
          socket.send(JSON.stringify(errMsg));
          return;
        }

        const existingUser = connectionManager
          .getAll()
          .find((u) => u.socket === socket);
        if (existingUser) {
          const errMsg: ServerMessage = {
            type: "error",
            message: "Already joined",
          };
          socket.send(JSON.stringify(errMsg));
          return;
        }

        const taken = connectionManager
          .getAll()
          .some((u) => u.username.toLowerCase() === username.toLowerCase());
        if (taken) {
          const errMsg: ServerMessage = {
            type: "error",
            message: "Username already taken",
          };
          socket.send(JSON.stringify(errMsg));
          return;
        }

        const userId = randomUUID();
        const user: ConnectedUser = {
          id: userId,
          username,
          socket,
          roomId: "general",
        };
        connectionManager.add(user);

        const welcomeMsg: ServerMessage = { type: "welcome", userId, username };
        socket.send(JSON.stringify(welcomeMsg));

        const usersPayload: ServerMessage = {
          type: "users",
          users: connectionManager
            .getUsersInRoom("general")
            .map((u) => ({ id: u.id, username: u.username })),
        };
        connectionManager.broadcastToRoom("general", usersPayload);

        const roomsPayload: ServerMessage = {
          type: "rooms",
          rooms: getAllRooms(),
        };
        socket.send(JSON.stringify(roomsPayload));

        const roomJoinedMsg: ServerMessage = {
          type: "room_joined",
          room: { id: "general", name: "General" },
        };
        socket.send(JSON.stringify(roomJoinedMsg));
        return;
      }

      if (isClientMessage(parsed) && parsed.type === "chat") {
        const user = connectionManager
          .getAll()
          .find((u) => u.socket === socket);
        if (!user) {
          const errMsg: ServerMessage = {
            type: "error",
            message: "Not joined",
          };
          socket.send(JSON.stringify(errMsg));
          return;
        }
        const content =
          typeof parsed.content === "string" ? parsed.content.trim() : "";
        if (!content || content.length > 2000) {
          const errMsg: ServerMessage = {
            type: "error",
            message: "Message must be between 1 and 2000 characters",
          };
          socket.send(JSON.stringify(errMsg));
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
          connectionManager.sendTo(roomUser.id, {
            type: "chat",
            message: chatMsg,
          });
        });
        return;
      }

      if (isClientMessage(parsed) && parsed.type === "typing") {
        const user = connectionManager
          .getAll()
          .find((u) => u.socket === socket);
        if (user) {
          const roomUsers = connectionManager.getUsersInRoom(user.roomId);
          roomUsers.forEach((roomUser) => {
            if (
              roomUser.id !== user.id &&
              roomUser.socket.readyState === roomUser.socket.OPEN
            ) {
              const typingMsg: ServerMessage = {
                type: "user_typing",
                user: { id: user.id, username: user.username },
              };
              roomUser.socket.send(JSON.stringify(typingMsg));
            }
          });
        }
        return;
      }

      if (isClientMessage(parsed) && parsed.type === "stop_typing") {
        const user = connectionManager
          .getAll()
          .find((u) => u.socket === socket);
        if (user) {
          const roomUsers = connectionManager.getUsersInRoom(user.roomId);
          roomUsers.forEach((roomUser) => {
            if (
              roomUser.id !== user.id &&
              roomUser.socket.readyState === roomUser.socket.OPEN
            ) {
              const stoppedMsg: ServerMessage = {
                type: "user_stopped_typing",
                user: { id: user.id, username: user.username },
              };
              roomUser.socket.send(JSON.stringify(stoppedMsg));
            }
          });
        }
        return;
      }

      if (isClientMessage(parsed) && parsed.type === "private_message") {
        const user = connectionManager
          .getAll()
          .find((u) => u.socket === socket);
        if (!user) {
          const errMsg: ServerMessage = {
            type: "error",
            message: "Not joined",
          };
          socket.send(JSON.stringify(errMsg));
          return;
        }
        const recipient = connectionManager.get(parsed.toUserId);
        const content =
          typeof parsed.content === "string" ? parsed.content.trim() : "";
        if (!content || content.length > 2000) {
          const errMsg: ServerMessage = {
            type: "error",
            message: "Message must be between 1 and 2000 characters",
          };
          socket.send(JSON.stringify(errMsg));
          return;
        }
        if (parsed.toUserId === user.id) {
          const errMsg: ServerMessage = {
            type: "error",
            message: "Cannot send a private message to yourself",
          };
          socket.send(JSON.stringify(errMsg));
          return;
        }
        if (
          !recipient ||
          recipient.socket.readyState !== recipient.socket.OPEN
        ) {
          const errMsg: ServerMessage = {
            type: "error",
            message: "Recipient not found or not connected",
          };
          socket.send(JSON.stringify(errMsg));
          return;
        }
        const pm: PrivateMessage = {
          id: randomUUID(),
          userId: user.id,
          username: user.username,
          recipientUserId: parsed.toUserId,
          content,
          timestamp: new Date().toISOString(),
        };
        const serverMsg: ServerMessage = {
          type: "private_message",
          message: pm,
        };
        socket.send(JSON.stringify(serverMsg));
        connectionManager.sendTo(parsed.toUserId, serverMsg);
        return;
      }

      // recipient = parsed.toUserId; sends private_user_typing to recipient with user=id (sender)
      if (isClientMessage(parsed) && parsed.type === "private_typing") {
        const user = connectionManager
          .getAll()
          .find((u) => u.socket === socket);
        if (user) {
          const recipient = connectionManager.get(parsed.toUserId);
          if (
            recipient &&
            recipient.socket.readyState === recipient.socket.OPEN &&
            parsed.toUserId !== user.id
          ) {
            // conversationWithUserId = sender.id; recipient uses it as conversation counterpart key
            const privateTypingMsg: ServerMessage = {
              type: "private_user_typing",
              user: { id: user.id, username: user.username },
              conversationWithUserId: user.id,
            };
            recipient.socket.send(JSON.stringify(privateTypingMsg));
          }
        }
        return;
      }

      // recipient = parsed.toUserId; sends private_user_stopped_typing to recipient with user=id (sender)
      if (isClientMessage(parsed) && parsed.type === "private_stop_typing") {
        const user = connectionManager
          .getAll()
          .find((u) => u.socket === socket);
        if (user) {
          const recipient = connectionManager.get(parsed.toUserId);
          if (
            recipient &&
            recipient.socket.readyState === recipient.socket.OPEN &&
            parsed.toUserId !== user.id
          ) {
            // conversationWithUserId = sender.id; recipient uses it as conversation counterpart key
            const privateStoppedMsg: ServerMessage = {
              type: "private_user_stopped_typing",
              user: { id: user.id, username: user.username },
              conversationWithUserId: user.id,
            };
            recipient.socket.send(JSON.stringify(privateStoppedMsg));
          }
        }
        return;
      }

      if (isClientMessage(parsed) && parsed.type === "join_room") {
        const user = connectionManager
          .getAll()
          .find((u) => u.socket === socket);
        if (!user) {
          const errMsg: ServerMessage = {
            type: "error",
            message: "Not joined",
          };
          socket.send(JSON.stringify(errMsg));
          return;
        }
        const roomId =
          typeof parsed.roomId === "string" ? parsed.roomId.trim() : "";
        const room = getRoom(roomId);
        if (!room) {
          const errMsg: ServerMessage = {
            type: "error",
            message: "Room not found",
          };
          socket.send(JSON.stringify(errMsg));
          return;
        }
        if (user.roomId === roomId) {
          const roomJoinedMsg: ServerMessage = {
            type: "room_joined",
            room: { id: room.id, name: room.name },
          };
          socket.send(JSON.stringify(roomJoinedMsg));
          return;
        }
        const oldRoomId = user.roomId;
        // Old room: remove, notify, update
        const oldRoomUsers = connectionManager.getUsersInRoom(oldRoomId);
        oldRoomUsers.forEach((ru) => {
          if (ru.id !== user.id && ru.socket.readyState === ru.socket.OPEN) {
            const leftMsgRu: ServerMessage = {
              type: "user_left",
              user: { id: user.id, username: user.username },
              roomId: oldRoomId,
            };
            ru.socket.send(JSON.stringify(leftMsgRu));
          }
        });
        user.roomId = roomId;
        const oldUsersPayload: ServerMessage = {
          type: "users",
          users: connectionManager
            .getUsersInRoom(oldRoomId)
            .map((u) => ({ id: u.id, username: u.username })),
        };
        connectionManager.broadcastToRoom(oldRoomId, oldUsersPayload);
        // New room: add (already set), notify, update
        const newRoomUsers = connectionManager.getUsersInRoom(roomId);
        newRoomUsers.forEach((ru) => {
          if (ru.id !== user.id && ru.socket.readyState === ru.socket.OPEN) {
            const joinedMsgRu: ServerMessage = {
              type: "user_joined",
              user: { id: user.id, username: user.username },
              roomId: roomId,
            };
            ru.socket.send(JSON.stringify(joinedMsgRu));
          }
        });
        const usersPayload: ServerMessage = {
          type: "users",
          users: connectionManager
            .getUsersInRoom(roomId)
            .map((u) => ({ id: u.id, username: u.username })),
        };
        connectionManager.broadcastToRoom(roomId, usersPayload);
        const roomJoinedMsg: ServerMessage = {
          type: "room_joined",
          room: { id: room.id, name: room.name },
        };
        socket.send(JSON.stringify(roomJoinedMsg));
        socket.send(JSON.stringify(usersPayload));
        return;
      }

      if (isClientMessage(parsed) && parsed.type === "create_room") {
        const user = connectionManager
          .getAll()
          .find((u) => u.socket === socket);
        if (!user) {
          const errMsg: ServerMessage = {
            type: "error",
            message: "Not joined",
          };
          socket.send(JSON.stringify(errMsg));
          return;
        }
        const name = typeof parsed.name === "string" ? parsed.name.trim() : "";
        if (!name || name.length > 100) {
          const errMsg: ServerMessage = {
            type: "error",
            message: "Room name cannot be empty",
          };
          socket.send(JSON.stringify(errMsg));
          return;
        }
        const created = createRoom(name);
        if (!created) {
          const errMsg: ServerMessage = {
            type: "error",
            message: "Room already exists",
          };
          socket.send(JSON.stringify(errMsg));
          return;
        }
        const idNormalized = name.toLowerCase().replace(/\s+/g, "-");
        const newRoom = getRoom(idNormalized)!;
        const createdMsg: ServerMessage = {
          type: "room_created",
          room: { id: newRoom.id, name: newRoom.name },
        };
        const roomsPayload: ServerMessage = {
          type: "rooms",
          rooms: getAllRooms(),
        };
        connectionManager.getAll().forEach((user) => {
          user.socket.send(JSON.stringify(createdMsg));
          user.socket.send(JSON.stringify(roomsPayload));
        });
        return;
      }

      if (isClientMessage(parsed) && parsed.type === "leave_room") {
        const user = connectionManager
          .getAll()
          .find((u) => u.socket === socket);
        if (!user) {
          const errMsg: ServerMessage = {
            type: "error",
            message: "Not joined",
          };
          socket.send(JSON.stringify(errMsg));
          return;
        }
        if (user.roomId !== "general") {
          const oldRoomUsers = connectionManager.getUsersInRoom(user.roomId);
          const oldRoomLeaveId = user.roomId;
          oldRoomUsers.forEach((ru) => {
            if (ru.id !== user.id && ru.socket.readyState === ru.socket.OPEN) {
              const leftMsgRu: ServerMessage = {
                type: "user_left",
                user: { id: user.id, username: user.username },
                roomId: oldRoomLeaveId,
              };
              ru.socket.send(JSON.stringify(leftMsgRu));
            }
          });
          user.roomId = "general";
          const generalUsers = connectionManager.getUsersInRoom("general");
          generalUsers.forEach((ru) => {
            if (ru.id !== user.id && ru.socket.readyState === ru.socket.OPEN) {
              const joinedMsgRu: ServerMessage = {
                type: "user_joined",
                user: { id: user.id, username: user.username },
                roomId: "general",
              };
              ru.socket.send(JSON.stringify(joinedMsgRu));
            }
          });
          const roomJoinedMsg: ServerMessage = {
            type: "room_joined",
            room: { id: "general", name: "General" },
          };
          socket.send(JSON.stringify(roomJoinedMsg));
          const usersPayload: ServerMessage = {
            type: "users",
            users: connectionManager
              .getUsersInRoom("general")
              .map((u) => ({ id: u.id, username: u.username })),
          };
          connectionManager.broadcastToRoom("general", usersPayload);
          socket.send(JSON.stringify(usersPayload));
          const oldUsersPayload: ServerMessage = {
            type: "users",
            users: connectionManager
              .getUsersInRoom(oldRoomLeaveId)
              .map((u) => ({ id: u.id, username: u.username })),
          };
          connectionManager.broadcastToRoom(oldRoomLeaveId, oldUsersPayload);
        }
        return;
      }

      const errMsg: ServerMessage = {
        type: "error",
        message: "Unknown message type",
      };
      socket.send(JSON.stringify(errMsg));
    });

    socket.on("close", () => {
      console.log("WebSocket client disconnected");
      const s = socket as WebSocket & { cleanedUp?: boolean };
      if (!s.cleanedUp) {
        s.cleanedUp = true;
        const user = connectionManager
          .getAll()
          .find((u) => u.socket === socket);
        if (user) {
          const roomId = user.roomId;
          wss.clients.forEach((client) => {
            if (client.readyState === client.OPEN && client !== socket) {
              const clientUser = connectionManager
                .getAll()
                .find((u) => u.socket === client);
              if (clientUser && clientUser.roomId === roomId) {
                const leftMsg: ServerMessage = {
                  type: "user_left",
                  user: { id: user.id, username: user.username },
                  roomId: roomId,
                };
                client.send(JSON.stringify(leftMsg));
              }
            }
          });
          connectionManager.remove(user.id);
          const usersPayload: ServerMessage = {
            type: "users",
            users: connectionManager
              .getUsersInRoom(roomId)
              .map((u) => ({ id: u.id, username: u.username })),
          };
          connectionManager.broadcastToRoom(roomId, usersPayload);
        }
      }
    });
  });

  return wss;
}
