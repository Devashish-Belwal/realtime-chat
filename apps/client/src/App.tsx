import { useState, useEffect, useRef } from "react";
import MessageList from "./components/MessageList";
import MessageInput from "./components/MessageInput";
import { ChatMessage, ServerMessage, ClientMessage, PrivateMessage } from "../../shared/websocket";

function isString(v: unknown): v is string {
  return typeof v === "string";
}
function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}
function isUserLike(v: unknown): v is { id: string; username: string } {
  return isObj(v) && isString(v.id) && isString(v.username);
}
function isChatMessageLike(v: unknown): v is ChatMessage {
  return (
    isObj(v) && isString(v.id) && isString(v.userId) && isString(v.username) &&
    isString(v.content) && isString(v.timestamp) && (v.roomId === undefined || isString(v.roomId))
  );
}
function isPrivateMessageLike(v: unknown): v is PrivateMessage {
  return (
    isObj(v) && isString(v.id) && isString(v.userId) && isString(v.username) &&
    isString(v.recipientUserId) && isString(v.content) && isString(v.timestamp)
  );
}

function isServerMessage(v: unknown): v is ServerMessage {
  if (!isObj(v)) return false;
  if (!isString(v.type)) return false;
  switch (v.type) {
    case "welcome":
      return isString(v.userId) && isString(v.username);
    case "chat":
      return isObj(v.message) && isChatMessageLike(v.message);
    case "user_joined":
      return isUserLike(v.user) && isString(v.roomId);
    case "user_left":
      return isUserLike(v.user) && isString(v.roomId);
    case "users":
      return Array.isArray(v.users) && v.users.every((u) => isUserLike(u));
    case "private_user_typing":
      return isUserLike(v.user) && isString(v.conversationWithUserId);
    case "user_typing":
      return isUserLike(v.user);
    case "user_stopped_typing":
      return isUserLike(v.user);
    case "rooms":
      return Array.isArray(v.rooms) && v.rooms.every((r) => isObj(r) && isString(r.id) && isString(r.name));
    case "room_joined":
      return isObj(v.room) && isString(v.room.id) && isString(v.room.name);
    case "room_created":
      return isObj(v.room) && isString(v.room.id) && isString(v.room.name);
    case "private_user_stopped_typing":
      return isUserLike(v.user) && isString(v.conversationWithUserId);
    case "private_message":
      return isObj(v.message) && isPrivateMessageLike(v.message);
    case "error":
      return isString(v.message);
    default:
      return false;
  }
}

function isChatMessage(v: unknown): v is ChatMessage {
  return isChatMessageLike(v);
}

export default function App() {
  const [status, setStatus] = useState<"connecting" | "connected" | "disconnected" | "reconnecting">("connecting");
  const [messagesByRoom, setMessagesByRoom] = useState<Record<string, ChatMessage[]>>({ general: [] });
  const [currentRoom, setCurrentRoom] = useState<string>("general");
  const [rooms, setRooms] = useState<{ id: string; name: string }[]>([]);
  const [conversations, setConversations] = useState<Record<string, PrivateMessage[]>>({});
  const [activeConversation, setActiveConversation] = useState<string>("public");
  const [usernameInput, setUsernameInput] = useState("");
  const [username, setUsername] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [users, setUsers] = useState<{ id: string; username: string }[]>([]);
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set());
  const [privateTypingUsers, setPrivateTypingUsers] = useState<Record<string, Set<string>>>({});
  const [createRoomOpen, setCreateRoomOpen] = useState(false);
  const [createRoomName, setCreateRoomName] = useState("");
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<number | null>(null);
  const reconnectDelay = useRef(1000);
  const intentionalClose = useRef(false);
  const reconnectBlocked = useRef(false);
  const sendMsg = (message: ClientMessage) => wsRef.current?.send(JSON.stringify(message));
  const usernameRef = useRef<string | null>(null);
  const currentUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    usernameRef.current = username;
    currentUserIdRef.current = currentUserId;
  }, [username, currentUserId]);

  const scheduleReconnect = () => {
    if (reconnectBlocked.current || intentionalClose.current || reconnectTimer.current) {
      setStatus("disconnected");
      return;
    }
    if (usernameRef.current) {
      setStatus("reconnecting");
      reconnectTimer.current = window.setTimeout(() => {
        console.log("[WS] reconnect timer fired");
        reconnectTimer.current = null;
        reconnectDelay.current = Math.min(reconnectDelay.current * 2, 30000);
        connectWs();
      }, reconnectDelay.current);
    } else {
      setStatus("disconnected");
    }
  };

  const connectWs = () => {
    console.log("[WS] connectWs()");
    intentionalClose.current = false;
    reconnectBlocked.current = false;
    setStatus("connecting");
    const ws = new WebSocket(import.meta.env.VITE_WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log("[WS] onopen");
      setStatus("connected");
      reconnectDelay.current = 1000;
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }
      if (usernameRef.current) {
        ws.send(JSON.stringify({ type: "join", username: usernameRef.current }));
      }
      setTypingUsers(new Set());
      setPrivateTypingUsers({});
      setCurrentRoom("general");
    };
    ws.onclose = () => {
      console.log("[WS] onclose");
      scheduleReconnect();
    };
    ws.onerror = () => {
      console.log("[WS] onerror");
      ws.close();
      scheduleReconnect();
    };
    ws.onmessage = async (event) => {
      const raw = event.data;
      let text: string;
      if (typeof raw === "string") {
        text = raw;
      } else if (raw instanceof Blob) {
        text = await raw.text();
      } else if (raw instanceof ArrayBuffer) {
        text = new TextDecoder().decode(raw);
      } else {
        text = String(raw);
      }
      try {
        const parsed = JSON.parse(text);
        if (isServerMessage(parsed)) {
          const p = parsed;
          if (p.type === "welcome") {
            reconnectBlocked.current = false;
            if (p.username !== username) setUsername(p.username);
            usernameRef.current = p.username;
            setCurrentUserId(p.userId);
            currentUserIdRef.current = p.userId;
            setCurrentRoom("general");
            return;
          }
          if (p.type === "users") {
            const list = p.users.map((u) => ({ id: u.id, username: u.username }));
            setUsers(list);
            return;
          }
          if (p.type === "user_left") {
            if (p.user.id && p.user.username) {
              const leftUser = p.user;
              setUsers((prev) => prev.filter((u) => u.id !== leftUser.id));
              setTypingUsers((prev) => {
                const next = new Set(prev);
                next.delete(leftUser.id);
                return next;
              });
              setPrivateTypingUsers((prev) => {
                const next = { ...prev };
                for (const key of Object.keys(next)) {
                  if (next[key]) {
                    const s = new Set(next[key]);
                    s.delete(leftUser.id);
                    next[key] = s;
                  }
                }
                return next;
              });
              const roomId = p.roomId || currentRoom;
              setMessagesByRoom((prev: Record<string, ChatMessage[]>) => ({
                ...prev,
                [roomId]: [...(prev[roomId] || []), { id: "sys-" + Date.now(), userId: "system", username: "System", content: leftUser.username + " left the room", timestamp: new Date().toISOString(), roomId: roomId }],
              }));
            }
            return;
          }
          if (p.type === "user_joined") {
            const joinedUser = p.user;
            if (joinedUser.id && joinedUser.username) {
              const userId = joinedUser.id;
              const userName = joinedUser.username;
              const roomId = p.roomId || currentRoom;
              setUsers((prev) => {
                if (prev.some((u) => u.id === userId)) return prev;
                return [...prev, { id: userId, username: userName }];
              });
              setMessagesByRoom((prev: Record<string, ChatMessage[]>) => ({
                ...prev,
                [roomId]: [...(prev[roomId] || []), { id: "sys-join-" + Date.now(), userId: "system", username: "System", content: userName + " joined the room", timestamp: new Date().toISOString(), roomId: roomId }],
              }));
            }
            return;
          }
          if (p.type === "rooms") {
            const list = p.rooms.map((r) => ({ id: r.id, name: r.name }));
            setRooms(list);
            return;
          }
          if (p.type === "room_joined") {
            setCurrentRoom(p.room.id);
            return;
          }
          if (p.type === "room_created") {
            setRooms((prev) => {
              if (prev.some((r) => r.id === p.room.id)) return prev;
              return [...prev, p.room];
            });
            return;
          }
          if (p.type === "user_typing") {
            setTypingUsers((prev) => new Set(prev).add(p.user.id));
            return;
          }
          if (p.type === "user_stopped_typing") {
            setTypingUsers((prev) => {
              const next = new Set(prev);
              next.delete(p.user.id);
              return next;
            });
            return;
          }
          if (p.type === "private_user_typing") {
            const userId = p.user.id; // sender of typing event
            const convId = p.conversationWithUserId; // counterpart user id (sender) for recipient's private conversation
            setPrivateTypingUsers((prev) => ({
              ...prev,
              [convId]: new Set([...((prev[convId] || new Set())), userId]),
            }));
            return;
          }
          if (p.type === "private_user_stopped_typing") {
            const userId = p.user.id; // sender of stopped event
            const convId = p.conversationWithUserId; // counterpart user id (sender) for recipient's private conversation
            setPrivateTypingUsers((prev) => {
              const next = { ...prev, [convId]: new Set(prev[convId] || new Set()) };
              next[convId].delete(userId);
              return next;
            });
            return;
          }
          if (p.type === "private_message") {
            const msg = p.message;
            const senderId = msg.userId;
            const recipientId = msg.recipientUserId;
            const myId = currentUserIdRef.current;
            const otherUserId = (myId === senderId) ? recipientId : senderId;
            if (otherUserId) {
              setConversations((prev: Record<string, PrivateMessage[]>) => ({
                ...prev,
                [otherUserId]: [...(prev[otherUserId] || []), msg],
              }));
            }
            return;
          }
          if (p.type === "chat") {
            const msg = p.message;
            const roomId = msg.roomId || "general";
            setMessagesByRoom((prev: Record<string, ChatMessage[]>) => ({
              ...prev,
              [roomId]: [...(prev[roomId] || []), msg],
            }));
            return;
          }
          if (p.type === "error") {
            setMessagesByRoom((prev: Record<string, ChatMessage[]>) => ({
              ...prev,
              [currentRoom]: [...(prev[currentRoom] || []), { id: "err-" + Date.now(), userId: "system", username: "System", content: "Error: " + p.message, timestamp: new Date().toISOString(), roomId: currentRoom }],
            }));
            if (p.message === "Username already taken") {
              reconnectBlocked.current = true;
              if (reconnectTimer.current) {
                clearTimeout(reconnectTimer.current);
                reconnectTimer.current = null;
              }
              setUsername(null);
              setCurrentUserId(null);
            }
            return;
          }
        }
      } catch (error) {
        console.error("Invalid WebSocket message:", error);
      }
    };
  };

  useEffect(() => {
    connectWs();
    return () => {
      intentionalClose.current = true;
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }
      wsRef.current?.close();
    };
  }, []);

  const join = () => {
    reconnectBlocked.current = false;
    const name = usernameInput.trim();
    if (!name || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    sendMsg({ type: "join", username: name });
  };

  const sendTyping = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) sendMsg({ type: "typing" });
  };
  const sendStopTyping = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) sendMsg({ type: "stop_typing" });
  };

  const handleSend = (content: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    sendMsg({ type: "chat", content });
  };

  const sendPrivateMessage = (toUserId: string, content: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    sendMsg({ type: "private_message", toUserId, content });
  };

  const sendPrivateTyping = (toUserId: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && toUserId !== "public") {
      sendMsg({ type: "private_typing", toUserId });
    }
  };
  const sendPrivateStopTyping = (toUserId: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && toUserId !== "public") {
      sendMsg({ type: "private_stop_typing", toUserId });
    }
  };

  return (
    <div style={{ display: "flex", height: "100vh", fontFamily: "sans-serif", background: "#0F1115", color: "#F3F4F6" }}>
      <aside style={{ width: 240, padding: 20, borderRight: "1px solid #252A34", background: "#151821" }}>
        <h3 style={{ letterSpacing: "0.08em", fontSize: 12, fontWeight: 600, marginBottom: 12, color: "#F3F4F6" }}>ROOMS 2</h3>
        <div style={{ marginBottom: 12 }}>
          <div
            style={{ padding: "6px 10px", borderRadius: 6, cursor: "pointer", background: currentRoom === "general" ? "#6366F1" : "#1B202B", color: currentRoom === "general" ? "#fff" : "#F3F4F6", fontSize: 14, marginBottom: 4 }}
            onClick={() => wsRef.current && wsRef.current.readyState === WebSocket.OPEN ? sendMsg({ type: "join_room", roomId: "general" }) : null}
          >
            # General
          </div>
          {rooms.filter((r) => r.id !== "general").map((r) => (
            <div
              key={r.id}
              style={{ padding: "6px 10px", borderRadius: 6, cursor: "pointer", background: currentRoom === r.id ? "#6366F1" : "#1B202B", color: currentRoom === r.id ? "#fff" : "#F3F4F6", fontSize: 14, marginBottom: 4, display: "flex", alignItems: "center", gap: 8 }}
              onClick={() => wsRef.current && wsRef.current.readyState === WebSocket.OPEN ? sendMsg({ type: "join_room", roomId: r.id }) : null}
            >
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#22C55E", display: "inline-block" }} />
              # {r.name}
            </div>
          ))}
        </div>
        <h3 style={{ letterSpacing: "0.08em", fontSize: 12, fontWeight: 600, marginBottom: 8, color: "#F3F4F6" }}>ONLINE — {users.length}</h3>
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {users.filter((u) => u.id !== currentUserId).map((u) => (
            <li
              key={u.id}
              onClick={() => setActiveConversation(u.id)}
              style={{ height: 40, padding: "0 8px", borderRadius: 6, display: "flex", alignItems: "center", gap: 10, marginBottom: 4, background: activeConversation === u.id ? "#6366F1" : "#1B202B", color: activeConversation === u.id ? "#fff" : "#F3F4F6", cursor: "pointer", fontSize: 14 }}
            >
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#22C55E", display: "inline-block" }} />
              {u.username}
            </li>
          ))}
        </ul>
        <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
          <button onClick={() => setCreateRoomOpen(!createRoomOpen)} style={{ flex: 1, padding: 6, borderRadius: 6, background: "#1B202B", color: "#F3F4F6", border: "none", fontSize: 12, cursor: "pointer" }}>{createRoomOpen ? "Cancel" : "+ Create Room"}</button>
          <button onClick={() => wsRef.current && wsRef.current.readyState === WebSocket.OPEN ? sendMsg({ type: "leave_room" }) : null} style={{ flex: 1, padding: 6, borderRadius: 6, background: "#1B202B", color: "#F3F4F6", border: "none", fontSize: 12, cursor: "pointer" }}>Leave Room</button>
        </div>
        {createRoomOpen && (
          <div style={{ marginTop: 8, padding: 8, background: "#151821", borderRadius: 8, border: "1px solid #252A34" }}>
            <input value={createRoomName} onChange={(e) => setCreateRoomName(e.target.value)} placeholder="Room name" style={{ width: "100%", padding: 6, borderRadius: 6, border: "1px solid #252A34", background: "#0F1115", color: "#F3F4F6", fontSize: 12, marginBottom: 6 }} />
            <button onClick={() => { if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) sendMsg({ type: "create_room", name: createRoomName.trim() }); setCreateRoomOpen(false); setCreateRoomName(""); }} style={{ width: "100%", padding: 6, borderRadius: 6, background: "#6366F1", color: "#fff", border: "none", fontSize: 12, cursor: "pointer" }}>Create</button>
          </div>
        )}
      </aside>
      <main style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <header style={{ padding: "16px 24px", borderBottom: "1px solid #252A34", height: 64, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Realtime Chat</h2>
          <span style={{ fontSize: 12, color: status === "connected" ? "#22C55E" : status === "reconnecting" ? "#F59E0B" : "#9CA3AF" }}>● {status === "connected" ? "Connected" : status === "reconnecting" ? "Reconnecting..." : status === "disconnected" ? "Disconnected" : "Connecting..."}</span>
        </header>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
          {!username ? (
            <div style={{ padding: 24 }}>
              <h3>Join the chat</h3>
              <input
                value={usernameInput}
                onChange={(e) => setUsernameInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") join(); }}
                placeholder="Your username"
                style={{ height: 44, padding: "0 12px", borderRadius: 8, border: "1px solid #252A34", background: "#151821", color: "#F3F4F6", width: 240 }}
              />
              <button onClick={join} style={{ height: 44, padding: "0 20px", marginLeft: 8, borderRadius: 8, background: "#6366F1", color: "#fff", border: "none", fontWeight: 600, cursor: "pointer" }}>Join</button>
            </div>
          ) : (
            <>
              {activeConversation === "public" ? (
                <>
                  <MessageList messages={messagesByRoom[currentRoom] || []} currentUserId={currentUserId} />
                  <div style={{ minHeight: 24, padding: "4px 16px", fontSize: 12, color: "#9CA3AF", fontStyle: "italic" }}>
                    {typingUsers.size > 0 ? (
                      <>
                        {Array.from(typingUsers).map((id) => users.find((u) => u.id === id)?.username).filter(Boolean).map((name, i, arr) => (
                          <span key={i}>{i > 0 ? (i === arr.length - 1 ? " and " : ", ") : ""}{name}</span>
                        ))}
                        {typingUsers.size === 1 ? " is typing..." : " are typing..."}
                      </>
                    ) : null}
                  </div>
                  <MessageInput onSend={handleSend} onTyping={sendTyping} onStopTyping={sendStopTyping} />
                </>
              ) : (
                <>
                  <div style={{ padding: "8px 16px", borderBottom: "1px solid #252A34", fontSize: 14, color: "#9CA3AF", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span>Private chat with {users.find((u) => u.id === activeConversation)?.username || activeConversation}</span>
                    <button onClick={() => setActiveConversation("public")} style={{ padding: "4px 10px", borderRadius: 6, background: "#6366F1", color: "#fff", border: "none", fontSize: 12, cursor: "pointer" }}>Public</button>
                  </div>
                  <MessageList messages={conversations[activeConversation] || []} currentUserId={currentUserId} />
                  <div style={{ minHeight: 24, padding: "4px 16px", fontSize: 12, color: "#9CA3AF", fontStyle: "italic" }}>
                    {activeConversation !== "public" && privateTypingUsers[activeConversation]?.size ? (
                      <>
                        {Array.from(privateTypingUsers[activeConversation] || new Set()).map((id) => users.find((u) => u.id === id)?.username).filter(Boolean).map((name, i, arr) => (
                          <span key={i}>{i > 0 ? (i === arr.length - 1 ? " and " : ", ") : ""}{name}</span>
                        ))}
                        {(privateTypingUsers[activeConversation]?.size ?? 0) === 1 ? " is typing..." : " are typing..."}
                      </>
                    ) : null}
                  </div>
                  <MessageInput
                    onSend={(content) => sendPrivateMessage(activeConversation, content)}
                    onTyping={() => sendPrivateTyping(activeConversation)}
                    onStopTyping={() => sendPrivateStopTyping(activeConversation)}
                  />
                </>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
