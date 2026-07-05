const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const target = `  const handleLeaveMatch = () => {
    if (joinedRoom && joinedRoom.matchId) {
      setLeftMatchId(joinedRoom.matchId);
      localStorage.setItem('leftMatchId', joinedRoom.matchId);
    }
  };`;

const replacement = `  const handleLeaveMatch = () => {
    if (joinedRoom && joinedRoom.matchId) {
      setLeftMatchId(joinedRoom.matchId);
      localStorage.setItem('leftMatchId', joinedRoom.matchId);
      handleLeaveRoom();
    }
  };`;

code = code.replace(target, replacement);
fs.writeFileSync('src/App.tsx', code);
console.log("FIXED APP LEAVE");
