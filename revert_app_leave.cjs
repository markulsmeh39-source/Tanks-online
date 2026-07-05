const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const target = `  const handleLeaveMatch = () => {
    if (joinedRoom && joinedRoom.matchId) {
      setLeftMatchId(joinedRoom.matchId);
      localStorage.setItem('leftMatchId', joinedRoom.matchId);
      handleLeaveRoom();
    }
  };`;

const replacement = `  const handleLeaveMatch = () => {
    if (joinedRoom && joinedRoom.matchId) {
      setLeftMatchId(joinedRoom.matchId);
      localStorage.setItem('leftMatchId', joinedRoom.matchId);
      if (joinedRoom.isBotMode) {
          handleLeaveRoom(); // Only leave room fully if it's a bot match
      }
    }
  };`;

code = code.replace(target, replacement);
fs.writeFileSync('src/App.tsx', code);
console.log("REVERTED APP LEAVE");
