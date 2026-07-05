import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { TankPicker } from './components/TankPicker';
import { Lobby } from './components/Lobby';
import { GameClient } from './game/GameClient';
import { LogIn, Maximize } from 'lucide-react';
import { Room } from './types';
import { socket } from './lib/socket';
import { nanoid } from 'nanoid';

export default function App() {
  const [user, setUser] = useState<{ uid: string, displayName?: string | null } | null>(null);
  const [joinedRoomId, setJoinedRoomId] = useState<string | null>(null);
  const [joinedRoom, setJoinedRoom] = useState<Room | null>(null);
  const [gameState, setGameState] = useState<'AUTH' | 'PICKER' | 'LOBBY'>('AUTH');
  const [isAnalyzing, setIsAnalyzing] = useState(true);
  const [selection, setSelection] = useState<{ type: string, color: string, name: string } | null>(() => {
     try { return JSON.parse(localStorage.getItem('tankSelection') || 'null'); } catch { return null; }
  });
  
  const [leftMatchId, setLeftMatchId] = useState<string | null>(() => {
     try { return localStorage.getItem('leftMatchId'); } catch { return null; }
  });
  
  const [globalRooms, setGlobalRooms] = useState<Room[]>([]);

  useEffect(() => {
    socket.connect();
    
    const handleRoomsUpdate = (rooms: Room[]) => {
       setGlobalRooms(rooms);
    };
    
    socket.on('rooms_update', handleRoomsUpdate);
    
    return () => { 
       socket.off('rooms_update', handleRoomsUpdate);
       socket.disconnect(); 
    };
  }, []);

  useEffect(() => {
    if (joinedRoomId) {
      localStorage.setItem('joinedRoomId', joinedRoomId);
      const r = globalRooms.find(room => room.id === joinedRoomId);
      setJoinedRoom(r || null);
    } else {
      localStorage.removeItem('joinedRoomId');
      setJoinedRoom(null);
    }
  }, [joinedRoomId, globalRooms]);

  useEffect(() => {
    if (selection) localStorage.setItem('tankSelection', JSON.stringify(selection));
    else localStorage.removeItem('tankSelection');
  }, [selection]);

  useEffect(() => {
    const checkAuth = async () => {
      const storedUid = localStorage.getItem('localUid');
      if (storedUid) {
        setUser({ uid: storedUid, displayName: 'Pilot' });
        setIsAnalyzing(true);
        try {
           await new Promise(r => setTimeout(r, 500));
           const savedRoomId = localStorage.getItem('joinedRoomId');
           if (savedRoomId) {
              setJoinedRoomId(savedRoomId);
              setGameState('LOBBY'); 
           } else {
              setJoinedRoomId(null);
              if (localStorage.getItem('tankSelection')) {
                 setGameState('LOBBY');
              } else {
                 setGameState('PICKER');
              }
           }
        } catch (e) {
           setGameState(localStorage.getItem('tankSelection') ? 'LOBBY' : 'PICKER');
        }
        setIsAnalyzing(false);
      } else {
        setGameState('AUTH');
        setIsAnalyzing(false);
      }
    };
    checkAuth();
  }, []);

  const login = async () => {
    try {
      const newUid = nanoid();
      localStorage.setItem('localUid', newUid);
      setUser({ uid: newUid, displayName: 'Pilot' });
      setGameState(localStorage.getItem('tankSelection') ? 'LOBBY' : 'PICKER');
    } catch (e: any) {
      console.error("Login failed:", e);
    }
  };

  const logout = async () => {
    try {
      localStorage.removeItem('localUid');
      setUser(null);
      setGameState('AUTH');
    } catch (e) {
      console.error("Logout failed:", e);
    }
  };

  const [isJoining, setIsJoining] = useState(false);

  const handleJoinRoom = async (rid: string) => {
    setIsJoining(true);
    if (user) {
      socket.emit('join_room_lobby', { roomId: rid, userId: user.uid });
      setJoinedRoomId(rid);
    }
    setIsJoining(false);
  };

  const handleLeaveRoom = async () => {
    const rid = joinedRoomId;
    setJoinedRoomId(null);
    setIsJoining(false);
    if (rid && user) {
       socket.emit('leave_room_lobby', { roomId: rid, userId: user.uid });
    }
  };

  const [showEndScreen, setShowEndScreen] = useState(false);

  useEffect(() => {
     if (joinedRoom) {
        if (joinedRoom.status === 'playing') {
           setShowEndScreen(true);
        } else if (joinedRoom.status === 'inactive') {
           setShowEndScreen(false);
        }
     } else {
        setShowEndScreen(false);
     }
  }, [joinedRoom?.status]);

  const handleLeaveMatch = () => {
    if (joinedRoom && joinedRoom.matchId) {
      setLeftMatchId(joinedRoom.matchId);
      localStorage.setItem('leftMatchId', joinedRoom.matchId);
    }
  };

  const isGameActive = joinedRoom && joinedRoom.status === 'playing' && joinedRoom.matchId !== leftMatchId;

  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
        if (screen.orientation && (screen.orientation as any).lock) {
          try {
             await (screen.orientation as any).lock('landscape');
          } catch(e) {
             console.log('Orientation lock failed:', e);
          }
        }
      } else {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        }
      }
    } catch (e) {
      console.log('Fullscreen request failed:', e);
    }
  };

  return (
    <div className="h-[100dvh] w-screen bg-[#05070a] text-slate-200 flex flex-col font-sans selection:bg-emerald-500/30 overflow-hidden relative">
      {!isGameActive && (
        <button 
          onClick={toggleFullscreen} 
          className="absolute top-4 right-4 z-[9999] p-3 bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-emerald-400 rounded-lg backdrop-blur shadow-lg border border-slate-700 transition-colors"
          title="Toggle Fullscreen"
        >
          <Maximize size={20} />
        </button>
      )}
      {isAnalyzing && (
        <div className="absolute inset-0 z-[10000] bg-[#05070a] flex flex-col items-center justify-center text-emerald-500">
           <div className="w-16 h-16 border-4 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin mb-4 shadow-[0_0_20px_rgba(16,185,129,0.3)]" />
           <p className="font-mono text-sm tracking-[4px] uppercase font-bold animate-pulse text-emerald-400">Analyzing Operative Status...</p>
        </div>
      )}
      {isJoining && !isAnalyzing && (
        <div className="absolute inset-0 z-[10000] bg-[#05070a]/90 backdrop-blur-md flex flex-col items-center justify-center text-emerald-500">
           <div className="w-16 h-16 border-4 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin mb-4" />
           <p className="font-mono text-sm tracking-[4px] uppercase font-bold animate-pulse">Establishing Connection...</p>
        </div>
      )}
      <AnimatePresence mode="wait">
        {gameState === 'AUTH' && !isGameActive && !isAnalyzing && (
          <motion.div 
            key="auth"
            className="flex-1 flex flex-col items-center justify-center pixel-grid relative"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          >
            <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#05070a]/80 to-[#05070a]" />
            <div className="text-center space-y-6 relative z-10">
              <motion.h1 
                className="text-5xl landscape:text-5xl sm:text-6xl md:text-8xl font-black italic tracking-tighter text-slate-100 px-4"
                style={{ textShadow: '0 0 40px rgba(16, 185, 129, 0.2)' }}
                initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
              >
                STEEL VANGUARD
              </motion.h1>
              <p className="text-emerald-500 tracking-[4px] md:tracking-[10px] uppercase font-bold text-xs md:text-sm px-4">
                Next-Gen Tactical Armor Division
              </p>
              
              <motion.button 
                whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                onClick={login}
                className="mt-12 mx-auto w-fit flex items-center gap-3 bg-emerald-600 text-white px-12 py-4 rounded-full font-black text-lg shadow-[0_0_30px_rgba(16,185,129,0.3)] transition-all hover:bg-emerald-500"
              >
                <LogIn size={24} />
                INITIALIZE COMMAND
              </motion.button>
            </div>
          </motion.div>
        )}

        {gameState === 'PICKER' && !isGameActive && !isAnalyzing && (
          <motion.div key="picker" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex-1 pixel-grid pt-4 md:pt-12 overflow-auto">
            <TankPicker onSelect={(type: any, color: any, name: any) => {
              setSelection({ type, color, name });
              setGameState('LOBBY');
            }} />
          </motion.div>
        )}

        {gameState === 'LOBBY' && user && !isGameActive && !isAnalyzing && (
          <motion.div key="lobby" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex-1 pixel-grid pt-4 md:pt-12 overflow-y-auto h-full">
            <Lobby 
              userId={user.uid} 
              selection={selection} 
              onJoin={handleJoinRoom} 
              onChangeTank={() => setGameState('PICKER')} 
              joinedRoom={joinedRoom}
              onLeaveRoom={handleLeaveRoom}
              onLogout={logout}
              globalRooms={globalRooms}
            />
          </motion.div>
        )}

        {isGameActive && joinedRoom && user && selection && !isAnalyzing && (
          <motion.div key="game" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex-1 flex flex-col h-screen overflow-hidden">
            <GameClient 
              room={joinedRoom} 
              user={user} 
              selection={selection} 
              onExit={handleLeaveMatch} 
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
