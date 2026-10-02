import { ChatMessage, PrivateMessage } from "../../../shared/websocket";
import MessageBubble from "./MessageBubble";
import { useEffect, useRef } from "react";

export default function MessageList({ messages, currentUserId }: { messages: (ChatMessage | PrivateMessage)[]; currentUserId: string | null }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div style={{ overflowY: "auto", flex: 1, padding: 24 }}>
      {messages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} isOwn={msg.userId === currentUserId} />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
