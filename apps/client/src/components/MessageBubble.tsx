import { ChatMessage } from "../types/chat";

export default function MessageBubble({ message, isOwn }: { message: ChatMessage; isOwn: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: isOwn ? "flex-end" : "flex-start", marginBottom: 12 }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: "#9CA3AF", marginBottom: 4 }}>{isOwn ? "You" : message.username}</span>
      <div style={{ maxWidth: "70%", padding: 12, borderRadius: 10, background: isOwn ? "#4F46E5" : "#1B202B", color: "#F3F4F6" }}>
        <div style={{ fontSize: 14 }}>{message.content}</div>
        <div style={{ fontSize: 10, color: "#9CA3AF", marginTop: 4, textAlign: "right" }}>{new Date(message.timestamp).toLocaleTimeString()}</div>
      </div>
    </div>
  );
}
