const fs = require('fs');
let code = fs.readFileSync('src/game/GameClient.tsx', 'utf8');

const target = `  const handleReturnToLobby = () => {
    if (room.hostId === user.uid) {
        updateDoc(doc(db, 'rooms', room.id), { status: 'inactive' }).catch(()=>{});
    }
    onExit();
  };`;

const replacement = `  const handleReturnToLobby = () => {
    if (room.hostId === user.uid) {
        updateDoc(doc(db, 'rooms', room.id), { status: 'inactive' }).catch(()=>{});
        socketRef.current?.emit('update_room', { id: room.id, status: 'inactive', matchId: null });
    }
    onExit();
  };`;

code = code.replace(target, replacement);
fs.writeFileSync('src/game/GameClient.tsx', code);
console.log("FIXED HANDLE RETURN TO LOBBY");
