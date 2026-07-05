# Security Specification: Steel Vanguard Firebase Rules

This document outlines the security invariants, adversarial payloads, and test structures to ensure the Firestore security configuration is impenetrable.

## 1. Data Invariants

* **Identity & Ownership Integrity**: A player state document in `/rooms/{roomId}/players/{userId}` can only be created or modified by the user whose `auth.uid` matches `{userId}`.
* **Room Sovereignty**: Only the host of a room (`hostId` matches `auth.uid`) can modify room status, timers, and seeds after creation. Non-hosts can only join/leave the players subcollection.
* **Strict Schema Structure**: No document can contain untyped "shadow fields" (e.g., `role`, `isAdmin`, or auxiliary state keys) not explicitly declared in `firebase-blueprint.json`.
* **Value & Bounds Sanity**: Numeric attributes (e.g., `health` inside `[0, 100]`, `lives` inside `[0, 3]`) must be strictly constrained to prevent buffer-poisoning or logic exploits.
* **Temporal Integrity**: Creation and update timestamps must match the server-reported `request.time`.
* **Terminal Lock**: Once a Room status is set to `finished`, it cannot be reverted or updated to bypass final state locking.

---

## 2. The "Dirty Dozen" Payloads

Here are twelve highly specific adversarial JSON payloads designed to breach the system. All must trigger `PERMISSION_DENIED`.

### Payload 1: Player Identity Spoofing (Identity Breach)
* **Goal**: Write to another player's profile inside a room.
* **Path**: `/rooms/SECTOR-A/players/victim_user_123`
* **Auth Context**: `auth.uid = "attacker_456"`
* **Payload**:
  ```json
  {
    "userId": "victim_user_123",
    "name": "SPOOFED_PILOT",
    "health": 100,
    "score": 9999,
    "color": "#ef4444",
    "tankType": "heavy",
    "isAlive": true,
    "updatedAt": "request.time"
  }
  ```

### Payload 2: Self-Assigned Privileged Claims (Privilege Escalation)
* **Goal**: Inject unauthorized `role` or `isAdmin` fields into the player document.
* **Path**: `/rooms/SECTOR-A/players/attacker_456`
* **Auth Context**: `auth.uid = "attacker_456"`
* **Payload**:
  ```json
  {
    "userId": "attacker_456",
    "name": "ATTACKER",
    "health": 100,
    "score": 0,
    "color": "#ef4444",
    "tankType": "heavy",
    "isAlive": true,
    "isAdmin": true,
    "role": "owner",
    "updatedAt": "request.time"
  }
  ```

### Payload 3: Hijacking Room Ownership (Host Spoofing)
* **Goal**: Write a new room or hijack an existing one claiming to be the host of a room we do not own.
* **Path**: `/rooms/SECTOR-A`
* **Auth Context**: `auth.uid = "attacker_456"` (victim is host)
* **Payload (Update)**:
  ```json
  {
    "hostId": "attacker_456",
    "status": "playing",
    "updatedAt": "request.time"
  }
  ```

### Payload 4: Invalid Health Injection (Value Poisoning)
* **Goal**: Grant the tank negative or extreme health, bypassing game loop logic.
* **Path**: `/rooms/SECTOR-A/players/attacker_456`
* **Auth Context**: `auth.uid = "attacker_456"`
* **Payload**:
  ```json
  {
    "userId": "attacker_456",
    "name": "ATTACKER",
    "health": -500,
    "score": 0,
    "color": "#ef4444",
    "tankType": "heavy",
    "isAlive": true,
    "updatedAt": "request.time"
  }
  ```

### Payload 5: Rapid Fire/Bullet Spoofing (Resource Poisoning)
* **Goal**: Inject a bullet with an invalid massive velocity.
* **Path**: `/rooms/SECTOR-A/bullets/malicious_bullet`
* **Auth Context**: `auth.uid = "attacker_456"`
* **Payload**:
  ```json
  {
    "bulletId": "malicious_bullet",
    "playerId": "attacker_456",
    "x": 100,
    "y": 100,
    "vx": 999999,
    "vy": 999999,
    "createdAt": "request.time"
  }
  ```

### Payload 6: Shadow Room Fields (Ghost Injection)
* **Goal**: Push undocumented attributes into the room structure.
* **Path**: `/rooms/SECTOR-A`
* **Auth Context**: `auth.uid = "attacker_456"`
* **Payload**:
  ```json
  {
    "name": "SECTOR-A",
    "status": "waiting",
    "hostId": "attacker_456",
    "createdAt": "request.time",
    "updatedAt": "request.time",
    "hacky_secret_key": "bypass_value"
  }
  ```

### Payload 7: Eternal Match (Temporal Tampering)
* **Goal**: Bypass server timestamps by feeding historical client times.
* **Path**: `/rooms/SECTOR-A`
* **Auth Context**: `auth.uid = "attacker_456"` (room host)
* **Payload**:
  ```json
  {
    "updatedAt": "1999-12-31T23:59:59Z"
  }
  ```

### Payload 8: Immutable Creation Tampering (Immortality Bypass)
* **Goal**: Rewrite `createdAt` of a room or PlayerState after initialization.
* **Path**: `/rooms/SECTOR-A`
* **Auth Context**: `auth.uid = "attacker_456"`
* **Payload**:
  ```json
  {
    "createdAt": "2026-07-01T12:00:00Z"
  }
  ```

### Payload 9: Unverified Email Login (Auth Spoofing)
* **Goal**: Write game objects using an unverified account.
* **Path**: `/rooms/SECTOR-A/players/attacker_456`
* **Auth Context**: `auth.uid = "attacker_456"`, `auth.token.email_verified = false`
* **Payload**:
  ```json
  {
    "userId": "attacker_456",
    "name": "UNVERIFIED_PILOT",
    "health": 100,
    "score": 0,
    "color": "#3b82f6",
    "tankType": "scout",
    "isAlive": true,
    "updatedAt": "request.time"
  }
  ```

### Payload 10: Map Destructible Corruption (Value Manipulation)
* **Goal**: Destroy/tamper map objects directly with invalid high health or types.
* **Path**: `/rooms/SECTOR-A/mapObjects/object_0`
* **Auth Context**: `auth.uid = "attacker_456"`
* **Payload**:
  ```json
  {
    "type": "wall",
    "x": 500,
    "y": 500,
    "health": 1000000
  }
  ```

### Payload 11: Locked Match Hijacking (Terminal State Bypass)
* **Goal**: Modify an inactive/finished match to reset status.
* **Path**: `/rooms/SECTOR-A`
* **Auth Context**: `auth.uid = "attacker_456"`
* **Payload**:
  ```json
  {
    "status": "playing",
    "updatedAt": "request.time"
  }
  ```

### Payload 12: Long/Malformed ID Poisoning (DOS Denial of Wallet)
* **Goal**: Create documents with huge names to consume database storage index space.
* **Path**: `/rooms/MALICIOUS_LONG_ID_REPEATING_A_THOUSAND_TIMES_AAAAAAAAAAAAAAAA...`
* **Auth Context**: `auth.uid = "attacker_456"`
* **Payload**:
  ```json
  {
    "status": "waiting",
    "name": "SPAM",
    "hostId": "attacker_456",
    "createdAt": "request.time",
    "updatedAt": "request.time"
  }
  ```

---

## 3. The Test Runner File (`firestore.rules.test.ts`)

```typescript
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  RulesTestEnvironment,
} from "@firebase/rules-unit-tests";
import { readFileSync } from "fs";

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "gen-lang-client-0222552115",
    firestore: {
      rules: readFileSync("firestore.rules", "utf8"),
    },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

describe("Steel Vanguard Security Rules Unit Tests", () => {
  beforeEach(async () => {
    await testEnv.clearFirestore();
  });

  it("fails: Player Identity Spoofing (Payload 1)", async () => {
    const context = testEnv.authenticatedContext("attacker_456", { email_verified: true });
    const victimDoc = context.firestore().doc("rooms/SECTOR-A/players/victim_user_123");
    await assertFails(victimDoc.set({
      userId: "victim_user_123",
      name: "SPOOFED_PILOT",
      health: 100,
      score: 9999,
      color: "#ef4444",
      tankType: "heavy",
      isAlive: true,
      updatedAt: new Date()
    }));
  });

  it("fails: Self-Assigned Privileged Claims (Payload 2)", async () => {
    const context = testEnv.authenticatedContext("attacker_456", { email_verified: true });
    const playerDoc = context.firestore().doc("rooms/SECTOR-A/players/attacker_456");
    await assertFails(playerDoc.set({
      userId: "attacker_456",
      name: "ATTACKER",
      health: 100,
      score: 0,
      color: "#ef4444",
      tankType: "heavy",
      isAlive: true,
      isAdmin: true,
      role: "owner",
      updatedAt: new Date()
    }));
  });

  it("fails: Hijacking Room Ownership (Payload 3)", async () => {
    // Setup initial room with victim as host
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc("rooms/SECTOR-A").set({
        id: "SECTOR-A",
        name: "SECTOR-A",
        status: "waiting",
        hostId: "victim_123",
        createdAt: new Date(),
        updatedAt: new Date()
      });
    });

    const context = testEnv.authenticatedContext("attacker_456", { email_verified: true });
    const roomDoc = context.firestore().doc("rooms/SECTOR-A");
    await assertFails(roomDoc.update({
      hostId: "attacker_456",
      status: "playing",
      updatedAt: new Date()
    }));
  });

  it("fails: Invalid Health Injection (Payload 4)", async () => {
    const context = testEnv.authenticatedContext("attacker_456", { email_verified: true });
    const playerDoc = context.firestore().doc("rooms/SECTOR-A/players/attacker_456");
    await assertFails(playerDoc.set({
      userId: "attacker_456",
      name: "ATTACKER",
      health: -500,
      score: 0,
      color: "#ef4444",
      tankType: "heavy",
      isAlive: true,
      updatedAt: new Date()
    }));
  });

  it("fails: Invalid massive Bullet velocity (Payload 5)", async () => {
    const context = testEnv.authenticatedContext("attacker_456", { email_verified: true });
    const bulletDoc = context.firestore().doc("rooms/SECTOR-A/bullets/malicious_bullet");
    await assertFails(bulletDoc.set({
      bulletId: "malicious_bullet",
      playerId: "attacker_456",
      x: 100,
      y: 100,
      vx: 999999,
      vy: 999999,
      createdAt: new Date()
    }));
  });

  it("fails: Shadow Room Fields (Payload 6)", async () => {
    const context = testEnv.authenticatedContext("attacker_456", { email_verified: true });
    const roomDoc = context.firestore().doc("rooms/SECTOR-A");
    await assertFails(roomDoc.set({
      id: "SECTOR-A",
      name: "SECTOR-A",
      status: "waiting",
      hostId: "attacker_456",
      createdAt: new Date(),
      updatedAt: new Date(),
      hacky_secret_key: "bypass_value"
    }));
  });

  it("fails: Temporal Tampering (Payload 7)", async () => {
    const context = testEnv.authenticatedContext("attacker_456", { email_verified: true });
    const roomDoc = context.firestore().doc("rooms/SECTOR-A");
    await assertFails(roomDoc.set({
      id: "SECTOR-A",
      name: "SECTOR-A",
      status: "waiting",
      hostId: "attacker_456",
      createdAt: new Date(),
      updatedAt: "1999-12-31T23:59:59Z"
    }));
  });

  it("fails: Immutable Creation Tampering (Payload 8)", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc("rooms/SECTOR-A").set({
        id: "SECTOR-A",
        name: "SECTOR-A",
        status: "waiting",
        hostId: "attacker_456",
        createdAt: new Date(),
        updatedAt: new Date()
      });
    });

    const context = testEnv.authenticatedContext("attacker_456", { email_verified: true });
    const roomDoc = context.firestore().doc("rooms/SECTOR-A");
    await assertFails(roomDoc.update({
      createdAt: "2026-07-01T12:00:00Z",
      updatedAt: new Date()
    }));
  });

  it("fails: Unverified Email Login (Payload 9)", async () => {
    const context = testEnv.authenticatedContext("attacker_456", { email_verified: false });
    const playerDoc = context.firestore().doc("rooms/SECTOR-A/players/attacker_456");
    await assertFails(playerDoc.set({
      userId: "attacker_456",
      name: "UNVERIFIED_PILOT",
      health: 100,
      score: 0,
      color: "#3b82f6",
      tankType: "scout",
      isAlive: true,
      updatedAt: new Date()
    }));
  });

  it("fails: Map Destructible Corruption (Payload 10)", async () => {
    const context = testEnv.authenticatedContext("attacker_456", { email_verified: true });
    const mapObjDoc = context.firestore().doc("rooms/SECTOR-A/mapObjects/object_0");
    await assertFails(mapObjDoc.set({
      type: "wall",
      x: 500,
      y: 500,
      health: 1000000
    }));
  });

  it("fails: Locked Match Hijacking (Payload 11)", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc("rooms/SECTOR-A").set({
        id: "SECTOR-A",
        name: "SECTOR-A",
        status: "inactive",
        hostId: "victim_123",
        createdAt: new Date(),
        updatedAt: new Date()
      });
    });

    const context = testEnv.authenticatedContext("attacker_456", { email_verified: true });
    const roomDoc = context.firestore().doc("rooms/SECTOR-A");
    await assertFails(roomDoc.update({
      status: "playing",
      updatedAt: new Date()
    }));
  });

  it("fails: ID Poisoning (Payload 12)", async () => {
    const context = testEnv.authenticatedContext("attacker_456", { email_verified: true });
    const longId = "MALICIOUS_LONG_ID_" + "A".repeat(500);
    const roomDoc = context.firestore().doc(`rooms/${longId}`);
    await assertFails(roomDoc.set({
      id: longId,
      status: "waiting",
      name: "SPAM",
      hostId: "attacker_456",
      createdAt: new Date(),
      updatedAt: new Date()
    }));
  });
});
