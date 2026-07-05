export interface Point {
  x: number;
  y: number;
}

export interface Velocity {
  vx: number;
  vy: number;
}

export type RoomStatus = 'inactive' | 'waiting' | 'playing';
export type GameMode = 'DUO' | 'SOLO_RESPAWN' | 'SOLO_NO_RESPAWN';

export interface KillEvent {
  id: string;
  killerName: string;
  killerColor: string;
  victimName: string;
  victimColor: string;
  timestamp: number;
}

export interface Room {
  id: string;
  name: string;
  status: RoomStatus;
  gameMode?: GameMode;
  hostId: string;
  mapSeed: number;
  matchId?: string;
  timerSeconds: number;
  gameStartTime: number;
  matchEndTime?: number;
  createdAt: number;
  updatedAt: number;
  players?: string[];
  isBotMode?: boolean;
  killEvents?: KillEvent[];
}

export interface PlayerState {
  userId: string;
  name: string;
  x: number;
  y: number;
  rotation: number;
  health: number;
  score: number;
  lives?: number;
  matchId?: string;
  shieldUntil?: number;
  color: string;
  tankType: 'scout' | 'heavy' | 'balanced';
  isAlive: boolean;
  lastAction: string;
  updatedAt: number;
}

export interface Bullet {
  id: string;
  playerId: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  startX: number;
  startY: number;
  range: number;
  size: number;
  createdAt: number;
  color?: string;
}

export interface MapObject {
  id: string;
  type: 'wall' | 'box';
  x: number;
  y: number;
  width: number;
  height: number;
  health?: number;
}

export const GAME_CONSTANTS = {
  WORLD_WIDTH: 3000,
  WORLD_HEIGHT: 3000,
  CANVAS_WIDTH: window.innerWidth || 1024,
  CANVAS_HEIGHT: window.innerHeight || 768,
  TANK_SIZE: 40,
  BULLET_SPEED: {
    scout: 24,
    balanced: 18,
    heavy: 12
  },
  BULLET_SIZE: {
    scout: 4,
    balanced: 6,
    heavy: 10
  },
  MAX_HEALTH: 100,
  PLAYER_SPEED: {
    scout: 6,
    balanced: 4.5,
    heavy: 3
  },
  ROTATE_SPEED: 0.08,
  FIRE_RATE: {
    scout: 200,
    balanced: 400,
    heavy: 800
  },
  DAMAGE: {
    scout: 15,
    balanced: 25,
    heavy: 40
  },
  AMMO_CAPACITY: {
    scout: 4,
    balanced: 3,
    heavy: 2
  },
  RELOAD_SPEED: {
    scout: 800,
    balanced: 1200,
    heavy: 1800
  },
  BULLET_RANGE: {
    scout: 300,
    balanced: 400,
    heavy: 500
  },
  COLORS: {
    scout: '#3b82f6',
    balanced: '#10b981',
    heavy: '#ef4444'
  }
};

