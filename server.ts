import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import http from "http";
import { Server } from "socket.io";
import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, setDoc, doc, deleteDoc } from "firebase/firestore";
import { getAuth, signInAnonymously } from "firebase/auth";
import fs from "fs";

const firebaseConfig = {
  projectId: "gen-lang-client-0222552115",
  apiKey: "AIzaSyA7XqBignqgJ_BLW-sog9PioHKgtPrf0mw",
  authDomain: "gen-lang-client-0222552115.firebaseapp.com",
};
const app = initializeApp(firebaseConfig);
const DB_ID = "ai-studio-remixsteelvangua-7e7c1b6e-824c-4da2-8b91-c70b700e1187";
// In modular client SDK we can initialize firestore with a specific database ID.
const auth = getAuth(app);
const dbInstance = getFirestore(app, DB_ID);

async function startServer() {
  try {
    await signInAnonymously(auth);
    console.log("Server auth ready");
  } catch(e) {
    console.error("Server auth failed", e);
  }
  const app = express();
  const server = http.createServer(app);
  const PORT = 3000;

  const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
  });

  const roomsDB = new Map<string, any>();
  const rooms = new Map<string, Map<string, any>>();
  
  await new Promise<void>((resolve) => {
    const unsub = auth.onAuthStateChanged((user) => {
      if (user) {
        unsub();
        resolve();
      }
    });
  });

  try {
    const snapshot = await getDocs(collection(dbInstance, 'rooms'));
    snapshot.forEach(d => {
       roomsDB.set(d.id, d.data());
    });
  } catch (e) {
    console.error('Failed to load rooms from Firestore:', e);
  }

  function saveRoomsDB() {
    // We don't save all rooms at once to Firestore here, it's too heavy.
    // Instead we update individual documents.
  }

  function broadcastRooms() {
    const list = Array.from(roomsDB.values());
    io.emit("rooms_update", list);
  }

  io.on("connection", (socket) => {
    let currentRoom = "";
    let currentUserId = "";

    socket.emit("rooms_update", Array.from(roomsDB.values()));

    const getDB = () => dbInstance;

    socket.on("create_room", (roomData) => {
      roomsDB.set(roomData.id, roomData);
      rooms.set(roomData.id, new Map());
      broadcastRooms();
      setDoc(doc(getDB(), 'rooms', roomData.id), roomData).catch(()=>{});
    });

    socket.on("update_room", (updateData) => {
      if (!updateData.id) return;
      const existing = roomsDB.get(updateData.id);
      if (existing) {
         Object.assign(existing, updateData);
         roomsDB.set(updateData.id, existing);
         broadcastRooms();
         setDoc(doc(getDB(), 'rooms', updateData.id), existing).catch(()=>{});
      }
    });

    socket.on("delete_room", (id) => {
      roomsDB.delete(id);
      rooms.delete(id);
      broadcastRooms();
      io.to(id).emit("room_deleted");
      deleteDoc(doc(getDB(), 'rooms', id)).catch(()=>{});
    });

    socket.on("join_room_lobby", ({ roomId, userId }) => {
      const room = roomsDB.get(roomId);
      if (room) {
         if (!room.players) room.players = [];
         if (!room.players.includes(userId)) room.players.push(userId);
         broadcastRooms();
      }
    });

    socket.on("leave_room_lobby", ({ roomId, userId }) => {
      const room = roomsDB.get(roomId);
      if (room && room.players) {
         room.players = room.players.filter((p: string) => p !== userId);
         broadcastRooms();
      }
    });

    socket.on("join_room", ({ roomId, userId, initialData }) => {
      socket.join(roomId);
      currentRoom = roomId;
      currentUserId = userId;

      if (!rooms.has(roomId)) {
        rooms.set(roomId, new Map());
      }
      
      const room = rooms.get(roomId)!;
      room.set(userId, { ...initialData, userId });
      
      // Send current state of the room to the new user
      socket.emit("room_state", Array.from(room.values()));
      
      // Tell others about the newly joined user
      socket.to(roomId).emit("player_joined", { ...initialData, userId });
    });

    socket.on("sync_player", (data) => {
      if (!currentRoom || !currentUserId) return;
      
      const targetUser = data.userId || currentUserId;
      const room = rooms.get(currentRoom);
      if (room && room.has(targetUser)) {
         const p = room.get(targetUser);
         Object.assign(p, data);
         
         const isImportant = data.health !== undefined || data.lives !== undefined || data.score !== undefined || data.aborted !== undefined || data.isAlive !== undefined;
         
         if (isImportant) {
            socket.to(currentRoom).emit("sync_player", { ...data, userId: targetUser });
            // If the sender is updating themselves, the target doesn't receive it normally,
            // but sender already modified it locally. If updating someone else, target receives it via 'to(room)'.
         } else {
            socket.to(currentRoom).volatile.emit("sync_player", { ...data, userId: targetUser });
         }
      }
    });
    
    socket.on("player_shoot", (data) => {
      if (!currentRoom) return;
      socket.to(currentRoom).emit("player_shoot", data);
    });
    
    socket.on("player_hit", (data) => {
      if (!currentRoom) return;
      socket.to(currentRoom).emit("player_hit", data);
    });
    
    socket.on("kill_event", (data) => {
      if (!currentRoom) return;
      socket.to(currentRoom).emit("kill_event", data);
      socket.emit("kill_event", data); // send to self as well if we don't update locally
    });

    socket.on("leave_room", () => {
       if (currentRoom && currentUserId) {
         socket.leave(currentRoom);
         const room = rooms.get(currentRoom);
         if (room) {
           socket.to(currentRoom).volatile.emit("sync_player", { userId: currentUserId, aborted: true });
           room.delete(currentUserId);
           io.to(currentRoom).emit("player_left", currentUserId);
           if (room.size === 0) {
             rooms.delete(currentRoom);
           }
         }
         currentRoom = "";
         currentUserId = "";
       }
    });

    socket.on("disconnect", () => {
      if (currentRoom && currentUserId) {
         const room = rooms.get(currentRoom);
         if (room) {
           socket.to(currentRoom).volatile.emit("sync_player", { userId: currentUserId, aborted: true });
           room.delete(currentUserId);
           io.to(currentRoom).emit("player_left", currentUserId);
           if (room.size === 0) {
             rooms.delete(currentRoom);
           }
         }
      }
    });
  });

  // API routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  const isProd = process.env.NODE_ENV === 'production' || typeof require !== 'undefined';

  // Vite middleware for development
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
