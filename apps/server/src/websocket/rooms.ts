export interface Room {
  id: string;
  name: string;
}

export const rooms = new Map<string, Room>();

export function createDefaultRooms() {
  rooms.set("general", { id: "general", name: "General" });
}

export function getRoom(roomId: string): Room | undefined {
  return rooms.get(roomId);
}

export function getAllRooms(): Room[] {
  return Array.from(rooms.values());
}

export function createRoom(roomId: string, name: string): boolean {
  const normalized = name.trim();
  if (!normalized || normalized.length > 100) return false;
  const idNormalized = normalized.toLowerCase().replace(/\s+/g, "-");
  // Prevent duplicate IDs or names (case-insensitive)
  for (const r of rooms.values()) {
    if (r.id.toLowerCase() === idNormalized || r.name.toLowerCase() === normalized.toLowerCase()) {
      return false;
    }
  }
  rooms.set(idNormalized, { id: idNormalized, name: normalized });
  return true;
}
