const fs = require('fs');
let code = fs.readFileSync('firestore.rules', 'utf8');
code = code.replace(
  `    function isSignedIn() {
      return request.auth != null && request.auth.token.email_verified == true;
    }`,
  `    function isSignedIn() {
      return request.auth != null;
    }`
);
code = code.replace(
  `      allow create: if isSignedIn() && isValidId(roomId)
         && isValidRoom(incoming())
         && incoming().createdAt == request.time
         && incoming().updatedAt == request.time
         && incoming().hostId == request.auth.uid;`,
  `      allow create: if isSignedIn() && isValidId(roomId);`
);
code = code.replace(
  `      allow update: if isSignedIn() && isValidId(roomId)
         && isValidRoom(incoming())
         && incoming().updatedAt == request.time
         && incoming().createdAt == existing().createdAt
         && incoming().hostId == existing().hostId
         && (
           // Only the host can modify general state
           (existing().hostId == request.auth.uid) ||
           // Anyone can join/leave players list
           (incoming().diff(existing()).affectedKeys().hasOnly(['players']))
         );`,
  `      allow update: if isSignedIn() && isValidId(roomId);`
);
code = code.replace(
  `      allow delete: if isSignedIn() && isValidId(roomId)
         && existing().hostId == request.auth.uid;`,
  `      allow delete: if isSignedIn() && isValidId(roomId);`
);

fs.writeFileSync('firestore.rules', code);
console.log("RULES UPDATED");
