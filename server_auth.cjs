const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

const target = `import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, setDoc, doc, deleteDoc } from "firebase/firestore";`;
const replacement = `import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, setDoc, doc, deleteDoc } from "firebase/firestore";
import { getAuth, signInAnonymously } from "firebase/auth";`;
code = code.replace(target, replacement);

const target2 = `const dbInstance = getFirestore(app, DB_ID);`;
const replacement2 = `const auth = getAuth(app);
signInAnonymously(auth).catch(() => {});
const dbInstance = getFirestore(app, DB_ID);`;
code = code.replace(target2, replacement2);

fs.writeFileSync('server.ts', code);
console.log("REPLACED AUTH");
