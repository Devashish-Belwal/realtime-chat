import { useState, useRef, useCallback, useEffect } from "react";

export default function MessageInput({ onSend, onTyping, onStopTyping }: { onSend: (content: string) => void; onTyping?: () => void; onStopTyping?: () => void }) {
  const [value, setValue] = useState("");
  const timerRef = useRef<number | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    setValue(text);
    if (text.trim()) {
      if (onTyping) onTyping();
      clearTimer();
      timerRef.current = window.setTimeout(() => {
        if (onStopTyping) onStopTyping();
        timerRef.current = null;
      }, 750);
    } else {
      clearTimer();
      if (onStopTyping) onStopTyping();
    }
  };

  const handleSend = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    clearTimer();
    if (onStopTyping) onStopTyping();
    onSend(trimmed);
    setValue("");
  };

  useEffect(() => {
    return () => {
      clearTimer();
    };
  }, [clearTimer]);

  return (
    <div style={{ display: "flex", gap: 12, padding: 16, borderTop: "1px solid #252A34", height: 72, alignItems: "center" }}>
      <textarea
        value={value}
        onChange={handleChange}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSend();
          }
        }}
        placeholder="Write a message..."
        style={{ flex: 1, height: 44, padding: "0 12px", borderRadius: 8, border: "1px solid #252A34", background: "#151821", color: "#F3F4F6", resize: "none", fontFamily: "inherit" }}
      />
      <button onClick={handleSend} style={{ height: 44, width: 80, borderRadius: 8, background: "#6366F1", color: "#fff", border: "none", fontWeight: 600, cursor: "pointer" }}>Send</button>
    </div>
  );
}
