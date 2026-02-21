(function () {
  "use strict";

  if (!window.firebase) throw new Error("Firebase SDK (compat) er ikke lastet.");
  if (!window.CONFIG || !CONFIG.firebaseConfig) throw new Error("CONFIG.firebaseConfig mangler (config.js).");

  if (!firebase.apps.length) firebase.initializeApp(CONFIG.firebaseConfig);

  const db = firebase.firestore();
  const auth = firebase.auth();

  const CLIENT_ID_KEY = "uv2_clientId";
  const JOINCODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const LEASE_TTL_MS = 60 * 1000;

  function getOrCreateClientId() {
    let id = localStorage.getItem(CLIENT_ID_KEY);
    if (id && typeof id === "string" && id.length >= 8) return id;

    id = "c_" + Date.now().toString(36) + "_" + Math.random().toString(16).slice(2);
    localStorage.setItem(CLIENT_ID_KEY, id);
    return id;
  }

  function leaseUntilTimestampFromNow() {
    return firebase.firestore.Timestamp.fromMillis(Date.now() + LEASE_TTL_MS);
  }

  function randomJoinCode6() {
    let out = "";
    for (let i = 0; i < 6; i++) {
      out += JOINCODE_ALPHABET[Math.floor(Math.random() * JOINCODE_ALPHABET.length)];
    }
    return out;
  }

  async function generateUniqueJoinCode(maxAttempts = 20) {
    for (let i = 0; i < maxAttempts; i++) {
      const code = randomJoinCode6();
      const ref = db.collection("joinCodes").doc(code);
      const snap = await ref.get();
      if (!snap.exists) return code;
    }
    throw new Error("Kunne ikke generere unik joinCode (for mange kollisjoner).");
  }

  window.App = {
    db,
    auth,

    getClientId: function () {
      return getOrCreateClientId();
    },

    ensureSignedInWithGoogle: async function () {
      const user = auth.currentUser;
      if (user) return user;

      const provider = new firebase.auth.GoogleAuthProvider();
      const res = await auth.signInWithPopup(provider);
      return res.user;
    },

    ownerRef: function (ownerId) {
      return db.collection("owners").doc(ownerId);
    },

    sessionRef: function (sessionId) {
      return db.collection("sessions").doc(sessionId);
    },

    joinCodeRef: function (joinCode) {
      return db.collection("joinCodes").doc(joinCode);
    },

    liveStateRef: function (sessionId) {
      return db.collection("sessions").doc(sessionId).collection("state").doc("live");
    },

    listenLiveState: function (sessionId, onData, onError) {
      const ref = this.liveStateRef(sessionId);
      return ref.onSnapshot(
        (snap) => onData(snap.exists ? (snap.data() || {}) : null),
        (err) => {
          if (onError) onError(err);
        }
      );
    },

    getActiveSessionInfo: async function (ownerId) {
      const oRef = this.ownerRef(ownerId);
      const oSnap = await oRef.get();
      if (!oSnap.exists) return null;

      const o = oSnap.data() || {};
      if (!o.activeSessionId || !o.activeJoinCode) return null;

      return { ownerId, activeSessionId: o.activeSessionId, activeJoinCode: o.activeJoinCode };
    },

    controllerWriteLiveState: async function (sessionId, patch) {
      const user = auth.currentUser;
      if (!user) throw new Error("Ikke innlogget.");

      const clientId = getOrCreateClientId();
      const ref = this.liveStateRef(sessionId);

      const write = Object.assign({}, patch || {}, {
        controllerId: clientId,
        controllerTs: firebase.firestore.FieldValue.serverTimestamp(),
        controllerLeaseUntil: leaseUntilTimestampFromNow()
      });

      await ref.set(write, { merge: true });
    },

    startOrReplaceSession: async function (opts) {
      const user = auth.currentUser;
      if (!user) throw new Error("Ikke innlogget.");

      const ownerId = user.uid;
      const clientId = getOrCreateClientId();

      const saveResults = (opts && typeof opts.saveResults === "boolean") ? opts.saveResults : true;
      const programId = (opts && Object.prototype.hasOwnProperty.call(opts, "programId")) ? opts.programId : null;

      const ownerDocRef = this.ownerRef(ownerId);
      const ownerSnap = await ownerDocRef.get();
      const ownerData = ownerSnap.exists ? (ownerSnap.data() || {}) : {};

      const oldSessionId = ownerData.activeSessionId || null;
      const oldJoinCode = ownerData.activeJoinCode || null;

      const newSessionDocRef = db.collection("sessions").doc(); // auto-id
      const sessionId = newSessionDocRef.id;

      if (sessionId === ownerId) {
        throw new Error("Generert sessionId var lik ownerId (ikke tillatt). Prøv igjen.");
      }

      const joinCode = await generateUniqueJoinCode();

      const batch = db.batch();

      if (oldSessionId) {
        batch.set(this.sessionRef(oldSessionId), {
          status: "ended",
          endedAt: firebase.firestore.FieldValue.serverTimestamp(),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      }

      if (oldJoinCode) {
        batch.set(this.joinCodeRef(oldJoinCode), { active: false }, { merge: true });
      }

      batch.set(newSessionDocRef, {
        sessionId,
        ownerId,
        status: "active",
        startedAt: firebase.firestore.FieldValue.serverTimestamp(),
        endedAt: null,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        joinCode,
        saveResults,
        programId
      }, { merge: false });

      batch.set(this.joinCodeRef(joinCode), {
        sessionId,
        ownerId,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        active: true
      }, { merge: false });

      batch.set(ownerDocRef, {
        activeSessionId: sessionId,
        activeJoinCode: joinCode,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      batch.set(this.liveStateRef(sessionId), {
        sessionId,
        status: "idle",
        mode: null,
        roundId: null,
        question: null,

        controllerId: clientId,
        controllerTs: firebase.firestore.FieldValue.serverTimestamp(),
        controllerLeaseUntil: leaseUntilTimestampFromNow()
      }, { merge: false });

      // Viktig: hvis dette feiler får du typisk "Missing or insufficient permissions"
      await batch.commit();

      return { ownerId, sessionId, joinCode };
    }
  };

  auth.onAuthStateChanged(() => {});
})();