const fs = require('fs');
let code = fs.readFileSync('src/game/GameClient.tsx', 'utf8');

const target1 = `                   // Write damage to DB
                   if (!rp.isBot) {
                       setDoc(doc(db, \`rooms/\${roomId}/players\`, rId), {
                          health: newHp,
                          isAlive: isAlive,
                          lives: newLives
                       }, { merge: true });
                   } else {`;
const replacement1 = `                   // Broadcast damage via socket
                   if (!rp.isBot) {
                       socketRef.current?.emit('sync_player', {
                           userId: rId,
                           health: newHp,
                           isAlive: isAlive,
                           lives: newLives
                       });
                   } else {`;
code = code.replace(target1, replacement1);

const target2 = `                   // Write damage to DB
                   setDoc(doc(db, \`rooms/\${roomId}/players\`, rId), {
                       health: newHp,
                       isAlive: isAlive,
                       lives: newLives
                   }, { merge: true });`;
const replacement2 = `                   // Broadcast damage via socket
                   socketRef.current?.emit('sync_player', {
                       userId: rId,
                       health: newHp,
                       isAlive: isAlive,
                       lives: newLives
                   });`;
code = code.replace(target2, replacement2);

fs.writeFileSync('src/game/GameClient.tsx', code);
console.log("REPLACED SHOOTER SYNC");
