import { Server as SocketIOServer, Socket } from 'socket.io';
import { AviatorEngine } from './aviator.engine';

/**
 * Runs several independent Aviator rounds in parallel.
 * Each room is its own engine with its own countdown, flight, pool and history;
 * every broadcast is scoped with io.to(roomId).
 */
export class AviatorRoomManager {
  public readonly maxPlayersPerRoom: number;
  private rooms = new Map<string, AviatorEngine>();
  private nextRoomNumber = 2;

  constructor(private io: SocketIOServer, maxPlayersPerRoom = 1000) {
    this.maxPlayersPerRoom = maxPlayersPerRoom;
    this.rooms.set('default', new AviatorEngine(io, 'default', 'Main', maxPlayersPerRoom));
  }

  private createRoom(id?: string): AviatorEngine {
    const roomId = id || `room-${this.nextRoomNumber++}`;
    const engine = new AviatorEngine(
      this.io,
      roomId,
      `Room ${roomId === 'default' ? 1 : roomId.replace('room-', '')}`,
      this.maxPlayersPerRoom
    );
    this.rooms.set(roomId, engine);
    const match = roomId.match(/^room-(\d+)$/);
    if (match) this.nextRoomNumber = Math.max(this.nextRoomNumber, Number(match[1]) + 1);
    console.log(`[Aviator] Created parallel room ${roomId} (capacity ${this.maxPlayersPerRoom})`);
    return engine;
  }

  getRoom(roomId?: string): AviatorEngine {
    return this.rooms.get(roomId || 'default') || this.rooms.get('default')!;
  }

  join(socket: Socket, requestedRoomId?: string) {
    let roomId = requestedRoomId || socket.data.aviatorRoom || 'default';
    // Unknown requested room IDs are created on demand (parallel rooms).
    if (roomId !== 'default' && !this.rooms.has(roomId)) {
      this.createRoom(roomId);
    }
    let engine = this.getRoom(roomId);
    let size = this.io.sockets.adapter.rooms.get(roomId)?.size || 0;

    // If the requested room is full, roll the player onto a fresh parallel room.
    if (size >= this.maxPlayersPerRoom && roomId !== 'default') {
      engine = this.createRoom();
      roomId = engine.roomId;
      size = 0;
    }

    socket.join(roomId);
    socket.data.aviatorRoom = roomId;
    return {
      roomId,
      roomName: engine.roomName,
      players: size + 1,
      maxPlayers: this.maxPlayersPerRoom,
    };
  }

  listRooms() {
    return Array.from(this.rooms.values()).map((engine) => {
      const room = this.io.sockets.adapter.rooms.get(engine.roomId);
      const state = engine.getCurrentState();
      return {
        roomId: engine.roomId,
        roomName: engine.roomName,
        players: room ? room.size : 0,
        maxPlayers: this.maxPlayersPerRoom,
        state: state.state,
        multiplier: state.multiplier,
        roundId: state.roundId,
      };
    });
  }

  getState(roomId?: string) {
    const engine = this.getRoom(roomId);
    const room = this.io.sockets.adapter.rooms.get(engine.roomId);
    return {
      ...engine.getCurrentState(),
      players: room ? room.size : 0,
      rooms: this.listRooms(),
    };
  }

  /** Admin audit log across all rooms, newest first. */
  getRoundLog() {
    return Array.from(this.rooms.values())
      .flatMap((e) => e.getRoundResults())
      .sort((a, b) => b.at.localeCompare(a.at));
  }

  placeBet(roomId: string | undefined, params: Parameters<AviatorEngine['placeBet']>[0]) {
    return this.getRoom(roomId).placeBet(params);
  }

  cancelBet(roomId: string | undefined, userId: string, betId: string) {
    return this.getRoom(roomId).cancelBet(userId, betId);
  }

  cashoutBet(roomId: string | undefined, userId: string, betId: string, customMultiplier?: number) {
    return this.getRoom(roomId).cashoutBet(userId, betId, customMultiplier);
  }
}
