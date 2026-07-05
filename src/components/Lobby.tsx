import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Room, GameMode } from '../types';
import { Plus, Users, Play, Radio, Search, Settings, Trash, Edit2, X, Square, LogOut, BotIcon, Menu, User, ChevronDown } from 'lucide-react';
import { socket } from '../lib/socket';

interface LobbyProps {
  onJoin: (roomId: string) => void;
  onChangeTank: () => void;
  userId: string;
  selection: { type: string, color: string, name: string } | null;
  joinedRoom: Room | null;
  onLeaveRoom: () => void;
  onLogout: () => void;
  globalRooms: Room[];
}

const CustomSelect = ({ value, onChange, options, className }: { value: string, onChange: (v: any) => void, options: {label: string, value: string}[], className?: string }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
     const clickOutside = (e: MouseEvent | TouchEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
     document.addEventListener('mousedown', clickOutside);
     document.addEventListener('touchstart', clickOutside);
     return () => {
        document.removeEventListener('mousedown', clickOutside);
        document.removeEventListener('touchstart', clickOutside);
     };
  }, []);

  return (
    <div className={`relative ${className}`} ref={ref}>
      <div 
        className="h-full w-full flex items-center justify-between px-2 cursor-pointer outline-none bg-transparent hover:bg-slate-800/50 text-slate-300 font-mono text-xs md:text-sm font-bold rounded-lg transition-colors"
        onClick={() => setOpen(!open)}
      >
        <span className="truncate mr-2">{options.find(o => o.value === value)?.label}</span>
        <ChevronDown size={14} className={`shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </div>
      <AnimatePresence>
        {open && (
          <motion.div 
            initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }} transition={{ duration: 0.15 }}
            className="absolute top-full left-0 z-50 mt-1 min-w-full w-max bg-slate-800 border border-slate-700 rounded-lg overflow-hidden shadow-2xl shadow-black origin-top"
          >
            {options.map((opt) => (
              <div 
                key={opt.value} 
                className={`px-3 py-2 text-xs font-mono cursor-pointer hover:bg-slate-700 transition-colors whitespace-nowrap ${value === opt.value ? 'text-purple-400 bg-slate-900/50' : 'text-slate-300'}`}
                onClick={() => { onChange(opt.value); setOpen(false); }}
              >
                {opt.label}
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export const Lobby: React.FC<LobbyProps> = ({ onJoin, onChangeTank, userId, selection, joinedRoom, onLeaveRoom, onLogout, globalRooms }) => {
  const rooms = globalRooms.filter(r => !r.isBotMode);
  const [creating, setCreating] = useState(false);
  const [newRoomName, setNewRoomName] = useState('');
  const [newRoomTimer, setNewRoomTimer] = useState('5');
  const [newRoomMode, setNewRoomMode] = useState<GameMode>('SOLO_RESPAWN');
  const [botGameMode, setBotGameMode] = useState<GameMode>('SOLO_RESPAWN');
  const [searchQuery, setSearchQuery] = useState('');
  const [tab, setTab] = useState<'all' | 'my'>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'waiting' | 'playing'>('all');

  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [profileName, setProfileName] = useState(() => {
     try { return JSON.parse(localStorage.getItem('tankSelection') || '{}').name || 'PILOT'; } catch { return 'PILOT'; }
  });

  const [editingRoomId, setEditingRoomId] = useState<string | null>(null);
  const [editTimer, setEditTimer] = useState('');

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [errorToast, setErrorToast] = useState<string | null>(null);

  useEffect(() => {
    if (errorToast) {
       const timer = setTimeout(() => setErrorToast(null), 5000);
       return () => clearTimeout(timer);
    }
  }, [errorToast]);

  // Sync timer check to auto-transition or transition room status if host
  useEffect(() => {
    if (!rooms.length) return;
    const interval = setInterval(() => {
      const now = Date.now();
      rooms.forEach(r => {
         // Because we no longer track pings via firestore, we consider players active if they are in array
        const activePlayers = r.players || [];

        if (r.status === 'waiting' && now >= r.gameStartTime) {
          if (r.hostId === userId) {
            if (!activePlayers.includes(r.hostId)) {
                socket.emit('update_room', { id: r.id, status: 'inactive', matchId: null });
            } else {
                const minPlayers = r.gameMode === 'DUO' ? 4 : 2;
                if (activePlayers.length < minPlayers) {
                  setErrorToast(`ERROR: At least ${minPlayers} players are required to start the map.`);
                  socket.emit('update_room', { id: r.id, status: 'inactive', matchId: null });
                } else {
                  socket.emit('update_room', { 
                      id: r.id,
                      status: 'playing', 
                      matchId: Date.now().toString(),
                      matchEndTime: Date.now() + 5 * 60 * 1000,
                      players: activePlayers 
                  });
                }
            }
          }
        } else if (r.status === 'playing') {
          // Systemic cleanup for all playing rooms when time is up
          if (r.matchEndTime && now >= r.matchEndTime) {
             socket.emit('update_room', { id: r.id, status: 'inactive' });
          } else if (!r.matchEndTime && (now - r.updatedAt > 6 * 60 * 1000)) {
             socket.emit('update_room', { id: r.id, status: 'inactive' });
          }
        }
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [rooms, userId]);

  const createRoom = async () => {
    const sanitizedName = newRoomName.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
    let tSec = parseInt(newRoomTimer);
    if (!sanitizedName || isNaN(tSec)) return;
    if (tSec < 5) tSec = 5;
    if (tSec > 900) tSec = 900;

    setCreating(true);
    try {
      if (rooms.some(r => r.name === sanitizedName)) {
        setErrorToast('Sector with this ID already exists!');
        setCreating(false);
        return;
      }

      const roomData = {
        id: sanitizedName,
        name: sanitizedName,
        status: 'inactive',
        gameMode: newRoomMode,
        hostId: userId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        timerSeconds: tSec,
        players: [userId],
        gameStartTime: Date.now() + tSec * 1000,
        mapSeed: Math.floor(Math.random() * 1000000)
      };
      socket.emit('create_room', roomData);
      setNewRoomName('');
      setNewRoomTimer('5');
      onJoin(roomData.id);
      setTab('my');
    } catch (e) {
      console.error(e);
    } finally {
      setCreating(false);
    }
  };

  const createBotMatch = async () => {
    setCreating(true);
    try {
      const botRoomId = `BOT_${userId}_${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
      
      const botIds = ['BOT_1', 'BOT_2', 'BOT_3', 'BOT_4', 'BOT_5', 'BOT_6', 'BOT_7'];
      
      const roomData = {
        id: botRoomId,
        name: `BOT ${botGameMode}`,
        status: 'playing', // Auto start playing
        gameMode: botGameMode,
        hostId: userId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        matchId: Date.now().toString(),
        matchEndTime: Date.now() + 5 * 60 * 1000, // 5 min match
        timerSeconds: 0,
        players: [userId, ...botIds],
        isBotMode: true,
        mapSeed: Math.floor(Math.random() * 1000000)
      };
      socket.emit('create_room', roomData);
      onJoin(roomData.id);
    } catch (e) {
      console.error(e);
    } finally {
      setCreating(false);
    }
  };

  const deleteRoom = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirmDeleteId !== id) {
       setConfirmDeleteId(id);
       return;
    }
    socket.emit('delete_room', id);
    if (joinedRoom?.id === id) {
      onLeaveRoom();
    }
    setConfirmDeleteId(null);
  };

  const handleEditClick = (r: Room, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingRoomId(r.id);
    setEditTimer((r.timerSeconds || 60).toString());
  };

  const toggleRoomActive = async (room: Room, start: boolean, e: React.MouseEvent) => {
    e.stopPropagation();
    if (start) {
      if (room.gameMode === 'DUO') {
          if ((room.players || []).length < 4 || (room.players || []).length % 2 !== 0) {
              setErrorToast('Duo mode requires an even number of players (at least 4).');
              return;
          }
      }
      socket.emit('update_room', {
        id: room.id,
        status: 'waiting',
        gameStartTime: Date.now() + (room.timerSeconds || 60) * 1000,
        mapSeed: Math.floor(Math.random() * 1000000),
        matchId: Date.now().toString()
      });
      onJoin(room.id);
    } else {
      socket.emit('update_room', {
        id: room.id,
        status: 'inactive'
      });
    }
  };

  const saveEdit = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    let tSec = parseInt(editTimer);
    if (isNaN(tSec)) tSec = 60;
    if (tSec < 5) tSec = 5;
    if (tSec > 900) tSec = 900;

    socket.emit('update_room', { 
      id,
      timerSeconds: tSec,
      status: 'inactive' // Set to inactive so it doesn't automatically start when saving
    });
    setEditingRoomId(null);
  };

  let filteredRooms = rooms;
  if (tab === 'my') {
    filteredRooms = filteredRooms.filter(r => r.hostId === userId);
  } else {
    filteredRooms = filteredRooms.filter(r => r.name.includes(searchQuery.toUpperCase()));
    if (filterStatus !== 'all') {
      filteredRooms = filteredRooms.filter(r => r.status === filterStatus);
    }
  }

  // Handle joined room timer widget
  const [timeLeft, setTimeLeft] = useState('');
  useEffect(() => {
    if (!joinedRoom || joinedRoom.status !== 'waiting') return;
    
    const updateTimer = () => {
      const gSt = joinedRoom.gameStartTime || (Date.now() + 60000);
      const remaining = Math.max(0, Math.ceil((gSt - Date.now()) / 1000));
      const m = Math.floor(remaining / 60);
      const s = remaining % 60;
      setTimeLeft(`${m}:${s.toString().padStart(2, '0')}`);
    };
    
    updateTimer(); // Call immediately
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [joinedRoom]);

  return (
    <div className="w-full max-w-5xl mx-auto px-4 sm:px-8 md:px-12 py-4 md:py-6 space-y-4 md:space-y-6 pb-20">
      <AnimatePresence>
         {errorToast && (
            <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] bg-rose-600 border-2 border-rose-400 text-white font-bold uppercase tracking-widest px-6 py-3 rounded-lg shadow-2xl flex items-center gap-4">
               <div>{errorToast}</div>
               <button onClick={() => setErrorToast(null)} className="p-1 hover:bg-rose-500 rounded"><X size={16} /></button>
            </motion.div>
         )}
      </AnimatePresence>

      {/* Joined Room Widget */}
      {joinedRoom && (
        <div 
          className="fixed top-4 left-4 z-50 bg-slate-900/90 backdrop-blur border border-emerald-500/50 hover:border-rose-500/50 p-4 rounded-xl shadow-2xl flex items-center justify-between gap-6 pointer-events-auto cursor-pointer group transition-colors"
          onClick={() => {
            if (joinedRoom.hostId === userId) {
               socket.emit('update_room', { id: joinedRoom.id, status: 'inactive' });
            }
            onLeaveRoom();
          }}
          title="Click to Leave Room"
        >
          <div>
            <div className="text-[10px] text-emerald-500 group-hover:text-rose-400 uppercase font-bold tracking-widest mb-1 transition-colors">Target Sector: {joinedRoom.name}</div>
            <div className="text-xl font-mono text-white font-black tracking-widest">
              {joinedRoom.status === 'waiting' ? timeLeft : (joinedRoom.status === 'playing' ? 'IN PROGRESS' : '')}
            </div>
          </div>
          <button 
            onClick={(e) => {
              e.stopPropagation();
              onLeaveRoom();
            }}
            className="p-2 bg-slate-800 hover:bg-rose-900/50 text-slate-400 hover:text-rose-400 group-hover:bg-rose-900/50 group-hover:text-rose-400 rounded-lg transition-colors"
          >
            <X size={18} />
          </button>
        </div>
      )}

      <div className="flex flex-col xl:flex-row justify-between items-start xl:items-end mb-4 border-b border-slate-800 pb-4 md:pb-6 gap-2 shrink-0 mt-2">
        <div className="mr-auto w-full xl:w-auto flex justify-between items-center xl:block">
          <div>
            <h1 className="text-4xl sm:text-6xl md:text-7xl landscape:text-5xl font-black tracking-tighter text-slate-100 italic">WAR ROOM</h1>
            <p className="text-xs md:text-sm landscape:text-[10px] tracking-[6px] md:tracking-[10px] landscape:tracking-[6px] text-emerald-500/60 uppercase mt-1 md:mt-2 landscape:mt-1 font-bold">Active Combat Sectors</p>
          </div>
        </div>
        
        <div className="flex flex-row items-center gap-1 md:gap-2 w-full justify-between xl:w-auto overflow-visible pb-1 sm:pb-0">
          <button 
            onClick={onChangeTank}
            className="flex items-center justify-center gap-1 md:gap-2 bg-slate-800/80 hover:bg-slate-700 text-slate-300 px-2 md:px-4 py-2 rounded-lg font-bold transition-all text-[10px] sm:text-xs md:text-sm h-[36px] landscape:h-[32px] md:h-[40px] border border-slate-700 whitespace-nowrap overflow-hidden shrink-0"
          >
            {selection ? (
               <>
                 <div className="w-2 h-2 md:w-3 md:h-3 rounded-sm shrink-0" style={{ backgroundColor: selection.color }} />
                 <span className="tracking-widest uppercase truncate max-w-[60px] sm:max-w-[80px] md:max-w-[120px] landscape:max-w-[80px]">{selection.name}</span>
               </>
            ) : (
               <>
                 <Settings size={14} className="md:w-4 md:h-4" />
                 <span className="hidden sm:inline">CHASSIS</span>
               </>
            )}
          </button>
          
          <div className="flex bg-slate-900 border border-slate-800 p-1 rounded-xl overflow-visible shrink h-[36px] landscape:h-[32px] md:h-[40px]">
            <CustomSelect 
              value={botGameMode}
              onChange={(v: GameMode) => setBotGameMode(v)}
              className="w-[120px]"
              options={[
                { value: 'DUO', label: 'DUO COLLISION' },
                { value: 'SOLO_RESPAWN', label: 'SOLO (RESPAWNS)' },
                { value: 'SOLO_NO_RESPAWN', label: 'SOLO COLLISION' }
              ]}
            />
            <div className="w-px bg-slate-800 mx-1 shrink-0"></div>
            <button 
              onClick={createBotMatch}
              disabled={creating}
              className="flex items-center justify-center gap-1 bg-purple-600 hover:bg-purple-500 text-white px-2 md:px-4 py-2 rounded-lg font-bold transition-all disabled:opacity-50 shrink-0 text-[10px] sm:text-xs md:text-sm"
            >
              <BotIcon size={14} />
              <span className="hidden sm:inline">BOTS</span>
            </button>
          </div>

          <button 
            onClick={() => setShowSettingsModal(true)} 
            className="flex items-center justify-center p-2 text-slate-400 hover:text-white transition-colors ml-1 bg-slate-800 hover:bg-slate-700 rounded-lg border border-slate-700 shrink-0 h-[36px] landscape:h-[32px] md:h-[40px] aspect-square"
          >
            <Menu size={18} />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between pb-4 gap-4">
         <div className="flex bg-slate-900 border border-slate-800 rounded-xl p-1 overflow-x-auto">
            <button 
              className={`px-6 py-2 rounded-lg text-xs font-bold uppercase transition-all tracking-wider ${tab === 'all' ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-slate-300'}`}
              onClick={() => setTab('all')}
            >Global Sectors</button>
            <button 
              className={`px-6 py-2 rounded-lg text-xs font-bold uppercase transition-all tracking-wider ${tab === 'my' ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-slate-300'}`}
              onClick={() => setTab('my')}
            >My Sectors</button>
         </div>
         
         {tab === 'all' && (
           <div className="flex flex-wrap items-center gap-4">
             <div className="flex bg-slate-900 border border-slate-800 rounded-xl p-1 overflow-x-auto">
                <button 
                  className={`px-4 py-2 rounded-lg text-[10px] font-bold uppercase transition-all tracking-wider ${filterStatus === 'all' ? 'bg-slate-800 text-white' : 'text-slate-500'}`}
                  onClick={() => setFilterStatus('all')}
                >All</button>
                <button 
                  className={`px-4 py-2 rounded-lg text-[10px] font-bold uppercase transition-all tracking-wider ${filterStatus === 'waiting' ? 'bg-slate-800 text-white' : 'text-slate-500'}`}
                  onClick={() => setFilterStatus('waiting')}
                >Waiting</button>
                <button 
                  className={`px-4 py-2 rounded-lg text-[10px] font-bold uppercase transition-all tracking-wider ${filterStatus === 'playing' ? 'bg-slate-800 text-white' : 'text-slate-500'}`}
                  onClick={() => setFilterStatus('playing')}
                >Playing</button>
             </div>
             <div className="relative">
               <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
               <input 
                 value={searchQuery}
                 onChange={(e) => setSearchQuery(e.target.value)}
                 placeholder="SEARCH..." 
                 className="w-48 bg-slate-900 border border-slate-800 pl-10 pr-4 py-2 rounded-xl focus:outline-none focus:border-blue-500 transition-all font-mono uppercase text-[10px] text-slate-200"
               />
             </div>
           </div>
         )}
      </div>

      <div className="grid gap-4">
        {filteredRooms.length === 0 && (
          <div className="metal-panel p-16 text-center rounded-2xl opacity-40 border-dashed border-2 border-slate-700">
            <Radio className="mx-auto mb-4 animate-pulse text-slate-500" size={32} />
            <p className="font-mono text-[10px] tracking-[4px] uppercase text-slate-400">
              {tab === 'my' ? 'You have no active combat sectors...' : 'No matching sectors found...'}
            </p>
          </div>
        )}
        
        {filteredRooms.map((room) => {
          const isMyTab = tab === 'my';
          const isActive = joinedRoom?.id === room.id;
          
          return (
            <motion.div 
              key={room.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              onClick={(e) => {
                  if (isActive) {
                     if (joinedRoom.hostId === userId) {
                        socket.emit('update_room', { id: joinedRoom.id, status: 'inactive' });
                     }
                     onLeaveRoom();
                  }
              }}
              className={`metal-panel p-6 rounded-2xl flex items-center justify-between group transition-all bg-slate-900/40 border ${isActive ? 'border-emerald-500 bg-emerald-500/10 cursor-pointer' : 'border-slate-800 hover:border-slate-600'}`}
            >
              <div className="flex items-center gap-6">
                <div className={`w-14 h-14 rounded-xl flex items-center justify-center transition-colors ${isActive ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-500'}`}>
                  {room.status === 'playing' ? (
                     <motion.div animate={{ scale: [1, 1.2, 1] }} transition={{ repeat: Infinity, duration: 1.5 }}>
                        <Play size={24} />
                     </motion.div>
                  ) : room.status === 'waiting' ? (
                     <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 4, ease: "linear" }}>
                        <Radio size={24} />
                     </motion.div>
                  ) : (
                     <Square size={24} />
                  )}
                </div>
                <div>
                  <h3 className="text-2xl font-bold tracking-tight text-slate-100 uppercase">{room.name}</h3>
                  <div className="flex items-center gap-4 mt-1">
                    <span className={`px-2 py-0.5 rounded uppercase font-bold text-[8px] border ${room.status === 'playing' ? 'bg-rose-500/10 text-rose-400 border-rose-500/20' : room.status === 'waiting' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-slate-500/10 text-slate-400 border-slate-500/20'}`}>
                      {room.status}
                    </span>
                    <span className="px-2 py-0.5 rounded uppercase font-black text-[8px] border bg-cyan-900/40 text-cyan-400 border-cyan-800/50">
                      {room.gameMode || 'DEATHMATCH'}
                    </span>
                    <span className="text-[10px] font-mono text-slate-400 uppercase tracking-widest">{room.timerSeconds}s</span>
                    <span className="text-[10px] font-mono text-slate-400 uppercase tracking-widest gap-1 flex items-center"><Users size={12} /> {room.players?.length || 0}</span>
                  </div>
                </div>
              </div>
              
              <div className="flex items-center gap-4">
                {isMyTab && (
                  <>
                     {room.status === 'playing' ? (
                        <div className="flex items-center gap-2">
                           <span className="text-[10px] uppercase text-emerald-500 tracking-widest font-bold px-2">IN COMBAT</span>
                           <button 
                             onClick={(e) => {
                               e.stopPropagation();
                               socket.emit('update_room', { id: room.id, status: 'inactive' });
                               if (isActive) onLeaveRoom();
                             }} 
                             className="px-3 py-1 bg-rose-600/20 hover:bg-rose-600/40 text-rose-400 border border-rose-500/30 rounded text-xs font-bold uppercase tracking-wider"
                             title="Terminate Match"
                           >
                             STOP
                           </button>
                        </div>
                     ) : (
                        <>
                           {editingRoomId === room.id ? (
                              <div className="flex items-center gap-2">
                                 <input 
                                   type="number" 
                                   className="w-16 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-center font-mono" 
                                   value={editTimer} 
                                   onChange={e => {
                                     let v = parseInt(e.target.value);
                                     if (v > 900) e.target.value = '900';
                                     setEditTimer(e.target.value);
                                   }} 
                                   onBlur={() => {
                                     let v = parseInt(editTimer);
                                     if (isNaN(v) || v < 5) setEditTimer('5');
                                   }}
                                 />
                                 <button onClick={(e) => saveEdit(room.id, e)} className="p-2 bg-emerald-600 hover:bg-emerald-500 rounded text-white" title="Save Timer"><Plus size={14} /></button>
                                 <button onClick={(e) => { e.stopPropagation(); setEditingRoomId(null); }} className="p-2 bg-slate-700 hover:bg-slate-600 rounded text-slate-300" title="Cancel"><X size={14} /></button>
                              </div>
                           ) : (
                              <>
                                 {room.status === 'inactive' ? (
                                   <button onClick={(e) => toggleRoomActive(room, true, e)} className="p-2 text-emerald-500 hover:text-emerald-400" title="Start Sector">
                                     <Play size={18} fill="currentColor" />
                                   </button>
                                 ) : (
                                   <button onClick={(e) => toggleRoomActive(room, false, e)} className="p-2 text-rose-500 hover:text-rose-400" title="Stop Sector">
                                     <Square size={18} fill="currentColor" />
                                   </button>
                                 )}
                                 <button onClick={(e) => handleEditClick(room, e)} className="p-2 text-slate-500 hover:text-emerald-400 transition-colors" title="Edit Timer">
                                   <Edit2 size={18} />
                                 </button>
                                 {confirmDeleteId === room.id ? (
                                    <div className="flex items-center gap-2">
                                       <span className="text-[10px] text-rose-500 font-bold uppercase tracking-widest">SURE?</span>
                                       <button onClick={(e) => deleteRoom(room.id, e)} className="p-2 bg-rose-600 hover:bg-rose-500 rounded text-white"><Trash size={14} /></button>
                                       <button onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(null); }} className="p-2 bg-slate-700 hover:bg-slate-600 rounded text-slate-300"><X size={14} /></button>
                                    </div>
                                 ) : (
                                    <button onClick={(e) => deleteRoom(room.id, e)} className="p-2 text-slate-500 hover:text-rose-400 transition-colors" title="Delete Sector">
                                      <Trash size={18} />
                                    </button>
                                 )}
                              </>
                           )}
                        </>
                     )}
                  </>
                )}
                
                {!isMyTab && (
                  <button 
                    onClick={(e) => {
                        e.stopPropagation();
                        if (isActive) {
                           if (joinedRoom.hostId === userId) {
                              socket.emit('update_room', { id: joinedRoom.id, status: 'inactive' });
                           }
                           onLeaveRoom();
                        } else if (!joinedRoom && room.status !== 'playing') {
                           onJoin(room.id);
                        }
                    }}
                    disabled={(!!joinedRoom && !isActive) || (!isActive && room.status === 'playing')}
                    className={`flex items-center gap-2 px-8 py-3 rounded-xl font-black transition-all text-xs tracking-widest border border-slate-700 shadow-xl z-10 relative ${
                      isActive ? 'bg-rose-600/20 text-rose-400 border-rose-500 hover:bg-rose-600/30 font-bold' : 
                      ((joinedRoom || room.status === 'playing') ? 'opacity-30 cursor-not-allowed bg-slate-800' : 'bg-slate-800 hover:bg-emerald-600 hover:text-white hover:border-emerald-400')
                    }`}
                  >
                    {!isActive && <Play size={16} fill="currentColor" />}
                    {isActive ? 'LEAVE' : (room.status === 'playing' ? 'IN PROGRESS' : room.status === 'inactive' ? 'JOIN OFFLINE' : 'DEPLOY')}
                  </button>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>
      
      <AnimatePresence>
        {showSettingsModal && (
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }} 
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-[#05070a]/90 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-slate-900 border border-slate-700/50 rounded-2xl p-6 w-full max-w-lg max-h-[95vh] overflow-y-auto shadow-2xl flex flex-col gap-6"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold tracking-tight text-white flex items-center gap-2"><Settings size={20} className="text-emerald-500" /> SETTINGS</h2>
                <button onClick={() => { setShowSettingsModal(false); setConfirmLogout(false); }} className="p-2 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg">
                  <X size={18} />
                </button>
              </div>

              {/* Account Section */}
              <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50 flex flex-col gap-3">
                 <h3 className="text-[10px] uppercase font-bold tracking-widest text-emerald-500 mb-1 flex items-center gap-2"><User size={14} /> Profile Check</h3>
                 
                 <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-mono text-slate-400 uppercase">Pilot Name</label>
                    <input 
                       value={profileName}
                       onChange={(e) => setProfileName(e.target.value.toUpperCase())}
                       onKeyDown={(e) => {
                          if (e.key === 'Enter') e.currentTarget.blur();
                       }}
                       onBlur={() => {
                          if (profileName.trim()) {
                              try {
                                  const sel = JSON.parse(localStorage.getItem('tankSelection') || '{}');
                                  sel.name = profileName.trim().toUpperCase();
                                  localStorage.setItem('tankSelection', JSON.stringify(sel));
                              } catch(e) {}
                          }
                       }}
                       className="bg-slate-900 border border-slate-700 focus:border-emerald-500 outline-none rounded p-2 text-sm text-slate-200 font-bold"
                    />
                 </div>
                 
                 <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-mono text-slate-400 uppercase">Pilot ID</label>
                    <div className="bg-slate-900/50 border border-slate-700/50 rounded p-2 text-sm text-slate-300 font-mono">
                      {userId || 'UNKNOWN'}
                    </div>
                 </div>
              </div>

              {/* Room Creation */}
              <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50 flex flex-col gap-3">
                 <h3 className="text-[10px] uppercase font-bold tracking-widest text-purple-400 mb-1 flex items-center gap-2"><Square size={14} /> Initialize Sector</h3>
                 
                 <div className="flex flex-col sm:flex-row gap-2">
                    <input 
                      value={newRoomName}
                      onChange={(e) => setNewRoomName(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''))}
                      placeholder="SECTOR NAME" 
                      className="bg-slate-900 border border-slate-700 focus:border-purple-500 outline-none rounded p-2 text-sm text-slate-200 font-bold flex-1"
                    />
                    <CustomSelect 
                      value={newRoomMode}
                      onChange={(v: GameMode) => setNewRoomMode(v)}
                      className="bg-slate-900 border border-slate-700 rounded h-10 sm:w-40 z-10"
                      options={[
                        { value: 'DUO', label: 'DUO COLLISION' },
                        { value: 'SOLO_RESPAWN', label: 'SOLO (RESPAWNS)' },
                        { value: 'SOLO_NO_RESPAWN', label: 'SOLO COLLISION' }
                      ]}
                    />
                 </div>

                 <div className="flex gap-2">
                    <div className="flex items-center bg-slate-900 border border-slate-700 rounded px-2 w-[120px]">
                        <span className="text-[10px] text-slate-500 font-mono tracking-widest mr-2">SEC</span>
                        <input 
                           type="number"
                           value={newRoomTimer}
                           onChange={(e) => {
                             let v = parseInt(e.target.value);
                             if (v > 900) e.target.value = '900';
                             setNewRoomTimer(e.target.value);
                           }}
                           onBlur={() => {
                             let v = parseInt(newRoomTimer);
                             if (isNaN(v) || v < 5) setNewRoomTimer('5');
                           }}
                           className="bg-transparent text-sm font-bold text-slate-200 outline-none w-full py-2"
                        />
                    </div>
                    <button 
                      onClick={() => {
                          createRoom();
                          setShowSettingsModal(false);
                      }}
                      disabled={creating || !newRoomName || !newRoomTimer}
                      className="flex-1 flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-500 text-white rounded font-bold transition-all disabled:opacity-50"
                    >
                      <Plus size={16} /> INITIALIZE
                    </button>
                 </div>
              </div>

              {/* Danger Zone */}
              {!confirmLogout ? (
                 <button onClick={() => setConfirmLogout(true)} className="flex items-center justify-center gap-2 p-3 text-rose-400 hover:text-white bg-slate-800 hover:bg-rose-600 transition-colors rounded-xl font-bold border border-rose-900/50">
                   <LogOut size={16} /> DEAUTHORIZE AND EXIT
                 </button>
              ) : (
                 <div className="bg-rose-900/20 border border-rose-900 p-4 rounded-xl flex flex-col gap-3">
                   <p className="text-sm text-rose-400 font-bold text-center">Are you sure you want to log out?</p>
                   <div className="flex gap-2">
                     <button onClick={() => setConfirmLogout(false)} className="flex-1 p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded font-bold transition-colors">
                       CANCEL
                     </button>
                     <button onClick={onLogout} className="flex-1 p-2 bg-rose-600 hover:bg-rose-500 text-white rounded font-bold transition-colors">
                       CONFIRM EXIT
                     </button>
                   </div>
                 </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

