const fs = require('fs');
let code = fs.readFileSync('src/game/GameClient.tsx', 'utf8');

// 1. Remove duplicate sync_player block
const duplicateTarget = `             // Sync our own stats that might have been updated by others (kills, damage)
             if (state.current.localPlayer) {
                if (p.score !== undefined && p.score > (state.current.localPlayer.score || 0)) {
                   state.current.localPlayer.score = p.score;
                   setScore(p.score);
                }
                
                // IMPORTANT: Accept health updates from other players (shooter authority)
                if (p.health !== state.current.localPlayer.health || (!p.isAlive && state.current.localPlayer.isAlive)) {
                   if (p.health < state.current.localPlayer.health) {
                      (state.current as any).lastDamageTime = Date.now();
                   }
                   state.current.localPlayer.health = p.health;
                   setHealth(p.health);
                   
                   if (!p.isAlive && state.current.localPlayer.isAlive) {
                      state.current.isDead = true;
                      setIsAlive(false);
                      state.current.localPlayer.isAlive = false;
                      const newLives = p.lives ?? (room.gameMode === 'SOLO_RESPAWN' ? 999 : 1);
                      state.current.localPlayer.lives = newLives;
                      setLives(newLives);
                      
                      if (newLives > 0) {
                          const spawn = getValidSpawn(state.current.mapObjects, state.current.remotePlayers);
                          state.current.localPlayer.x = spawn.x;
                          state.current.localPlayer.y = spawn.y;
                          socketRef.current?.emit('sync_player', {
                              x: spawn.x,
                              y: spawn.y,
                              vx: 0,
                              vy: 0,
                              rotation: 0
                          });
                          (state.current as any).respawnTime = Date.now() + 5000;
                          setRespawnCountdown(5);
                      }
                   }
                }
             }`;
code = code.replace(duplicateTarget, "");

// 2. Fix bot logic respawn
const botTarget = `                       if (newLives === 0) {
                           updateDoc(doc(db, \`rooms/\${roomId}\`), {
                               players: arrayRemove(s.userId)
                           }).catch(()=>{});
                       }`;
const botReplacement = `                       if (newLives === 0) {
                           updateDoc(doc(db, \`rooms/\${roomId}\`), {
                               players: arrayRemove(s.userId)
                           }).catch(()=>{});
                       } else {
                           const spawn = getValidSpawn(s.mapObjects, s.remotePlayers);
                           s.localPlayer.x = spawn.x;
                           s.localPlayer.y = spawn.y;
                           (s as any).respawnTime = Date.now() + 5000;
                           setRespawnCountdown(5);
                       }`;
code = code.replace(botTarget, botReplacement);

// 3. Fix connectedHumanCount in update loop
const countTarget = `          // Real-player room auto-exit if fewer than 2 players remain on the map
          let connectedHumanCount = 0;
          if (state.current.localPlayer && !state.current.localPlayer.lastAction?.includes('aborted')) {
              connectedHumanCount++;
          }
          state.current.remotePlayers.forEach((p) => {
              if (!p.isBot && !p.lastAction?.includes('aborted')) {
                  connectedHumanCount++;
              }
          });
          if (!room.isBotMode && connectedHumanCount < 2) {
              shouldEnd = true;
          }`;
const countReplacement = `          // Real-player room auto-exit if fewer than 2 players remain on the map
          let connectedHumanCount = 1; // local player is always connected while mounted
          state.current.remotePlayers.forEach((p) => {
              if (!p.isBot) connectedHumanCount++;
          });
          if (!room.isBotMode && connectedHumanCount < 2) {
              shouldEnd = true;
          }`;
code = code.replace(countTarget, countReplacement);

fs.writeFileSync('src/game/GameClient.tsx', code);
console.log("FIXED GAME CLIENT");
