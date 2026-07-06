import React, { useEffect, useRef, useState } from 'react';
import { Settings, X, Maximize, WifiOff } from 'lucide-react';
import { io, Socket } from 'socket.io-client';
import { socket } from '../lib/socket';
import { PlayerState, Bullet, Room, GAME_CONSTANTS, MapObject, KillEvent } from '../types';

// STUB FIRESTORE TO USE SOCKET OUT.
const db = {};
const doc = (db: any, path: string, ...rest: any[]) => path + (rest.length ? '/' + rest.join('/') : '');
const collection = (db: any, path: string) => path;
const getDoc = async (docRef?: any) => ({ exists: () => false, data: () => ({} as any) });
const serverTimestamp = () => Date.now();

const updateDoc = async (d: string, data: any) => {
   if (d.includes('rooms/')) {
       const rid = d.split('rooms/')[1].split('/')[0];
       if (data.status) {
           socket.emit('update_room', { id: rid, ...data });
       }
       if (data.killEvents && data.killEvents.__isUnion) {
           socket.emit('kill_event', data.killEvents.item);
       }
   }
   return Promise.resolve();
};

const setDoc = async (d: string, data: any, options: any) => {
    if (d.includes('/players/')) {
        const uid = d.split('/').pop();
        if (uid) {
           socket.emit('sync_player', { userId: uid, ...data });
        }
    }
    return Promise.resolve();
};

const arrayRemove = (item: any) => ({ __isRemove: true, item });
const arrayUnion = (item: any) => ({ __isUnion: true, item });

function getDuoTeams(mapSeed: number, playerIds: string[]): Map<string, number> {
  const teams = new Map<string, number>();
  const sortedIds = [...playerIds].sort();
  let s = mapSeed % 2147483647;
  if (s <= 0) s += 2147483646;
  const nextRand = () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
  for (let i = sortedIds.length - 1; i > 0; i--) {
    const j = Math.floor(nextRand() * (i + 1));
    const temp = sortedIds[i];
    sortedIds[i] = sortedIds[j];
    sortedIds[j] = temp;
  }
  for (let i = 0; i < sortedIds.length; i++) {
    const teamNum = Math.floor(i / 2);
    teams.set(sortedIds[i], teamNum);
  }
  return teams;
}

// Instead of onSnapshot, we just return a fake unsubscribe,
// because GameClient handles socket updates natively now!
const onSnapshot = (path: string, callback: any) => {
    return () => {};
};

function getValidSpawn(objects: MapObject[], remotePlayers?: Map<string, PlayerState>) {
  const pr = 40; // radius checking
  let fallbackSpawn = null;
  
  for(let i=0; i<300; i++) {
     let nx = Math.random() * (GAME_CONSTANTS.WORLD_WIDTH - 240) + 120;
     let ny = Math.random() * (GAME_CONSTANTS.WORLD_HEIGHT - 240) + 120;
     let validObj = true;
     for (let obj of objects) {
        const testX = Math.max(obj.x, Math.min(nx, obj.x + obj.width));
        const testY = Math.max(obj.y, Math.min(ny, obj.y + obj.height));
        const dist = Math.sqrt(Math.pow(nx - testX, 2) + Math.pow(ny - testY, 2));
        if (dist < pr) { validObj = false; break; }
     }
     
     if (validObj) {
         if (!fallbackSpawn) fallbackSpawn = { x: nx, y: ny };
         let validPlayers = true;
         if (remotePlayers) {
            for (let p of remotePlayers.values()) {
               if (p.isAlive) {
                  const pDist = Math.hypot(nx - p.x, ny - p.y);
                  if (pDist < 200) { validPlayers = false; break; }
               }
            }
         }
         if (validPlayers) return {x: nx, y: ny};
     }
  }
  
  return fallbackSpawn || {
    x: Math.random() * (GAME_CONSTANTS.WORLD_WIDTH - 240) + 120, 
    y: Math.random() * (GAME_CONSTANTS.WORLD_HEIGHT - 240) + 120
  };
}

// Deterministic random for map generation (Park-Miller LCG)
function generateMap(seed: number): MapObject[] {
  const objects: MapObject[] = [];
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  const random = () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };

  const isOverlap = (rect1: any, rect2: any) => {
    return rect1.x < rect2.x + rect2.width &&
           rect1.x + rect1.width > rect2.x &&
           rect1.y < rect2.y + rect2.height &&
           rect1.y + rect1.height > rect2.y;
  };

  const tryAddObj = (obj: any, attempts = 20) => {
    for (let i=0; i<attempts; i++) {
        let outOfBounds = false;
        if (obj.x < 90 || obj.x + obj.width > GAME_CONSTANTS.WORLD_WIDTH - 90 ||
            obj.y < 90 || obj.y + obj.height > GAME_CONSTANTS.WORLD_HEIGHT - 90) {
            outOfBounds = true;
        }

        let overlap = false;
        if (!outOfBounds) {
            for (let other of objects) {
                if (isOverlap(obj, other)) {
                    overlap = true;
                    break;
                }
            }
        }
        
        if (!overlap && !outOfBounds) {
            objects.push(obj);
            return true;
        }
        obj.x = random() * (GAME_CONSTANTS.WORLD_WIDTH - 180 - obj.width) + 90;
        obj.y = random() * (GAME_CONSTANTS.WORLD_HEIGHT - 180 - obj.height) + 90;
    }
    return false;
  };

  const numBoxes = 60;
  for (let i = 0; i < numBoxes; i++) {
    const w = 60 + random() * 60;
    const h = 60 + random() * 60;
    tryAddObj({
      id: `box_${i}`,
      type: 'box',
      x: random() * (GAME_CONSTANTS.WORLD_WIDTH - 180 - w) + 90,
      y: random() * (GAME_CONSTANTS.WORLD_HEIGHT - 180 - h) + 90,
      width: w,
      height: h,
      health: 100
    });
  }

  const numWalls = 25;
  for (let i = 0; i < numWalls; i++) {
    const isHorizontal = random() > 0.5;
    const w = isHorizontal ? (200 + random() * 300) : 40;
    const h = isHorizontal ? 40 : (200 + random() * 300);
    tryAddObj({
      id: `wall_${i}`,
      type: 'wall',
      x: random() * (GAME_CONSTANTS.WORLD_WIDTH - 180 - w) + 90,
      y: random() * (GAME_CONSTANTS.WORLD_HEIGHT - 180 - h) + 90,
      width: w,
      height: h,
    });
  }

  return objects;
}

function checkLineOfSight(x1: number, y1: number, x2: number, y2: number, mapObjects: MapObject[]) {
  const dist = Math.hypot(x2 - x1, y2 - y1);
  if (dist === 0) return true;
  const steps = Math.max(1, Math.ceil(dist / 10));
  const dx = (x2 - x1) / steps;
  const dy = (y2 - y1) / steps;
  
  for (let i = 1; i <= steps; i++) {
      const px = x1 + dx * i;
      const py = y1 + dy * i;
      for (const obj of mapObjects) {
          if (px >= obj.x && px <= obj.x + obj.width && py >= obj.y && py <= obj.y + obj.height) {
              return false;
          }
      }
  }
  return true;
}

interface GameClientProps {
  room: Room;
  user: any;
  selection: any;
  onExit: () => void;
}

export function GameClient({ room, user, selection, onExit }: GameClientProps) {
  const roomId = room.id;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // HUD state
  const [health, setHealth] = useState(100);
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(3);
  const [isAlive, setIsAlive] = useState(true);
  const [roomName, setRoomName] = useState('...');
  const [leaderboard, setLeaderboard] = useState<{name: string, score: number, isMe: boolean}[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [autoAimEnabled, setAutoAimEnabled] = useState(true);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [matchEnded, setMatchEnded] = useState(room.status === 'inactive');
  const matchEndTimeRef = useRef<number | null>(null);
  const [isGameLoaded, setIsGameLoaded] = useState(false);
  const [killFeed, setKillFeed] = useState<KillEvent[]>([]);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [respawnCountdown, setRespawnCountdown] = useState<number | null>(null);

  const getTeam = (id: string) => {
    if (room.gameMode === 'DUO') {
      const playerIds = [user.uid];
      state.current.remotePlayers.forEach((p, rId) => {
        playerIds.push(rId);
      });
      playerIds.sort();
      let s = (room.mapSeed || 12345) % 2147483647;
      if (s <= 0) s += 2147483646;
      const nextRand = () => {
        s = (s * 16807) % 2147483647;
        return (s - 1) / 2147483646;
      };
      const shuffled = [...playerIds];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(nextRand() * (i + 1));
        const temp = shuffled[i];
        shuffled[i] = shuffled[j];
        shuffled[j] = temp;
      }
      const index = shuffled.indexOf(id);
      if (index !== -1) {
        return Math.floor(index / 2);
      }
    }
    let h = 0;
    for (let i = 0; i < id.length; i++) {
      h = Math.imul(31, h) + id.charCodeAt(i) | 0;
    }
    return Math.abs(h) + 1000;
  };

  useEffect(() => {
     const handleOnline = () => window.location.reload();
     const handleOffline = () => setIsOnline(false);
     window.addEventListener('online', handleOnline);
     window.addEventListener('offline', handleOffline);
     return () => {
         window.removeEventListener('online', handleOnline);
         window.removeEventListener('offline', handleOffline);
     };
  }, []);

  // We keep game state in refs to avoid React renders
  const socketRef = useRef<Socket | null>(null);
  const state = useRef({
    matchEnded: false,
    isOnline: true,
    localPlayer: null as PlayerState | null,
    remotePlayers: new Map<string, PlayerState>(),
    bullets: [] as Bullet[],
    mapObjects: [] as MapObject[],
    maxTotalCount: 0,
    keys: new Set<string>(),
    mouse: { x: 0, y: 0, worldX: 0, worldY: 0, isDown: false },
    joystickMove: { dx: 0, dy: 0 },
    joystickShoot: { angle: 0, active: false, x: 0, y: 0, justReleased: false, wasAutoAim: false, dragDist: 0 },
    lastFireTime: 0,
    lastSyncTime: 0,
    roomId,
    userId: user.uid,
    isDead: false,
    autoAimEnabled: true,
    lastKnownEnemyPos: null as {x: number, y: number} | null,
    ammo: 3,
    lastReloadTime: 0,
    cameraX: 0,
    cameraY: 0,
    isHost: room.hostId === user.uid,
    lastConditionCheckTime: 0
  });

  useEffect(() => {
    state.current.autoAimEnabled = autoAimEnabled;
  }, [autoAimEnabled]);

  useEffect(() => {
    state.current.matchEnded = matchEnded;
  }, [matchEnded]);

  useEffect(() => {
    state.current.isOnline = isOnline;
  }, [isOnline]);

  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) return;
    const canvas = canvasRef.current;
    let ctx = canvas.getContext('2d')!;
    
    // Setup Canvas Size
    const resizeObserver = new ResizeObserver((entries) => {
      for (let entry of entries) {
        if (canvas) {
          canvas.width = entry.contentRect.width;
          canvas.height = entry.contentRect.height;
          GAME_CONSTANTS.CANVAS_WIDTH = canvas.width;
          GAME_CONSTANTS.CANVAS_HEIGHT = canvas.height;
        }
      }
    });

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    // Initial Database Setup
    let unsubRoom: any, unsubPlayers: any, unsubBullets: any;
    
    const initGame = async () => {
      // Map generation first to ensure obstacle avoidance works immediately
      state.current.mapObjects = generateMap(room.mapSeed || 12345);

      // Create Local Player
      const pRef = doc(db, `rooms/${roomId}/players`, user.uid);
      const pSnap = await getDoc(pRef);
      
      let lp: PlayerState;
      const isSameMatch = pSnap.exists() && pSnap.data().matchId === room.matchId;
      const defaultLives = room.gameMode === 'SOLO_RESPAWN' ? 3 : 1;

      if (pSnap.exists() && pSnap.data().isAlive && isSameMatch) {
         lp = pSnap.data() as PlayerState;
      } else {
         const spawn = getValidSpawn(state.current.mapObjects, state.current.remotePlayers);
         const shieldTime = Date.now() + 3000;
         lp = {
            userId: user.uid,
            name: user.displayName || 'PILOT',
            x: spawn.x,
            y: spawn.y,
            rotation: 0,
            health: 100,
            score: pSnap.exists() && isSameMatch ? pSnap.data().score : 0, 
            color: selection.color,
            tankType: selection.type,
            isAlive: true,
            matchId: room.matchId,
            lives: pSnap.exists() && isSameMatch ? (pSnap.data().lives ?? defaultLives) : defaultLives,
            shieldUntil: shieldTime,
            lastAction: 'joined',
            updatedAt: Date.now()
         };
         await setDoc(pRef, { ...lp, updatedAt: serverTimestamp() }, { merge: true });
      }
      
      setHealth(lp.health || 0);
      setIsAlive(lp.isAlive || false);
      setScore(lp.score || 0);
      setLives(lp.lives ?? defaultLives);

      state.current.localPlayer = lp;
      state.current.ammo = GAME_CONSTANTS.AMMO_CAPACITY[lp.tankType] || 3;

      const r = room;
      setRoomName(r.name || 'SECTOR');
      if (r.status === 'inactive' && r.matchId) setMatchEnded(true);
      if (r.matchEndTime) matchEndTimeRef.current = r.matchEndTime;
      if (Array.isArray(r.killEvents)) {
        const now = Date.now();
        const recent = r.killEvents.filter((k: any) => now - k.timestamp < 5000).slice(-4);
        setKillFeed(recent);
      }

      if (r.isBotMode && !state.current.isBotModeInitialized) {
         state.current.isBotModeInitialized = true;
         const botNames = ['STINGER_BOT', 'GOLIATH_BOT', 'STRIKER_BOT', 'VIPER_BOT', 'RHINO_BOT', 'PHANTOM_BOT', 'JUGGER_BOT'];
         const botColors = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#f97316'];
         const botTypes = ['scout', 'heavy', 'balanced', 'scout', 'heavy', 'balanced', 'heavy'];
         
         for (let i = 0; i < 7; i++) {
            const botSpawn = getValidSpawn(state.current.mapObjects, state.current.remotePlayers);
            const botId = `BOT_${i+1}`;
            const bot = {
               userId: botId,
               name: botNames[i],
               x: botSpawn.x,
               y: botSpawn.y,
               rotation: Math.random() * Math.PI * 2,
               health: 100,
               score: 0,
               color: botColors[i],
               tankType: botTypes[i] as any,
               isAlive: true,
               matchId: room.matchId,
               lives: defaultLives,
               shieldUntil: Date.now() + 3000,
               lastAction: 'joined',
               updatedAt: Date.now(),
               isBot: true
            } as any;
            state.current.remotePlayers.set(botId, bot);
         }
      }

      // Setup Socket.io
      socket.connect();
      socketRef.current = socket as any;

      socket.on('player_joined', (p) => {
          if (p.userId !== user.uid) {
             const ext = p as any;
             ext.serverX = p.x;
             ext.serverY = p.y;
             ext.vx = 0;
             ext.vy = 0;
             ext.targetRotation = p.rotation;
             state.current.remotePlayers.set(p.userId, p);
          }
      });

      socket.on('player_left', (uid) => {
         if (uid !== user.uid) {
             state.current.remotePlayers.delete(uid);
         }
      });

      socket.on('room_state', (players: any[]) => {
          setIsGameLoaded(true);
          players.forEach(p => {
             if (p.userId !== user.uid) {
                const ext = p as any;
                ext.serverX = p.x;
                ext.serverY = p.y;
                ext.vx = 0;
                ext.vy = 0;
                ext.targetRotation = p.rotation;
                state.current.remotePlayers.set(p.userId, p);
             }
          });
      });

      socket.on('sync_player', (p) => {
          if (p.userId !== user.uid) {
             if (p.aborted) {
                state.current.remotePlayers.delete(p.userId);
                return;
             }
             const existing = state.current.remotePlayers.get(p.userId);
             if (existing) {
                const ext = existing as any;
                if (p.x !== undefined) ext.serverX = p.x;
                if (p.y !== undefined) ext.serverY = p.y;
                if (p.vx !== undefined) ext.vx = p.vx;
                if (p.vy !== undefined) ext.vy = p.vy;
                if (p.rotation !== undefined) ext.targetRotation = p.rotation;
                
                // Other stats sync
                if (p.health !== undefined) existing.health = p.health;
                if (p.score !== undefined) existing.score = p.score;
                if (p.lives !== undefined) existing.lives = p.lives;
                if (p.shieldUntil !== undefined) existing.shieldUntil = p.shieldUntil;
                if (p.isAlive !== undefined) existing.isAlive = p.isAlive;
             }
          } else {
             // Sync our own stats updated by others (kills)
             if (state.current.localPlayer) {
                if (p.score !== undefined && p.score > (state.current.localPlayer.score || 0)) {
                   state.current.localPlayer.score = p.score;
                   setScore(p.score);
                }
                
                if (p.health !== undefined && (p.health !== state.current.localPlayer.health || (!p.isAlive && state.current.localPlayer.isAlive))) {
                   if (p.health < state.current.localPlayer.health) {
                      (state.current as any).lastDamageTime = Date.now();
                   }
                   if (!p.isAlive && state.current.localPlayer.isAlive) {
                      if (state.current.localPlayer.shieldUntil && Date.now() < state.current.localPlayer.shieldUntil) {
                          // Ignore delayed death packets if we just respawned and are shielded
                      } else {
                          state.current.localPlayer.isAlive = false;
                          state.current.isDead = true;
                          setIsAlive(false);
                          state.current.keys.clear();
                          if (room.gameMode !== 'SOLO_RESPAWN' && p.lives !== undefined && p.lives <= 0) {
                              // Just stay dead, interval will handle match end
                          } else {
                              const respawnT = 5000;
                              (state.current as any).respawnTime = Date.now() + respawnT;
                              setRespawnCountdown(Math.ceil(respawnT / 1000));
                          }
                      }
                   }
                   if (!(state.current.localPlayer.shieldUntil && Date.now() < state.current.localPlayer.shieldUntil)) {
                       state.current.localPlayer.health = p.health;
                       setHealth(p.health);
                       if (p.lives !== undefined) {
                           state.current.localPlayer.lives = p.lives;
                           setLives(p.lives);
                       }
                   }
                }
             }
          }
      });

      socket.on('player_shoot', (b) => {
         if (b.playerId !== user.uid) {
             state.current.bullets.push(b);
         }
      });

      const joinRoom = () => {
         socket.emit('join_room', { roomId, userId: user.uid, initialData: lp });
      };

      if (socket.connected) {
         joinRoom();
      } else {
         socket.on('connect', joinRoom);
      }

      // Listen to Remote Players for health / kills / score ONLY
      unsubPlayers = onSnapshot(collection(db, `rooms/${roomId}/players`), (snapshot) => {
        const lb: any[] = [];
        snapshot.docs.forEach(d => {
          const p = d.data() as PlayerState;
          if (p.matchId !== room.matchId) return;

          if (p.userId !== user.uid) {
            if ((p as any).aborted) {
               state.current.remotePlayers.delete(p.userId);
               return;
            }
            const existing = state.current.remotePlayers.get(p.userId);
            if (existing) {
               existing.health = p.health;
               existing.score = p.score;
               existing.lives = p.lives;
               existing.shieldUntil = p.shieldUntil;
               existing.isAlive = p.isAlive;
            }
          } else {

          }
          lb.push({ name: p.name, score: p.score, isMe: p.userId === user.uid });
        });
        
        // Include bots in leaderboard
        state.current.remotePlayers.forEach(rp => {
            if ((rp as any).isBot) {
                lb.push({ name: rp.name, score: rp.score || 0, isMe: false });
            }
        });
        
        lb.sort((a,b) => b.score - a.score);
        setLeaderboard(lb);
      });

    };
    initGame();

    // Input Listeners
    const canControl = () => state.current.isOnline && !state.current.matchEnded && state.current.localPlayer?.isAlive;

    const onKeyDown = (e: KeyboardEvent) => { if (canControl()) state.current.keys.add(e.code); };
    const onKeyUp = (e: KeyboardEvent) => state.current.keys.delete(e.code);
    const onMouseMove = (e: MouseEvent) => {
      if (!canControl()) return;
      const rect = canvas.getBoundingClientRect();
      state.current.mouse.x = e.clientX - rect.left;
      state.current.mouse.y = e.clientY - rect.top;
    };
    const onMouseDown = () => { if (canControl()) state.current.mouse.isDown = true; };
    const onMouseUp = () => state.current.mouse.isDown = false;
    
    // Virtual Joystick logic
    const touchMap = new Map<number, { type: 'left' | 'right', startX: number, startY: number, dragged: boolean }>();
    const maxJRadius = 40;
    
    const updateJoystickDOM = (type: 'left'|'right', x: number, y: number, opacity: string, baseX?: number, baseY?: number) => {
       const el = document.getElementById(`joystick-${type}-knob`);
       const base = document.getElementById(`joystick-${type}-base`);
       if (el) {
          el.style.left = `${x}px`;
          el.style.top = `${y}px`;
          el.style.opacity = opacity;
       }
       if (base) {
          if (baseX !== undefined && baseY !== undefined) {
             base.style.left = `${baseX}px`;
             base.style.top = `${baseY}px`;
          }
          base.style.opacity = opacity;
       }
    };
    
    const onTouchStart = (e: TouchEvent) => {
       if (!canControl()) return;
       e.preventDefault();
       for (let i = 0; i < e.changedTouches.length; i++) {
          const t = e.changedTouches[i];
          const rect = canvas.getBoundingClientRect();
          const tx = t.clientX - rect.left;
          const ty = t.clientY - rect.top;
          const type = tx < canvas.width / 2 ? 'left' : 'right';
          touchMap.set(t.identifier, { type, startX: tx, startY: ty, dragged: false });
          updateJoystickDOM(type, tx, ty, '1', tx, ty);
          
          if (type === 'right') {
             state.current.joystickShoot.active = true;
             state.current.joystickShoot.dragDist = 0;
             if (state.current.localPlayer) {
                state.current.joystickShoot.angle = state.current.localPlayer.rotation;
             }
          }
       }
    };
    
    const onTouchMove = (e: TouchEvent) => {
       e.preventDefault();
       for (let i = 0; i < e.changedTouches.length; i++) {
          const t = e.changedTouches[i];
          const data = touchMap.get(t.identifier);
          if (data) {
             const rect = canvas.getBoundingClientRect();
             const tx = t.clientX - rect.left;
             const ty = t.clientY - rect.top;
             let dx = tx - data.startX;
             let dy = ty - data.startY;
             const dist = Math.sqrt(dx*dx + dy*dy);
             
             if (dist > maxJRadius) {
                 dx = (dx / dist) * maxJRadius;
                 dy = (dy / dist) * maxJRadius;
             }
             
             if (dist > 20) {
                 data.dragged = true;
             }
             
             updateJoystickDOM(data.type, data.startX + dx, data.startY + dy, '1');
             
             if (data.type === 'left') {
                 if (dist > 5) {
                    const norm = Math.sqrt(dx*dx + dy*dy);
                    state.current.joystickMove.dx = dx / norm;
                    state.current.joystickMove.dy = dy / norm;
                 } else {
                    state.current.joystickMove.dx = 0;
                    state.current.joystickMove.dy = 0;
                 }
             } else {
                 state.current.joystickShoot.dragDist = dist;
                 if (dist > 5) {
                    state.current.joystickShoot.angle = Math.atan2(dy, dx);
                 }
             }
          }
       }
    };
    
    const onTouchEnd = (e: TouchEvent) => {
       for (let i = 0; i < e.changedTouches.length; i++) {
          const t = e.changedTouches[i];
          const data = touchMap.get(t.identifier);
          if (data) {
             const rect = canvas.getBoundingClientRect();
             const tx = t.clientX - rect.left;
             const ty = t.clientY - rect.top;
             const dx = tx - data.startX;
             const dy = ty - data.startY;
             const dist = Math.sqrt(dx*dx + dy*dy);

             updateJoystickDOM(data.type, -100, -100, '0');
             touchMap.delete(t.identifier);
             if (data.type === 'left') {
                 state.current.joystickMove.dx = 0;
                 state.current.joystickMove.dy = 0;
             } else {
                 state.current.joystickShoot.active = false;
                 if (data.dragged && dist < 20) {
                     state.current.joystickShoot.justReleased = false; // Cancel attack
                 } else {
                     state.current.joystickShoot.justReleased = true;
                     state.current.joystickShoot.wasAutoAim = !data.dragged;
                 }
             }
          }
       }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mouseup', onMouseUp);
    if (containerRef.current) {
        containerRef.current.addEventListener('touchstart', onTouchStart, { passive: false });
        containerRef.current.addEventListener('touchmove', onTouchMove, { passive: false });
        containerRef.current.addEventListener('touchend', onTouchEnd);
        containerRef.current.addEventListener('touchcancel', onTouchEnd);
    }

    // Game Loop
    let animationId: number;
    let lastTime: number | null = null;
    const loop = (time: number) => {
       animationId = requestAnimationFrame(loop);
       if (lastTime === null) {
          lastTime = time;
          return;
       }
       let dt = (time - lastTime) / 1000;
       if (dt > 0.1) dt = 0.1; // clamp delta
       if (dt <= 0) dt = 0.016; // strict fallback
       lastTime = time;
       update(dt);
       draw(ctx);
    };
    animationId = requestAnimationFrame(loop);

    return () => {
      if (containerRef.current) {
        resizeObserver.unobserve(containerRef.current);
      }
      resizeObserver.disconnect();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('mouseup', onMouseUp);
      if (containerRef.current) {
         containerRef.current.removeEventListener('touchstart', onTouchStart);
         containerRef.current.removeEventListener('touchmove', onTouchMove);
         containerRef.current.removeEventListener('touchend', onTouchEnd);
         containerRef.current.removeEventListener('touchcancel', onTouchEnd);
      }
      cancelAnimationFrame(animationId);
      if (unsubRoom) unsubRoom();
      if (unsubPlayers) unsubPlayers();
      if (socketRef.current) {
         socketRef.current.off('connect');
         socketRef.current.off('room_state');
         socketRef.current.off('player_joined');
         socketRef.current.off('player_left');
         socketRef.current.off('sync_player');
         socketRef.current.off('player_shoot');
      }
    };
  }, []);

  useEffect(() => {
    const handleKillEvent = (ev: KillEvent) => {
       setKillFeed(prev => {
          const now = Date.now();
          const updated = [...prev, ev].filter(k => now - k.timestamp < 5000).slice(-4);
          return updated;
       });
    };
    socket.on('kill_event', handleKillEvent);
    
    if (!room) return;
    setRoomName(room.name || 'SECTOR');
    if (room.status === 'inactive' && room.matchId) setMatchEnded(true);
    if (room.matchEndTime) matchEndTimeRef.current = room.matchEndTime;
    
    return () => {
       socket.off('kill_event', handleKillEvent);
    };
  }, [room]);
  useEffect(() => {
    const int = setInterval(() => {
       // Check if there's only 1 player/team alive when there was more than 1
       if (!matchEnded) {
          let aliveCount = 0;
          let totalCount = 0;
          const aliveDuoTeams = new Set<number>();
          let aliveSoloCount = 0;

          if (state.current.localPlayer) {
             totalCount++;
             if (state.current.localPlayer.isAlive || (state.current.localPlayer.lives ?? 1) > 0) {
                 aliveCount++;
                 if (room.gameMode === 'DUO') {
                     aliveDuoTeams.add(getTeam(user.uid));
                 } else {
                     aliveSoloCount++;
                 }
             }
          }

          state.current.remotePlayers.forEach((p, rId) => {
             totalCount++;
             if (p.isAlive || (p.lives ?? 1) > 0) {
                 aliveCount++;
                 if (room.gameMode === 'DUO') {
                     aliveDuoTeams.add(getTeam(rId));
                 } else {
                     aliveSoloCount++;
                 }
             }
          });
          
          if (totalCount > state.current.maxTotalCount) {
              state.current.maxTotalCount = totalCount;
          }
          
          let shouldEnd = false;
          let actualHumansConnected = state.current.localPlayer ? 1 : 0;
          state.current.remotePlayers.forEach(p => {
              if (!(p as any).isBot) actualHumansConnected++;
          });

          if (!room.isBotMode && actualHumansConnected < 2) {
              handleReturnToLobby();
              return;
          }

          // Only end if we ever had a valid multiplayer session going (at least 2 players)
          if (state.current.maxTotalCount >= 2) {
             if (room.gameMode === 'DUO') {
                 if (aliveDuoTeams.size <= 1) shouldEnd = true;
             } else {
                 if (aliveSoloCount <= 1) shouldEnd = true;
             }
             if (totalCount < 2) {
                 // Everyone else left, instantly return to lobby!
                 handleReturnToLobby();
                 return;
             }
          }

          // Real-player room auto-exit if fewer than 2 players remain on the map
          let connectedHumanCount = state.current.localPlayer && (!state.current.isDead || room.gameMode === 'SOLO_RESPAWN') ? 1 : 0;
          state.current.remotePlayers.forEach((p) => {
              if (!p.isBot && (p.isAlive || room.gameMode === 'SOLO_RESPAWN')) {
                  connectedHumanCount++;
              }
          });
          if (!room.isBotMode && connectedHumanCount < 2) {
              shouldEnd = true;
          }

          if (shouldEnd) {
             setMatchEnded(true);
          }
       }

       if (matchEndTimeRef.current) {
          let remain = Math.floor((matchEndTimeRef.current - Date.now()) / 1000);
          if (remain <= 0) {
             remain = 0;
             if (!matchEnded) {
                setMatchEnded(true);
             }
          }
          setTimeLeft(remain);
       }
       
       // Respawn timer check
       if (state.current.isDead && state.current.localPlayer && (state.current as any).respawnTime) {
           let remain = Math.ceil(((state.current as any).respawnTime - Date.now()) / 1000);
           
           if (remain <= 0) {
                (state.current as any).respawnTime = null;
                setRespawnCountdown(null);
                
                const canRespawn = room.gameMode === 'SOLO_RESPAWN' || (state.current.localPlayer.lives ?? 0) > 0;
                if (canRespawn && !state.current.matchEnded) {
                    setIsAlive(true);
                    setHealth(100);
                    state.current.isDead = false;
                    
                    if (state.current.localPlayer) {
                      const shieldTime = Date.now() + 3000;
                      const spawn = getValidSpawn(state.current.mapObjects, state.current.remotePlayers);
                      state.current.localPlayer.x = spawn.x;
                      state.current.localPlayer.y = spawn.y;
                      state.current.localPlayer.health = 100;
                      state.current.localPlayer.isAlive = true;
                      state.current.localPlayer.shieldUntil = shieldTime;
                      state.current.ammo = GAME_CONSTANTS.AMMO_CAPACITY[state.current.localPlayer.tankType] || 3;
                      
                      setDoc(doc(db, `rooms/${roomId}/players`, user.uid), {
                         health: 100,
                         isAlive: true,
                         x: spawn.x,
                         y: spawn.y,
                         shieldUntil: shieldTime,
                         updatedAt: serverTimestamp()
                      }, { merge: true }).catch(()=>{});
                    }
                }
           } else {
                setRespawnCountdown(remain);
           }
       }

       // Update Leaderboard
       const lb: any[] = [];
       if (state.current.localPlayer) {
          lb.push({ name: state.current.localPlayer.name, score: state.current.localPlayer.score || 0, isMe: true });
       }
       state.current.remotePlayers.forEach((rp, id) => {
          lb.push({ name: rp.name, score: rp.score || 0, isMe: false });
       });
       lb.sort((a,b) => b.score - a.score);
       setLeaderboard(lb);

    }, 1000);
    return () => clearInterval(int);
  }, [matchEnded, room.hostId, room.id, user.uid]);

  useEffect(() => {
    if (matchEnded || (!isAlive && lives === 0)) {
       const timer = setTimeout(() => {
          handleReturnToLobby();
       }, 10000);
       return () => clearTimeout(timer);
    }
  }, [matchEnded, isAlive, lives]);

  const handleReturnToLobby = () => {
    if (room.hostId === user.uid) {
        updateDoc(doc(db, 'rooms', room.id), { status: 'inactive' }).catch(()=>{});
        socketRef.current?.emit('update_room', { id: room.id, status: 'inactive', matchId: null });
    }
    onExit();
  };

  // Update Game Logic
  const update = (dt: number) => {
    const s = state.current;
    if (!s.localPlayer || !s.isOnline) return;

    const now = Date.now();
    const canPlay = !s.isDead && !s.matchEnded && s.localPlayer.isAlive;

    // Clear inputs if can't play
    if (!canPlay) {
       s.keys.clear();
       s.mouse.isDown = false;
       s.joystickMove.dx = 0;
       s.joystickMove.dy = 0;
       s.joystickShoot.active = false;
    }

    // Movement
    let dx = 0;
    let dy = 0;
    
    if (s.joystickMove.dx !== 0 || s.joystickMove.dy !== 0) {
      dx = s.joystickMove.dx;
      dy = s.joystickMove.dy;
    } else {
      if (s.keys.has('KeyW') || s.keys.has('ArrowUp')) dy -= 1;
      if (s.keys.has('KeyS') || s.keys.has('ArrowDown')) dy += 1;
      if (s.keys.has('KeyA') || s.keys.has('ArrowLeft')) dx -= 1;
      if (s.keys.has('KeyD') || s.keys.has('ArrowRight')) dx += 1;
      // Normalize Keyboard Input
      if (dx !== 0 && dy !== 0) {
        const len = Math.sqrt(dx*dx + dy*dy);
        dx /= len; dy /= len;
      }
    }

    const tankSpeed = GAME_CONSTANTS.PLAYER_SPEED[s.localPlayer.tankType as keyof typeof GAME_CONSTANTS.PLAYER_SPEED] || 4.5;
    const speed = tankSpeed * 60 * dt; // speed per second
    
    const tryMove = (nx: number, ny: number) => {
       // Bounds
       if (nx < 80 + 20 || nx > GAME_CONSTANTS.WORLD_WIDTH - 80 - 20 || ny < 80 + 20 || ny > GAME_CONSTANTS.WORLD_HEIGHT - 80 - 20) return false;
       // Map Objects
       const pr = 20; // radius
       for (let obj of s.mapObjects) {
          const testX = Math.max(obj.x, Math.min(nx, obj.x + obj.width));
          const testY = Math.max(obj.y, Math.min(ny, obj.y + obj.height));
          const dist = Math.sqrt(Math.pow(nx - testX, 2) + Math.pow(ny - testY, 2));
          if (dist < pr) return false;
       }
       return true;
    };

    if (dx !== 0 || dy !== 0) {
       let newX = s.localPlayer.x + dx * speed;
       let newY = s.localPlayer.y + dy * speed;
       
       if (tryMove(newX, newY)) {
          s.localPlayer.x = newX;
          s.localPlayer.y = newY;
       } else if (tryMove(newX, s.localPlayer.y)) {
          s.localPlayer.x = newX;
       } else if (tryMove(s.localPlayer.x, newY)) {
          s.localPlayer.y = newY;
       }
    }

    const cWidth = canvasRef.current?.width || GAME_CONSTANTS.CANVAS_WIDTH;
    const cHeight = canvasRef.current?.height || GAME_CONSTANTS.CANVAS_HEIGHT;

    // Camera clamp
    let camX = cWidth / 2 - s.localPlayer.x;
    let camY = cHeight / 2 - s.localPlayer.y;
    const maxCx = 0;
    const minCx = cWidth - GAME_CONSTANTS.WORLD_WIDTH;
    const maxCy = 0;
    const minCy = cHeight - GAME_CONSTANTS.WORLD_HEIGHT;

    if (cWidth > GAME_CONSTANTS.WORLD_WIDTH) {
       camX = (cWidth - GAME_CONSTANTS.WORLD_WIDTH) / 2;
    } else { camX = Math.max(minCx, Math.min(maxCx, camX)); }

    if (cHeight > GAME_CONSTANTS.WORLD_HEIGHT) {
       camY = (cHeight - GAME_CONSTANTS.WORLD_HEIGHT) / 2;
    } else { camY = Math.max(minCy, Math.min(maxCy, camY)); }

    s.cameraX = camX;
    s.cameraY = camY;

    // Aiming
    const screenPlayerX = s.localPlayer.x + s.cameraX;
    const screenPlayerY = s.localPlayer.y + s.cameraY;
    if (s.joystickShoot.active) {
      s.localPlayer.rotation = s.joystickShoot.angle;
    } else if (!('ontouchstart' in window)) {
      s.localPlayer.rotation = Math.atan2(s.mouse.y - screenPlayerY, s.mouse.x - screenPlayerX);
    }
    
    // Interpolate remote players and simulate bots
    s.remotePlayers.forEach(p => {
       const anyP = p as any;
       if (anyP.isBot && room.hostId === user.uid) {
           if (!p.isAlive) {
              if (anyP.respawnTimer) {
                 anyP.respawnTimer -= dt;
                 if (anyP.respawnTimer <= 0) {
                     anyP.respawnTimer = 0;
                     if ((p.lives ?? 3) > 0) {
                         const spawn = getValidSpawn(s.mapObjects, s.remotePlayers);
                         p.x = spawn.x;
                         p.y = spawn.y;
                         p.health = 100;
                         p.isAlive = true;
                         p.shieldUntil = now + 3000;
                     }
                 }
              } else {
                 anyP.respawnTimer = 5; // 5 sec
              }
            } else {
               // BOT AI
               let target: any = null;
               
               if (anyP.lastAttackerId) {
                   if (anyP.lastAttackerId === s.localPlayer?.userId && s.localPlayer?.isAlive) {
                       target = s.localPlayer;
                   } else {
                       const att = s.remotePlayers.get(anyP.lastAttackerId);
                       if (att && att.isAlive) {
                           target = att;
                       }
                   }
               }
               
               if (!target) {
                   let minDist = 1800;
                   let closest: any = null;
                   
                   const checkTarget = (t: any) => {
                       if (room.gameMode === 'DUO' && getTeam(p.userId) === getTeam(t.userId)) return; // Don't target teammates
                       
                       const d = Math.hypot(t.x - p.x, t.y - p.y);
                       if (d < minDist && checkLineOfSight(p.x, p.y, t.x, t.y, s.mapObjects)) {
                           minDist = d;
                           closest = t;
                       }
                   };
                   
                   if (s.localPlayer && s.localPlayer.isAlive) checkTarget(s.localPlayer);
                   s.remotePlayers.forEach(rp => {
                       if (rp.userId !== p.userId && rp.isAlive) checkTarget(rp);
                   });
                   
                   if (closest) target = closest;
               }

               if (anyP.botTargetRot === undefined) anyP.botTargetRot = p.rotation;
               if (anyP.botMoveRot === undefined) anyP.botMoveRot = p.rotation;
               
               let distToTarget = target ? Math.hypot(target.x - p.x, target.y - p.y) : Infinity;
               let canSeeTarget = target ? checkLineOfSight(p.x, p.y, target.x, target.y, s.mapObjects) : false;
               
               if (target && canSeeTarget) {
                   const angleToTarget = Math.atan2(target.y - p.y, target.x - p.x);
                   anyP.botTargetRot = angleToTarget; // Aim at target
                   
                   if (p.health < 25 && p.health < target.health) {
                       anyP.botState = 'flee';
                       anyP.botMoveRot = angleToTarget + Math.PI + ((Math.random() - 0.5) * 0.5);
                   } else if (distToTarget < 250) {
                       anyP.botState = 'strafe';
                       if (!anyP.strafeDir || Math.random() < 0.05) {
                           anyP.strafeDir = Math.random() < 0.5 ? 1 : -1;
                       }
                       let strafeAngle = angleToTarget + (Math.PI / 2.5) * anyP.strafeDir;
                       if (distToTarget < 150) strafeAngle += Math.PI * 0.2 * anyP.strafeDir; 
                       anyP.botMoveRot = strafeAngle;
                   } else {
                       anyP.botState = 'chase';
                       anyP.botMoveRot = angleToTarget;
                   }
               } else {
                   anyP.botState = 'wander';
                   if (Math.random() < 0.5 * dt) {
                       anyP.botMoveRot += (Math.random() - 0.5) * Math.PI;
                   }
                   anyP.botTargetRot = anyP.botMoveRot; // Look where walking
               }
               
               const speed = (GAME_CONSTANTS.PLAYER_SPEED[p.tankType as keyof typeof GAME_CONSTANTS.PLAYER_SPEED] || 3) * 60 * dt; 
               let nx = p.x + Math.cos(anyP.botMoveRot) * speed;
               let ny = p.y + Math.sin(anyP.botMoveRot) * speed;
               
               const checkBotCollision = (cx: number, cy: number) => {
                   if (cx < 100 || cx > GAME_CONSTANTS.WORLD_WIDTH - 100 || cy < 100 || cy > GAME_CONSTANTS.WORLD_HEIGHT - 100) return true;
                   for (let obj of s.mapObjects) {
                       const testX = Math.max(obj.x, Math.min(cx, obj.x + obj.width));
                       const testY = Math.max(obj.y, Math.min(cy, obj.y + obj.height));
                       if (Math.hypot(cx - testX, cy - testY) < 25) return true;
                   }
                   return false;
               };

               let collision = checkBotCollision(nx, ny);

               if (collision) {
                   // Wall sliding for bots
                   if (!checkBotCollision(nx, p.y)) {
                       p.x = nx;
                       anyP.isTurningFromWall = false;
                   } else if (!checkBotCollision(p.x, ny)) {
                       p.y = ny;
                       anyP.isTurningFromWall = false;
                   } else {
                       if (!anyP.isTurningFromWall) {
                          anyP.isTurningFromWall = true;
                          anyP.hitWallRot = anyP.botMoveRot + Math.PI / 2 * (Math.random() < 0.5 ? 1 : -1);
                       }
                       anyP.botMoveRot = anyP.hitWallRot;
                   }
               } else {
                   anyP.isTurningFromWall = false;
                   p.x = nx; p.y = ny;
               }

               let diff = anyP.botTargetRot - p.rotation;
               while (diff < -Math.PI) diff += Math.PI * 2;
               while (diff > Math.PI) diff -= Math.PI * 2;
               p.rotation += diff * 12 * dt; // Turn towards aim faster

               const reloadSpeed = GAME_CONSTANTS.RELOAD_SPEED[p.tankType as keyof typeof GAME_CONSTANTS.RELOAD_SPEED] || 1000;
               // Stinger aims better, shoots faster
               const isStinger = p.tankType === 'scout';
               const aimThreshold = isStinger ? 0.3 : 0.6;
               const delay = isStinger ? 100 : 300;

               if (target && canSeeTarget && now - (anyP.lastFireTime || 0) > reloadSpeed + delay && Math.abs(diff) < aimThreshold) {
                       anyP.lastFireTime = now;
                       // Add a slight inaccuracy so bots aren't god-tiers
                       const inaccuracy = (Math.random() - 0.5) * (isStinger ? 0.05 : 0.2);
                       const fireRot = p.rotation + inaccuracy;
                       
                       const bx = p.x + Math.cos(fireRot) * 20;
                       const by = p.y + Math.sin(fireRot) * 20;
                       const bulletSpeed = GAME_CONSTANTS.BULLET_SPEED[p.tankType as keyof typeof GAME_CONSTANTS.BULLET_SPEED] || 18;
                       const bSize = GAME_CONSTANTS.BULLET_SIZE[p.tankType as keyof typeof GAME_CONSTANTS.BULLET_SIZE] || 6;
                       s.bullets.push({
                           id: `bot_b_${Math.random()}`,
                           playerId: p.userId,
                           x: bx,
                           y: by,
                           vx: Math.cos(fireRot) * bulletSpeed,
                           vy: Math.sin(fireRot) * bulletSpeed,
                           startX: bx,
                           startY: by,
                           range: GAME_CONSTANTS.BULLET_RANGE[p.tankType as keyof typeof GAME_CONSTANTS.BULLET_RANGE] || 500,
                           createdAt: now,
                           size: bSize,
                           color: p.color
                       });
                   }
           }
            if (anyP.isBot && room.hostId === user.uid && p.isAlive) {
                if (!anyP.lastSync || now - anyP.lastSync > 150) {
                    anyP.lastSync = now;
                    socketRef.current?.emit('sync_player', {
                        userId: p.userId,
                        x: Math.round(p.x),
                        y: Math.round(p.y),
                        rotation: Math.round(p.rotation * 100) / 100,
                        health: p.health,
                        score: p.score,
                        isAlive: p.isAlive,
                        lives: p.lives
                    });
                }
            }
       } else if (anyP.serverX !== undefined) {
          anyP.serverX += (anyP.vx || 0) * dt;
          anyP.serverY += (anyP.vy || 0) * dt;
          if (anyP.serverX < 100) anyP.serverX = 100;
          if (anyP.serverX > GAME_CONSTANTS.WORLD_WIDTH - 100) anyP.serverX = GAME_CONSTANTS.WORLD_WIDTH - 100;
          if (anyP.serverY < 100) anyP.serverY = 100;
          if (anyP.serverY > GAME_CONSTANTS.WORLD_HEIGHT - 100) anyP.serverY = GAME_CONSTANTS.WORLD_HEIGHT - 100;
          p.x += (anyP.serverX - p.x) * 15 * dt;
          p.y += (anyP.serverY - p.y) * 15 * dt;
          
          // Smoother rotation interp with 360 wrap handling
          let diff = anyP.targetRotation - p.rotation;
          while (diff < -Math.PI) diff += Math.PI * 2;
          while (diff > Math.PI) diff -= Math.PI * 2;
          p.rotation += diff * 20 * dt;
       }
    });

    // Auto-heal logic
    const lastDmg = (s as any).lastDamageTime || 0;
    const lastAtk = s.lastFireTime || 0;
    if (canPlay && now - lastDmg > 3000 && now - lastAtk > 3000 && s.localPlayer.health < GAME_CONSTANTS.MAX_HEALTH) {
       s.localPlayer.health = Math.min(GAME_CONSTANTS.MAX_HEALTH, s.localPlayer.health + (13 * dt)); // 13 HP/sec
    }

    // Battle Royale Zone Logic Removed as per request

    if (canPlay) {
       const visualHp = Math.max(0, Math.ceil(s.localPlayer.health));
       if (visualHp !== (s as any).lastVisualHp) {
          (s as any).lastVisualHp = visualHp;
          setHealth(visualHp);
       }

       if (visualHp <= 0 && s.localPlayer.isAlive) {
          s.isDead = true;
          setIsAlive(false);
          s.localPlayer.isAlive = false;
          const newLives = room.gameMode === 'SOLO_RESPAWN' ? 999 : Math.max(0, (s.localPlayer.lives ?? 1) - 1);
          s.localPlayer.lives = newLives;
          setLives(newLives);
          
          if (newLives === 0) {
              updateDoc(doc(db, `rooms/${roomId}`), {
                  players: arrayRemove(s.userId)
              }).catch(()=>{});
              setDoc(doc(db, `rooms/${roomId}/players`, s.userId), { aborted: true }, { merge: true });
          }
          
          if (newLives > 0) {
              const spawn = getValidSpawn(s.mapObjects, s.remotePlayers);
              s.localPlayer.x = spawn.x;
              s.localPlayer.y = spawn.y;
              (s as any).respawnTime = Date.now() + 5000;
              setRespawnCountdown(5);
              socketRef.current?.emit('sync_player', {
                  x: spawn.x,
                  y: spawn.y,
                  vx: 0,
                  vy: 0,
                  rotation: 0
              });
          }
          
          setDoc(doc(db, `rooms/${roomId}/players`, s.userId), { 
              health: 0,
              isAlive: false,
              lives: newLives 
          }, { merge: true });
       }

       // Sync health up to DB ONLY when it changes locally via zone damage or healing
       if (s.localPlayer.isAlive && visualHp !== (s as any).lastVisualHpSynced) {
          (s as any).lastVisualHpSynced = visualHp;
          if (now - ((s as any).lastHealthSync || 0) > 300) {
             (s as any).lastHealthSync = now;
             setDoc(doc(db, `rooms/${roomId}/players`, s.userId), { health: visualHp }, { merge: true });
          }
       }
    }

    // Sync via WebSockets (20Hz)
    const frameVx = dx * speed;
    const frameVy = dy * speed;
    const sState = s as any;

    if (canPlay && now - s.lastSyncTime > 50) {
       s.lastSyncTime = now;
       sState.syncVx = frameVx;
       sState.syncVy = frameVy;
       sState.syncRot = s.localPlayer.rotation;
       
       socketRef.current?.emit('sync_player', {
           x: s.localPlayer.x,
           y: s.localPlayer.y,
           vx: frameVx,
           vy: frameVy,
           rotation: s.localPlayer.rotation
       });
    }

    // Reload logic
    const maxAmmo = GAME_CONSTANTS.AMMO_CAPACITY[s.localPlayer.tankType] || 3;
    const reloadSpeed = GAME_CONSTANTS.RELOAD_SPEED[s.localPlayer.tankType] || 1000;
    
    if (canPlay) {
        if (s.ammo < maxAmmo) {
            if (now - s.lastReloadTime > reloadSpeed) {
                s.ammo++;
                s.lastReloadTime = now;
            }
        } else {
            s.lastReloadTime = now;
        }

        // Shooting
        if ((s.mouse.isDown && !('ontouchstart' in window)) || s.joystickShoot.justReleased) {
           const fireRate = GAME_CONSTANTS.FIRE_RATE[s.localPlayer.tankType];
           if (now - s.lastFireTime > fireRate && s.ammo > 0) {
              s.lastFireTime = now;
              s.ammo--;
              if (s.ammo === maxAmmo - 1) {
                 s.lastReloadTime = now; // Start reload
              }
           
          // Auto aim
          if (s.joystickShoot.wasAutoAim && s.autoAimEnabled) {
             let target: any = null;
             let minDist = Infinity;
             s.remotePlayers.forEach(rp => {
                 if (rp.isAlive) {
                     if (room.gameMode === 'DUO' && getTeam(rp.userId) === getTeam(s.userId)) return;
                     const d = Math.hypot(rp.x - s.localPlayer!.x, rp.y - s.localPlayer!.y);
                     if (d < minDist && checkLineOfSight(s.localPlayer!.x, s.localPlayer!.y, rp.x, rp.y, s.mapObjects)) {
                         minDist = d;
                         target = rp;
                     }
                 }
             });
             if (target) {
                 s.lastKnownEnemyPos = { x: target.x, y: target.y };
                 s.localPlayer.rotation = Math.atan2(target.y - s.localPlayer!.y, target.x - s.localPlayer!.x);
             } else if (s.lastKnownEnemyPos) {
                 s.localPlayer.rotation = Math.atan2(s.lastKnownEnemyPos.y - s.localPlayer!.y, s.lastKnownEnemyPos.x - s.localPlayer!.x);
             }
          }

          const bx = s.localPlayer.x + Math.cos(s.localPlayer.rotation) * 20;
          const by = s.localPlayer.y + Math.sin(s.localPlayer.rotation) * 20;
          const tankSpeed = GAME_CONSTANTS.BULLET_SPEED[s.localPlayer.tankType as keyof typeof GAME_CONSTANTS.BULLET_SPEED] || 18;
          const vx = Math.cos(s.localPlayer.rotation) * tankSpeed;
          const vy = Math.sin(s.localPlayer.rotation) * tankSpeed;
          const range = GAME_CONSTANTS.BULLET_RANGE[s.localPlayer.tankType] || 500;
          const bSize = GAME_CONSTANTS.BULLET_SIZE[s.localPlayer.tankType as keyof typeof GAME_CONSTANTS.BULLET_SIZE] || 6;
          
          const newBullet: Bullet = {
             id: Math.random().toString(36).substr(2, 9),
             playerId: s.userId,
             x: bx,
             y: by,
             vx,
             vy,
             startX: bx,
             startY: by,
             range: range,
             size: bSize,
             createdAt: now,
             color: s.localPlayer.color
          };
          s.bullets.push(newBullet);
          
          // Send to WebSockets instead of DB
          socketRef.current?.emit('player_shoot', newBullet);
       }
       s.joystickShoot.justReleased = false;
    }
    }

    // Update Bullets
    for (let i = s.bullets.length - 1; i >= 0; i--) {
       let b = s.bullets[i];
       b.x += b.vx * 60 * dt;
       b.y += b.vy * 60 * dt;

       let remove = false;
       const distTraveled = Math.hypot(b.x - (b.startX || 0), b.y - (b.startY || 0));
       if (distTraveled >= (b.range || 500)) {
           remove = true;
       }
       
       const sz = b.size || 6;
       if (b.x - sz < 80 || b.x + sz > GAME_CONSTANTS.WORLD_WIDTH - 80 || b.y - sz < 80 || b.y + sz > GAME_CONSTANTS.WORLD_HEIGHT - 80) {
          remove = true;
       } else if (!remove) {
          // Object Collision
          for (let obj of s.mapObjects) {
             if (b.x + sz > obj.x && b.x - sz < obj.x + obj.width && b.y + sz > obj.y && b.y - sz < obj.y + obj.height) {
                remove = true; break;
             }
          }
       }

       // Victim removes incoming bullet
       if (!remove && b.playerId !== s.userId && !b.playerId.startsWith('BOT_')) { 
          const dist = Math.hypot(b.x - s.localPlayer.x, b.y - s.localPlayer.y);
          if (dist < 20 + sz) {
              remove = true;
          }
       }

       // Player Hit (Shooter Authority)
       if (!remove && b.playerId === s.userId) { // Can only hit others with MY bullets
           const sz = b.size || 6;
           for (let [rId, rp] of s.remotePlayers.entries()) {
               if (remove || !rp.isAlive) continue;
               
               const dist = Math.sqrt(Math.pow(b.x - rp.x, 2) + Math.pow(b.y - rp.y, 2));
               if (dist < 20 + sz) {
                   remove = true;
                   
                   // TDM friendly fire protection
                   if (room.gameMode === 'DUO' && getTeam(s.userId) === getTeam(rId)) {
                       break; // skip damage
                   }
                   
                   // Don't damage shielded players
                   if (rp.shieldUntil && Date.now() < rp.shieldUntil) {
                       break;
                   }
                   
                   // Apply damage to remote player (optimistically local then DB)
                   const dmg = GAME_CONSTANTS.DAMAGE[s.localPlayer.tankType] || 25;
                   const newHp = Math.max(0, rp.health - dmg);
                   rp.health = newHp;
                   
                   let isAlive = true;
                   let newLives = rp.lives ?? (room.gameMode === 'SOLO_RESPAWN' ? 3 : 1);
                   
                   if (newHp === 0) {
                      isAlive = false;
                      rp.isAlive = false;
                      if (room.gameMode !== 'SOLO_RESPAWN') newLives = Math.max(0, newLives - 1);
                      rp.lives = newLives;
                      
                      // Award self point
                      s.localPlayer.score = (s.localPlayer.score || 0) + 1;
                      setScore(s.localPlayer.score);
                      setDoc(doc(db, `rooms/${roomId}/players`, s.userId), { score: s.localPlayer.score }, { merge: true });
                      
                      updateDoc(doc(db, `rooms/${roomId}`), {
                         killEvents: arrayUnion({
                            id: Date.now().toString() + Math.random(),
                            killerName: s.localPlayer.name,
                            killerColor: GAME_CONSTANTS.COLORS?.[s.localPlayer.tankType] || '#10b981',
                            victimName: rp.name,
                            victimColor: rp.color || '#ef4444',
                            timestamp: Date.now()
                         })
                      }).catch(()=>{});
                   }
                   
                   // Broadcast damage via socket
                   if (!rp.isBot) {
                       socketRef.current?.emit('sync_player', {
                           userId: rId,
                           health: newHp,
                           isAlive: isAlive,
                           lives: newLives
                       });
                   } else {
                       rp.health = newHp;
                       rp.isAlive = isAlive;
                       rp.lives = newLives;
                       (rp as any).lastAttackerId = s.userId;
                   }
                   
                   break;
               }
           }
       } else if (!remove && b.playerId.startsWith('BOT_') && room.hostId === user.uid) {
           const shooterBot = s.remotePlayers.get(b.playerId);
           const dmg = GAME_CONSTANTS.DAMAGE[shooterBot?.tankType || 'balanced'] || 25;
           
           // Check against local player
           const distToLocal = Math.hypot(b.x - s.localPlayer.x, b.y - s.localPlayer.y);
           if (distToLocal < 20 + (b.size || 6) && s.localPlayer.isAlive) {
               if (room.gameMode !== 'DUO' || getTeam(b.playerId) !== getTeam(s.userId)) {
               remove = true;
               if (!s.localPlayer.shieldUntil || Date.now() > s.localPlayer.shieldUntil) {
                   const newHp = Math.max(0, s.localPlayer.health - dmg);
                   if (newHp < s.localPlayer.health) (s as any).lastDamageTime = Date.now();
                   
                   s.localPlayer.health = newHp;
                   setHealth(newHp);
                   
                   if (newHp === 0) {
                       s.isDead = true;
                       setIsAlive(false);
                       s.localPlayer.isAlive = false;
                       const newLives = room.gameMode === 'SOLO_RESPAWN' ? 999 : Math.max(0, (s.localPlayer.lives ?? 1) - 1);
                       s.localPlayer.lives = newLives;
                       setLives(newLives);
                       
                       if (newLives === 0) {
                           updateDoc(doc(db, `rooms/${roomId}`), {
                               players: arrayRemove(s.userId)
                           }).catch(()=>{});
                       } else {
                           (s as any).respawnTime = Date.now() + 5000;
                           setRespawnCountdown(5);
                       }

                       if (shooterBot) {
                           shooterBot.score = (shooterBot.score || 0) + 1;
                           updateDoc(doc(db, `rooms/${roomId}`), {
                               killEvents: arrayUnion({
                                   id: Date.now().toString() + Math.random(),
                                   killerName: shooterBot.name,
                                   killerColor: shooterBot.color,
                                   victimName: s.localPlayer.name,
                                   victimColor: GAME_CONSTANTS.COLORS?.[s.localPlayer.tankType as keyof typeof GAME_CONSTANTS.COLORS] || '#ef4444',
                                   timestamp: Date.now()
                               })
                           }).catch(()=>{});
                       } else {
                           const killer = s.remotePlayers.get(b.playerId);
                           if (killer) {
                               killer.score = (killer.score || 0) + 1;
                               setDoc(doc(db, `rooms/${roomId}/players`, b.playerId), { score: killer.score }, { merge: true });
                           }
                           socketRef.current?.emit('kill_event', {
                               id: Math.random().toString(),
                               killerId: b.playerId,
                               killerName: killer?.name || 'UNKNOWN',
                               killerColor: killer?.color || '#fff',
                               victimId: s.userId,
                               victimName: s.localPlayer.name,
                               victimColor: s.localPlayer.color,
                               timestamp: Date.now()
                           });
                       }
                   }
                   setDoc(doc(db, `rooms/${roomId}/players`, s.userId), { 
                       health: newHp,
                       isAlive: newHp > 0,
                       lives: s.localPlayer.lives 
                   }, { merge: true });
               }
           }
           }
           
           // Check against remote players (including bots)
           if (!remove) {
               for (let [rId, rp] of s.remotePlayers.entries()) {
                   if (rId === b.playerId || !rp.isAlive) continue; // Don't hit self
                   
                   if (room.gameMode === 'DUO' && getTeam(b.playerId) === getTeam(rId)) continue;
                   
                   const d = Math.hypot(b.x - rp.x, b.y - rp.y);
                   if (d < 20 + (b.size || 6)) {
                       remove = true;
                       if (rp.shieldUntil && Date.now() < rp.shieldUntil) break;
                       
                       const newHp = Math.max(0, rp.health - dmg);
                       rp.health = newHp;
                       let isAlive = true;
                       let newLives = rp.lives ?? (room.gameMode === 'SOLO_RESPAWN' ? 3 : 1);
                       
                       if (newHp === 0) {
                          isAlive = false;
                          rp.isAlive = false;
                          if (room.gameMode !== 'SOLO_RESPAWN') newLives = Math.max(0, newLives - 1);
                          rp.lives = newLives;
                          
                          // Only increment score if the victim is a bot! Real players handle their own death.
                          if (rp.isBot) {
                              if (shooterBot) {
                                 shooterBot.score = (shooterBot.score || 0) + 1;
                              } else {
                                 if (b.playerId === s.userId) {
                                     const newScore = (s.localPlayer?.score || 0) + 1;
                                     if (s.localPlayer) s.localPlayer.score = newScore;
                                     setScore(newScore);
                                     setDoc(doc(db, `rooms/${roomId}/players`, s.userId), { score: newScore }, { merge: true });
                                 } else {
                                     const killer = s.remotePlayers.get(b.playerId);
                                     if (killer) {
                                         killer.score = (killer.score || 0) + 1;
                                         setDoc(doc(db, `rooms/${roomId}/players`, b.playerId), { score: killer.score }, { merge: true });
                                     }
                                 }
                              }
                              
                              socketRef.current?.emit('kill_event', {
                                 id: Math.random().toString(),
                                 killerId: b.playerId,
                                 killerName: b.playerId === s.userId ? s.localPlayer!.name : (s.remotePlayers.get(b.playerId)?.name || 'UNKNOWN'),
                                 killerColor: b.playerId === s.userId ? s.localPlayer!.color : (s.remotePlayers.get(b.playerId)?.color || '#fff'),
                                 victimId: rId,
                                 victimName: rp.name,
                                 victimColor: rp.color || '#ef4444',
                                 timestamp: Date.now()
                              });
                          }
                       }
                       
                       if (!rp.isBot) {
                           setDoc(doc(db, `rooms/${roomId}/players`, rId), {
                              health: newHp,
                              isAlive: isAlive,
                              lives: newLives
                           }, { merge: true });
                       } else {
                           rp.health = newHp;
                           rp.isAlive = isAlive;
                           rp.lives = newLives;
                           (rp as any).lastAttackerId = b.playerId;
                       }
                       break;
                   }
               }
           }
       }

       if (remove) s.bullets.splice(i, 1);
    }
  };

  // Drawing Logic
  const draw = (ctx: CanvasRenderingContext2D) => {
     const s = state.current;
     if (!s.localPlayer) return;

     const cWidth = canvasRef.current?.width || GAME_CONSTANTS.CANVAS_WIDTH;
     const cHeight = canvasRef.current?.height || GAME_CONSTANTS.CANVAS_HEIGHT;

     ctx.fillStyle = '#0f172a'; // Deep background
     ctx.fillRect(0, 0, cWidth, cHeight);

     ctx.save();
     
     // Camera translation
     ctx.translate(s.cameraX, s.cameraY);

     // Draw World Bounds
     ctx.fillStyle = '#1e293b';
     ctx.fillRect(0, 0, GAME_CONSTANTS.WORLD_WIDTH, GAME_CONSTANTS.WORLD_HEIGHT);

     // Border walls (thick walls)
     ctx.fillStyle = '#020617';

     ctx.fillRect(0, 0, GAME_CONSTANTS.WORLD_WIDTH, 80);
     ctx.fillRect(0, GAME_CONSTANTS.WORLD_HEIGHT - 80, GAME_CONSTANTS.WORLD_WIDTH, 80);
     ctx.fillRect(0, 0, 80, GAME_CONSTANTS.WORLD_HEIGHT);
     ctx.fillRect(GAME_CONSTANTS.WORLD_WIDTH - 80, 0, 80, GAME_CONSTANTS.WORLD_HEIGHT);
     
     // Grid
     ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
     ctx.lineWidth = 2;
     ctx.beginPath();
     for(let i=100; i<GAME_CONSTANTS.WORLD_WIDTH; i+=100) { ctx.moveTo(i, 80); ctx.lineTo(i, GAME_CONSTANTS.WORLD_HEIGHT - 80); }
     for(let i=100; i<GAME_CONSTANTS.WORLD_HEIGHT; i+=100) { ctx.moveTo(80, i); ctx.lineTo(GAME_CONSTANTS.WORLD_WIDTH - 80, i); }
     ctx.stroke();

     // Draw Map Objects
     s.mapObjects.forEach(obj => {
        if (obj.type === 'wall') {
           ctx.fillStyle = '#020617';
           ctx.strokeStyle = '#334155';
           ctx.lineWidth = 4;
           ctx.beginPath();
           ctx.roundRect(obj.x, obj.y, obj.width, obj.height, 8);
           ctx.fill(); ctx.stroke();
        } else {
           ctx.fillStyle = '#451a03';
           ctx.strokeStyle = '#92400e';
           ctx.lineWidth = 4;
           ctx.beginPath();
           ctx.roundRect(obj.x, obj.y, obj.width, obj.height, 4);
           ctx.fill(); ctx.stroke();
        }
     });

     // Draw Players
     const drawTank = (p: PlayerState, isMe: boolean) => {
        if (!p.isAlive) return;

        ctx.save();
        ctx.translate(p.x, p.y);
        
        // Draw aim indicator for self
        const isTouch = 'ontouchstart' in window;
        if (isMe && (!isTouch || (s.joystickShoot.active && s.joystickShoot.dragDist > 20))) {
           ctx.save();
           ctx.rotate(p.rotation);
           const bRange = GAME_CONSTANTS.BULLET_RANGE[p.tankType] || 500;
           const bSize = GAME_CONSTANTS.BULLET_SIZE[p.tankType as keyof typeof GAME_CONSTANTS.BULLET_SIZE] || 6;
           
           let traceDist = bRange;
           for (let dist = 15; dist <= bRange; dist += Math.max(5, bSize/2)) {
              let cx = p.x + Math.cos(p.rotation) * dist;
              let cy = p.y + Math.sin(p.rotation) * dist;
              let hit = false;
              for (let obj of s.mapObjects) {
                 if (cx + bSize > obj.x && cx - bSize < obj.x + obj.width && cy + bSize > obj.y && cy - bSize < obj.y + obj.height) {
                    hit = true; break;
                 }
              }
              if (cx + bSize > GAME_CONSTANTS.WORLD_WIDTH - 80 || cx - bSize < 80 || cy + bSize > GAME_CONSTANTS.WORLD_HEIGHT - 80 || cy - bSize < 80) {
                 hit = true;
              }
              if (hit) { traceDist = dist; break; }
           }

           ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
           ctx.fillRect(15, -bSize, Math.max(0, traceDist - 15), bSize * 2);
           
           ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
           ctx.lineWidth = 1;
           ctx.setLineDash([5, 5]);
           ctx.beginPath();
           ctx.moveTo(15, 0);
           ctx.lineTo(Math.max(15, traceDist), 0);
           ctx.stroke();
           ctx.restore();
        }

        // Body
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(0, 0, 20, 0, Math.PI*2);
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        ctx.stroke();

        // Turret
        ctx.save();
        ctx.rotate(p.rotation);
        ctx.fillStyle = '#334155';
        ctx.fillRect(0, -6, 30, 12);
        ctx.strokeRect(0, -6, 30, 12);
        ctx.beginPath();
        ctx.arc(0, 0, 12, 0, Math.PI*2);
        ctx.fill(); ctx.stroke();
        ctx.restore();

        // Shield
        if (p.shieldUntil && Date.now() < p.shieldUntil) {
           ctx.beginPath();
           ctx.arc(0, 0, 28, 0, Math.PI * 2);
           ctx.lineWidth = 2;
           ctx.strokeStyle = '#38bdf8';
           ctx.fillStyle = 'rgba(56, 189, 248, 0.2)';
           ctx.fill();
           ctx.stroke();
        }

        // Name tag & HP bar
        ctx.textAlign = 'center';
        let barColor = isMe ? '#10b981' : '#ef4444';
        
        if (room.gameMode === 'DUO') {
            const myTeam = getTeam(s.userId);
            const pTeam = getTeam(p.userId);
            const isMyTeam = pTeam === myTeam;
            
            if (isMyTeam) {
                barColor = '#3b82f6';
            } else {
                const enemyColors = ['#ef4444', '#f59e0b', '#8b5cf6', '#ec4899', '#f97316', '#14b8a6'];
                barColor = enemyColors[pTeam % enemyColors.length];
            }
            ctx.fillStyle = barColor;
            ctx.font = 'bold 12px monospace';
            ctx.fillText(p.name + (isMyTeam ? ' [ALLY]' : ` [ENEMY T${pTeam + 1}]`), 0, -45);
        } else {
            ctx.fillStyle = barColor;
            ctx.font = 'bold 12px monospace';
            ctx.fillText(p.name, 0, -45);
        }
        
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(-20, -38, 40, 6);
        ctx.fillStyle = barColor;
        ctx.fillRect(-20, -38, 40 * (p.health/100), 6);

        if (isMe) {
           // Ammo Bar
           const mAmmo = GAME_CONSTANTS.AMMO_CAPACITY[p.tankType] || 3;
           const widthPerAmmo = 40 / mAmmo;
           const rSpeed = GAME_CONSTANTS.RELOAD_SPEED[p.tankType] || 1000;
           
           for (let i = 0; i < mAmmo; i++) {
              if (i < s.ammo) {
                 ctx.fillStyle = '#fbbf24';
                 ctx.fillRect(-20 + i * widthPerAmmo + 1, -30, widthPerAmmo - 2, 4);
              } else if (i === s.ammo) {
                 const progress = Math.min(1, (Date.now() - s.lastReloadTime) / rSpeed);
                 ctx.fillStyle = '#fbbf24';
                 ctx.fillRect(-20 + i * widthPerAmmo + 1, -30, (widthPerAmmo - 2) * progress, 4);
              } else {
                 ctx.fillStyle = 'rgba(0,0,0,0.5)';
                 ctx.fillRect(-20 + i * widthPerAmmo + 1, -30, widthPerAmmo - 2, 4);
              }
           }
        }

        ctx.restore();
     };

     s.remotePlayers.forEach(p => drawTank(p, false));
     drawTank(s.localPlayer, true);

     // Draw Bullets
     s.bullets.forEach(b => {
        ctx.fillStyle = b.color || (b.playerId === s.userId ? '#34d399' : '#f87171');
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.size || GAME_CONSTANTS.BULLET_SIZE.balanced, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 0.5;
        ctx.arc(b.x, b.y, (b.size || GAME_CONSTANTS.BULLET_SIZE.balanced) * 1.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
     });

     ctx.restore();

     // Draw crosshair
     if (!('ontouchstart' in window)) {
       ctx.strokeStyle = 'rgba(255,255,255,0.5)';
       ctx.lineWidth = 2;
       ctx.beginPath();
       ctx.moveTo(s.mouse.x - 10, s.mouse.y);
       ctx.lineTo(s.mouse.x + 10, s.mouse.y);
       ctx.moveTo(s.mouse.x, s.mouse.y - 10);
       ctx.lineTo(s.mouse.x, s.mouse.y + 10);
       ctx.stroke();
     }

     // Minimap
     const mSize = 150;
     const mPad = 20;
     const mX = cWidth - mSize - mPad;
     const mY = cHeight - mSize - mPad;
     
     ctx.save();
     ctx.setTransform(1, 0, 0, 1, 0, 0); // reset transform for HUD
     ctx.translate(mX, mY);
     
     // bg
     ctx.fillStyle = 'rgba(15, 23, 42, 0.8)';
     ctx.fillRect(0, 0, mSize, mSize);
     ctx.strokeStyle = 'rgba(255,255,255,0.1)';
     ctx.lineWidth = 2;
     ctx.strokeRect(0, 0, mSize, mSize);
     
     const scaleX = mSize / GAME_CONSTANTS.WORLD_WIDTH;
     const scaleY = mSize / GAME_CONSTANTS.WORLD_HEIGHT;
     
     // Map Objects
     ctx.fillStyle = 'rgba(100, 116, 139, 0.5)';
     s.mapObjects.forEach(obj => {
        ctx.fillRect(obj.x * scaleX, obj.y * scaleY, obj.width * scaleX, obj.height * scaleY);
     });
     
     // Players
     s.remotePlayers.forEach(p => {
        if (!p.isAlive) return;
        const isAlly = room.gameMode === 'DUO' && getTeam(p.userId) === getTeam(s.userId);
        ctx.fillStyle = isAlly ? '#047857' : '#ef4444';
        ctx.beginPath();
        ctx.arc(p.x * scaleX, p.y * scaleY, 3, 0, Math.PI*2);
        ctx.fill();
     });
     
     ctx.fillStyle = '#10b981';
     ctx.beginPath();
     ctx.arc(s.localPlayer.x * scaleX, s.localPlayer.y * scaleY, 3, 0, Math.PI*2);
     ctx.fill();

     // Viewport rect
     const vW = cWidth * scaleX;
     const vH = cHeight * scaleY;
     const clampScaleX = Math.max(0, -s.cameraX * scaleX);
     const clampScaleY = Math.max(0, -s.cameraY * scaleY);
     ctx.strokeStyle = 'rgba(255,255,255,0.3)';
     ctx.lineWidth = 1;
     ctx.strokeRect(clampScaleX, clampScaleY, vW, vH);
     
     ctx.restore();

     // Ally off-screen indicators
     ctx.save();
     ctx.setTransform(1, 0, 0, 1, 0, 0);
     s.remotePlayers.forEach(p => {
        if (!p.isAlive) return;
        const isAlly = room.gameMode === 'DUO' && getTeam(p.userId) === getTeam(s.userId);
        if (isAlly) {
            const screenX = p.x + s.cameraX;
            const screenY = p.y + s.cameraY;
            const padding = 30;
            if (screenX < 0 || screenX > cWidth || screenY < 0 || screenY > cHeight) {
                const angle = Math.atan2(screenY - cHeight / 2, screenX - cWidth / 2);
                let edgeX = cWidth / 2 + Math.cos(angle) * (cWidth / 2 - padding);
                let edgeY = cHeight / 2 + Math.sin(angle) * (cHeight / 2 - padding);
                
                // clamp to screen edges
                edgeX = Math.max(padding, Math.min(cWidth - padding, edgeX));
                edgeY = Math.max(padding, Math.min(cHeight - padding, edgeY));

                ctx.save();
                ctx.translate(edgeX, edgeY);
                ctx.rotate(angle);
                ctx.fillStyle = '#047857'; // dark green
                ctx.beginPath();
                ctx.moveTo(10, 0);
                ctx.lineTo(-5, 5);
                ctx.lineTo(-5, -5);
                ctx.fill();
                ctx.restore();
            }
        }
     });
     ctx.restore();
  };

  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
        if (screen.orientation && (screen.orientation as any).lock) {
          try {
            await (screen.orientation as any).lock('landscape');
          } catch (e) {}
        }
      } else {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="fixed inset-0 bg-[#05070a] overflow-hidden">
      {!isOnline && (
        <div className="absolute inset-0 z-[10000] bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center pointer-events-auto">
           <WifiOff className="text-rose-500 w-24 h-24 mb-4 animate-pulse" />
           <h2 className="text-2xl font-black italic text-rose-500 mb-2 tracking-tighter uppercase text-center">CONNECTION LOST</h2>
           <p className="font-mono text-xs tracking-[4px] uppercase text-rose-400/80 animate-pulse text-center">Waiting for network to reload...</p>
        </div>
      )}
      {!isGameLoaded && (
        <div className="absolute inset-0 z-[9999] bg-[#05070a] flex flex-col items-center justify-center text-emerald-500">
           <div className="w-20 h-20 border-4 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin mb-6 shadow-[0_0_30px_rgba(16,185,129,0.3)]" />
           <h2 className="text-2xl font-black italic tracking-tighter text-slate-100 mb-2">INITIALIZING SECTOR</h2>
           <p className="font-mono text-sm tracking-[4px] uppercase font-bold animate-pulse text-emerald-400">Loading Map Assets...</p>
        </div>
      )}
      
      <div className="absolute inset-0 z-[100] bg-[#05070a] flex-col items-center justify-center p-8 hidden landscape-prompt text-center landscape:hidden">
          <h2 className="text-2xl font-black italic text-emerald-500 mb-4 tracking-tighter uppercase">PLEASE ROTATE DEVICE</h2>
          <p className="text-slate-400 text-xs font-mono uppercase tracking-widest leading-relaxed">This tactical interface requires a horizontal coordinate plane for optimal operation.</p>
      </div>
      <style>{`
         @media (orientation: portrait) and (max-width: 768px) {
           .landscape-prompt { display: flex !important; }
         }
      `}</style>

      {killFeed.length > 0 && (
        <div className="absolute top-16 left-4 z-[50] flex flex-col gap-1.5 items-start pointer-events-none transition-all duration-300">
           {killFeed.map((evt) => (
               <div key={evt.id} className={`bg-slate-900/80 backdrop-blur border border-slate-800/70 px-3 py-1.5 rounded-md flex items-center gap-3 text-[9px] md:text-[10px] font-mono tracking-[2px] uppercase shadow-xl animate-in fade-in relative overflow-hidden`} style={{ opacity: Math.max(0, 1 - (Date.now() - evt.timestamp) / 4000) }}>
                  <div className="absolute right-0 top-0 bottom-0 w-[3px]" style={{ backgroundColor: evt.killerColor }} />
                  <span style={{ color: evt.killerColor }} className="font-bold drop-shadow-[0_0_2px_currentColor]">{evt.killerName}</span>
                  <span className="text-slate-500 text-[8px] mx-1 font-bold tracking-[3px]">KILL</span>
                  <span style={{ color: evt.victimColor }} className="font-bold drop-shadow-[0_0_2px_currentColor]">{evt.victimName}</span>
               </div>
           ))}
        </div>
      )}

      {/* Top Center Timer */}
      {timeLeft !== null && !matchEnded && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 pointer-events-none flex flex-col items-center drop-shadow-xl">
          <div className="text-xl font-black font-mono text-emerald-400 tracking-widest bg-slate-900/80 px-4 py-1 rounded-xl border border-emerald-500/30">
            {Math.floor(timeLeft / 60).toString().padStart(2, '0')}:{(timeLeft % 60).toString().padStart(2, '0')}
          </div>
          <div className="text-[9px] uppercase tracking-widest text-slate-400 mt-1">Time Remaining</div>
        </div>
      )}

      {/* Top Left info overlay */}
      <div className="absolute top-4 left-4 sm:left-6 z-20 pointer-events-none flex flex-col items-start gap-1 drop-shadow-xl">
          <div className="flex items-center gap-2 hidden sm:flex">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse drop-shadow-[0_0_8px_rgba(16,185,129,0.8)]"></div>
            <span className="text-[10px] sm:text-xs font-bold tracking-widest uppercase text-emerald-400 shadow-black drop-shadow-md">Tactical Link: Active</span>
          </div>
          <span className="text-[10px] sm:text-xs font-medium text-slate-400 uppercase tracking-wider shadow-black drop-shadow-md hidden sm:block">Sector: <span className="text-slate-100">{roomName.length > 20 ? roomName.substring(0, 20) + '...' : roomName}</span></span>
      </div>

      <main className="absolute inset-0">
        {/* Battlefield */}
        <section className={`w-full h-full relative ${(!matchEnded && isAlive) ? 'cursor-none' : ''}`} ref={containerRef} style={{ touchAction: 'none' }}>
          <canvas ref={canvasRef} className="block w-full h-full touch-none" />

          {/* Virtual Joysticks */}
          <div className="absolute inset-0 pointer-events-none z-40 flex justify-between md:hidden" id="joysticks-container">
            <div className="w-1/2 h-full pointer-events-auto touch-none" id="joystick-left-zone" />
            <div className="w-1/2 h-full pointer-events-auto touch-none" id="joystick-right-zone" />
          </div>
          <div id="joystick-left-base" className="absolute w-24 h-24 bg-slate-800/30 rounded-full border border-slate-600/30 z-40 pointer-events-none opacity-0 transition-opacity duration-200" style={{ transform: 'translate(-50%, -50%)', left: -100, top: -100 }} />
          <div id="joystick-left-knob" className="absolute w-12 h-12 bg-slate-400/80 rounded-full z-50 pointer-events-none opacity-0 transition-opacity duration-200 shadow-xl" style={{ transform: 'translate(-50%, -50%)', left: -100, top: -100 }} />
          
          <div id="joystick-right-base" className="absolute w-24 h-24 bg-rose-800/20 rounded-full border border-rose-600/30 z-40 pointer-events-none opacity-0 transition-opacity duration-200" style={{ transform: 'translate(-50%, -50%)', left: -100, top: -100 }} />
          <div id="joystick-right-knob" className="absolute w-12 h-12 bg-rose-500/80 rounded-full z-50 pointer-events-none opacity-0 transition-opacity duration-200 shadow-xl shadow-rose-900" style={{ transform: 'translate(-50%, -50%)', left: -100, top: -100 }} />

          {matchEnded && (
            <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-md flex flex-col items-center justify-center z-[100] pointer-events-auto">
              <h2 className={`text-5xl md:text-7xl font-black italic mb-4 tracking-tighter shadow-black drop-shadow-2xl ${
                (() => {
                  if (leaderboard.length === 0) return 'text-slate-500';
                  const me = leaderboard.find(l => l.isMe);
                  if (room.gameMode === 'SOLO_RESPAWN') return me && me.score === leaderboard[0].score ? 'text-emerald-500' : 'text-rose-500';
                  if (room.gameMode === 'DUO') {
                      if (isAlive) return 'text-emerald-500';
                      let teamWin = false;
                      state.current.remotePlayers.forEach(rp => {
                          if (getTeam(rp.userId) === getTeam(user.uid) && rp.isAlive) teamWin = true;
                      });
                      return teamWin ? 'text-emerald-500' : 'text-rose-500';
                  }
                  return isAlive ? 'text-emerald-500' : 'text-rose-500';
                })()
              }`}>
                {(() => {
                   if (leaderboard.length === 0) return "MATCH OVER";
                   const me = leaderboard.find(l => l.isMe);
                   if (room.gameMode === 'SOLO_RESPAWN') {
                       return me && me.score === leaderboard[0].score ? "VICTORY" : "DEFEAT";
                   } else {
                       if (room.gameMode === 'DUO') {
                           if (isAlive) return "VICTORY";
                           let teamWin = false;
                           state.current.remotePlayers.forEach(rp => {
                               if (getTeam(rp.userId) === getTeam(user.uid) && rp.isAlive) teamWin = true;
                           });
                           if (teamWin) return "VICTORY";
                           return "DEFEAT";
                       }
                       return isAlive ? "VICTORY" : "DEFEAT";
                   }
                })()}
              </h2>
              {leaderboard.length > 0 && (
                 <div className="text-2xl text-slate-200 font-bold mb-8 text-center max-w-lg mx-auto">
                   {(() => {
                      const maxScore = leaderboard[0].score;
                      const winners = leaderboard.filter(p => p.score === maxScore);
                      if (winners.length > 1) {
                         return (
                            <p>
                               Winners: <span className="text-emerald-400">{winners.map(w => w.name.split(' ')[0]).join(', ')}</span> with <span className="text-emerald-400">{maxScore}</span> Kills
                            </p>
                         );
                      }
                      return (
                         <p>
                            Winner: <span className="text-emerald-400">{winners[0].name.split(' ')[0]}</span> with <span className="text-emerald-400">{maxScore}</span> Kills
                         </p>
                      );
                   })()}
                 </div>
              )}
              <button 
                onClick={handleReturnToLobby}
                className="bg-emerald-600 text-white px-10 py-3 rounded-full font-black text-lg hover:scale-110 transition-transform shadow-[0_0_40px_rgba(16,185,129,0.3)] border-2 border-emerald-400"
              >
                RETURN TO LOBBY
              </button>
            </div>
          )}

          {!isAlive && !matchEnded && (
            <div className="absolute inset-0 bg-rose-950/80 backdrop-blur-sm flex flex-col items-center justify-center z-50 pointer-events-auto">
              {room.gameMode === 'SOLO_RESPAWN' ? (
                 <>
                    <h2 className="text-5xl md:text-7xl font-black italic text-rose-500 mb-8 glitch-hover tracking-tighter shadow-black drop-shadow-2xl">ARMOR DESTROYED</h2>
                    <div className="flex flex-col items-center">
                       <div className="text-xl font-bold text-slate-300 font-mono tracking-widest mb-4">DEPLOYING REPLACEMENTS</div>
                       <div className="text-8xl font-black italic text-emerald-500 drop-shadow-[0_0_20px_rgba(16,185,129,0.5)]">
                          {respawnCountdown !== null && respawnCountdown > 0 ? respawnCountdown : "..."}
                       </div>
                    </div>
                 </>
              ) : (
                 <>
                   <h2 className="text-5xl md:text-7xl font-black italic text-rose-500 mb-8 glitch-hover tracking-tighter shadow-black drop-shadow-2xl">DEFEAT</h2>
                   <div className="text-xl font-bold font-mono text-rose-400 mt-4 tracking-widest uppercase">
                     NO LIVES REMAINING
                   </div>
                   <button 
                     onClick={handleReturnToLobby}
                     className="mt-8 bg-slate-800 text-white px-8 py-3 rounded-full font-black text-sm hover:bg-slate-700 transition-colors border border-slate-700"
                   >
                     RETURN TO LOBBY
                   </button>
                 </>
              )}
            </div>
          )}
        </section>
      </main>

      {/* Settings Button */}
      <button 
        onClick={() => setShowSettings(!showSettings)}
        className="absolute top-4 right-4 z-[200] p-3 bg-slate-900/60 hover:bg-slate-800/80 backdrop-blur-sm border border-slate-700 rounded-xl text-slate-300 transition-colors pointer-events-auto"
      >
        <Settings size={20} />
      </button>

      {/* Settings Modal Layer */}
      {showSettings && (
        <div 
          className="absolute top-4 right-16 bottom-4 w-80 bg-slate-900/95 backdrop-blur-md rounded-2xl border border-slate-700 shadow-2xl p-6 flex flex-col gap-6 pointer-events-auto overflow-y-auto z-[200]"
          onPointerDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold italic tracking-wider text-slate-100 uppercase">Mission Status</h2>
              <button onClick={() => setShowSettings(false)} className="text-slate-400 hover:text-white transition-colors">
                <X size={24} />
              </button>
            </div>

            <section>
              <h3 className="text-xs uppercase tracking-wider text-slate-500 mb-3 font-bold border-b border-slate-800 pb-1">Stats</h3>
              <div className="flex gap-4">
                <div className="flex-1 bg-slate-950 p-3 rounded-xl border border-slate-800">
                  <span className="block text-[10px] text-slate-500 uppercase font-bold text-center">Kills</span>
                  <span className="block text-2xl font-black font-mono text-emerald-400 text-center">{score}</span>
                </div>
                <div className="flex-1 bg-slate-950 p-3 rounded-xl border border-slate-800">
                  <span className="block text-[10px] text-slate-500 uppercase font-bold text-center">Health</span>
                  <span className={`block text-2xl font-black font-mono text-center ${health > 30 ? 'text-emerald-400' : 'text-rose-400'}`}>{health}</span>
                </div>
              </div>
            </section>

            <section>
              <h3 className="text-xs uppercase tracking-wider text-slate-500 mb-3 font-bold border-b border-slate-800 pb-1">Controls</h3>
              <div className="flex items-center justify-between p-3 bg-slate-950 rounded-xl border border-slate-800">
                <span className="text-sm font-bold text-slate-300">Auto-Attack (Tap to fire)</span>
                <button 
                  onClick={() => setAutoAimEnabled(!autoAimEnabled)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${autoAimEnabled ? 'bg-emerald-500' : 'bg-slate-700'}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${autoAimEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </div>
            </section>

            <section>
              <h3 className="text-xs uppercase tracking-wider text-slate-500 mb-3 font-bold border-b border-slate-800 pb-1">Leaderboard</h3>
              <div className="space-y-2 max-h-[160px] overflow-y-auto pr-2">
                {leaderboard.map((p, i) => (
                  <div 
                    key={i} 
                    className={`flex items-center justify-between p-2 rounded text-[11px] ${p.isMe ? 'bg-emerald-500/10 border-l-2 border-emerald-500' : 'bg-slate-800/20'}`}
                  >
                    <span className={`${p.isMe ? 'font-bold text-emerald-400' : 'text-slate-300'} truncate w-32`}>
                      {i + 1}. {p.name.split(' ')[0]}
                    </span>
                    <span className={`font-mono ${p.isMe ? 'text-emerald-400' : 'text-slate-500'}`}>{p.score}</span>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <h3 className="text-xs uppercase tracking-wider text-slate-500 mb-3 font-bold border-b border-slate-800 pb-1">Controls</h3>
              <div className="bg-slate-800/20 rounded p-3 text-xs font-mono text-slate-400 space-y-1">
                <div>WASD  : Move</div>
                <div>MOUSE : Aim</div>
                <div>CLICK : Fire</div>
              </div>
            </section>

            <button 
              onClick={toggleFullscreen}
              className="mt-2 flex items-center justify-center gap-2 bg-slate-800/50 hover:bg-slate-700 py-3 rounded-xl border border-slate-700 transition-colors uppercase font-bold text-slate-300 tracking-wider w-full text-sm"
            >
              <Maximize size={18} />
              Toggle Fullscreen
            </button>

            <button 
              onClick={() => {
                setDoc(doc(db, `rooms/${roomId}/players`, state.current.userId), { aborted: true }, { merge: true });
                onExit();
              }}
              className="mt-4 flex items-center justify-center gap-2 bg-rose-500/10 hover:bg-rose-500/20 py-3 rounded-xl border border-rose-500/30 transition-colors uppercase font-black text-rose-500 tracking-wider w-full"
            >
              Abort Mission
            </button>
        </div>
      )}
    </div>
  );
}
