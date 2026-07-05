const fs = require('fs');
let code = fs.readFileSync('src/game/GameClient.tsx', 'utf-8');

// The proxy objects will handle updates automatically.
// The only thing we need is to fix `const socket = io({ path: '/socket.io' });` since we imported socket globally.
code = code.replace("const socket = io({ path: '/socket.io' });", "socket.connect();");

fs.writeFileSync('src/game/GameClient.tsx', code);
console.log("Done");
