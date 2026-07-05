const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

const target1 = `import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";`;
const replacement1 = `import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, setDoc, doc, deleteDoc } from "firebase/firestore";`;
code = code.replace(target1, replacement1);

const target2 = `const app = initializeApp({
  projectId: "gen-lang-client-0222552115"
});
const DB_ID = "ai-studio-remixsteelvangua-7e7c1b6e-824c-4da2-8b91-c70b700e1187";
// The syntax for named databases in v12+ is getFirestore(app, DB_ID)`;
const replacement2 = `const firebaseConfig = {
  projectId: "gen-lang-client-0222552115",
  apiKey: "AIzaSyA7XqBignqgJ_BLW-sog9PioHKgtPrf0mw",
  authDomain: "gen-lang-client-0222552115.firebaseapp.com",
};
const app = initializeApp(firebaseConfig);
const DB_ID = "ai-studio-remixsteelvangua-7e7c1b6e-824c-4da2-8b91-c70b700e1187";
// In modular client SDK we can initialize firestore with a specific database ID.
const dbInstance = getFirestore(app, DB_ID);`;
code = code.replace(target2, replacement2);

const target3 = `    const dbInstance = getFirestore(app, DB_ID);
    const snapshot = await dbInstance.collection('rooms').get();
    snapshot.forEach(doc => {
       roomsDB.set(doc.id, doc.data());
    });`;
const replacement3 = `    const snapshot = await getDocs(collection(dbInstance, 'rooms'));
    snapshot.forEach(d => {
       roomsDB.set(d.id, d.data());
    });`;
code = code.replace(target3, replacement3);

const target4 = `    try {
      const snapshot = await getFirestore(app).collection('rooms').get();
      snapshot.forEach(doc => {
         roomsDB.set(doc.id, doc.data());
      });
    } catch(e2) {
       console.error('Failed entirely', e2);
    }`;
const replacement4 = `    try {
      const fallbackDb = getFirestore(app);
      const snapshot = await getDocs(collection(fallbackDb, 'rooms'));
      snapshot.forEach(d => {
         roomsDB.set(d.id, d.data());
      });
    } catch(e2) {
       console.error('Failed entirely', e2);
    }`;
code = code.replace(target4, replacement4);

const target5 = `    const getDB = () => {
       try { return getFirestore(app, DB_ID); } catch(e) { return getFirestore(app); }
    };`;
const replacement5 = `    const getDB = () => dbInstance;`;
code = code.replace(target5, replacement5);

const target6 = `getDB().collection('rooms').doc(roomData.id).set(roomData).catch(()=>{});`;
const replacement6 = `setDoc(doc(getDB(), 'rooms', roomData.id), roomData).catch(()=>{});`;
code = code.replace(target6, replacement6);
// since it appears twice:
code = code.replace(target6, replacement6);

const target7 = `getDB().collection('rooms').doc(updateData.id).set(existing).catch(()=>{});`;
const replacement7 = `setDoc(doc(getDB(), 'rooms', updateData.id), existing).catch(()=>{});`;
code = code.replace(target7, replacement7);
// twice:
code = code.replace(target7, replacement7);

const target8 = `getDB().collection('rooms').doc(id).delete().catch(()=>{});`;
const replacement8 = `deleteDoc(doc(getDB(), 'rooms', id)).catch(()=>{});`;
code = code.replace(target8, replacement8);

fs.writeFileSync('server.ts', code);
console.log("REPLACED ALL");
