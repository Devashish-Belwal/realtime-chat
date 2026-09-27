export type ClientMessage =
  | {
      type: "join";
      username: string;
    }
  | {
      type: "chat";
      content: string;
    }
  | {
      type: "private_message";
      toUserId: string;
      content: string;
    }
  | {
      type: "typing";
    }
  | {
      type: "stop_typing";
    }
  | {
      type: "private_typing";
      toUserId: string;
    }
  | {
      type: "private_stop_typing";
      toUserId: string;
    }
  | {
      type: "join_room";
      roomId: string;
    }
  | {
      type: "create_room";
      name: string;
    }
  | {
      type: "leave_room";
    }
  | {
      type: "typing";
    };

export type ServerMessage =
  | {
      type: "welcome";
      userId: string;
      username: string;
    }
  | {
      type: "chat";
      message: ChatMessage & { roomId?: string };
    }
  | {
      type: "user_joined";
      user: { id: string; username: string };
    }
  | {
      type: "user_left";
      user: { id: string; username: string };
    }
  | {
      type: "users";
      users: { id: string; username: string }[];
    }
  | {
      type: "private_user_typing";
      user: { id: string; username: string };
      conversationWithUserId: string;
    }
  | {
      type: "user_typing";
      user: { id: string; username: string };
    }
  | {
      type: "user_stopped_typing";
      user: { id: string; username: string };
    }
  | {
      type: "rooms";
      rooms: { id: string; name: string }[];
    }
  | {
      type: "room_joined";
      room: { id: string; name: string };
    }
  | {
      type: "room_created";
      room: { id: string; name: string };
    }
  | {
      type: "room_left";
      room: { id: string; name: string };
    }
  | {
      type: "private_user_stopped_typing";
      user: { id: string; username: string };
      conversationWithUserId: string;
    }
  | {
      type: "private_message";
      message: PrivateMessage;
    }
  | {
      type: "error";
      message: string;
    };

export interface User {
  id: string;
  username: string;
}

export interface ChatMessage {
  id: string;
  userId: string;
  username: string;
  content: string;
  timestamp: string;
  roomId?: string;
}

export interface PrivateMessage {
  id: string;
  userId: string;
  username: string;
  recipientUserId: string;
  content: string;
  timestamp: string;
}