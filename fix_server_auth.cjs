const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

const target = `const auth = getAuth(app);
signInAnonymously(auth).catch(() => {});
const dbInstance = getFirestore(app, DB_ID);


async function startServer() {`;

const replacement = `const auth = getAuth(app);
const dbInstance = getFirestore(app, DB_ID);

async function startServer() {
  try {
    await signInAnonymously(auth);
    console.log("Server auth ready");
  } catch(e) {
    console.error("Server auth failed", e);
  }`;

code = code.replace(target, replacement);
fs.writeFileSync('server.ts', code);
console.log("FIXED SERVER AUTH");
