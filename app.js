(function () {
  "use strict";

  if (!window.firebase) throw new Error("Firebase SDK (compat) er ikke lastet.");
  if (!window.CONFIG || !CONFIG.firebaseConfig) throw new Error("CONFIG.firebaseConfig mangler (config.js).");

  if (!firebase.apps.length) firebase.initializeApp(CONFIG.firebaseConfig);

  const db = firebase.firestore();
  const auth = firebase.auth ? firebase.auth() : null;

  const CLIENT_ID_KEY = "uv2_clientId";
  const PARTICIPANT_SESSION_KEY = "uv2_participant_session";
  const JOINCODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const LEASE_TTL_MS = 60 * 1000;

  const ALLOWED_MODES = new Set(["multi", "likert", "open", "wordcloud"]);
  const ALLOWED_STATUSES = new Set(["idle", "collect", "results", "paused"]); // Grunnlov

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
    for (let i = 0; i < 6; i++) out += JOINCODE_ALPHABET[Math.floor(Math.random() * JOINCODE_ALPHABET.length)];
    return out;
  }

  async function generateUniqueJoinCode(maxAttempts = 20) {
    for (let i = 0; i < maxAttempts; i++) {
      const code = randomJoinCode6();
      const snap = await db.collection("joinCodes").doc(code).get();
      if (!snap.exists) return code;
    }
    throw new Error("Kunne ikke generere unik joinCode (for mange kollisjoner).");
  }

  function assertAllowedMode(mode) {
    if (!ALLOWED_MODES.has(mode)) {
      throw new Error('Ugyldig mode. Tillatt: "multi", "likert", "open", "wordcloud".');
    }
  }

  function assertAllowedStatus(status) {
    if (!ALLOWED_STATUSES.has(status)) {
      throw new Error('Ugyldig status. Tillatt: "idle", "collect", "results", "paused".');
    }
  }

  function makeRoundId() {
    return "r_" + Date.now().toString(36);
  }

  function nowMs() { return Date.now(); }

  function toMillisMaybe(ts) {
    if (!ts) return null;
    if (typeof ts.toMillis === "function") return ts.toMillis();
    if (typeof ts.seconds === "number") return (ts.seconds * 1000) + Math.floor((ts.nanoseconds || 0) / 1e6);
    return null;
  }

  function isPlainObject(v) {
    return v && typeof v === "object" && !Array.isArray(v);
  }

  function normalizeQuestionForMode(mode, question) {
    if (!question) return null;

    if (mode === "multi") {
      const choices = Array.isArray(question.choices) ? question.choices : null;
      if (!choices || choices.length < 2) throw new Error("Multi krever minst 2 choices.");
      const norm = choices.map((c, idx) => {
        const id = (c && c.id != null) ? String(c.id).trim() : "";
        const label = (c && c.label != null) ? String(c.label).trim() : "";
        if (!id) throw new Error("Multi choice mangler id (rad " + (idx + 1) + ").");
        if (!label) throw new Error("Multi choice mangler label (rad " + (idx + 1) + ").");
        return { id, label };
      });
      return { choices: norm, text: question.text != null ? String(question.text) : null };
    }

    if (!isPlainObject(question)) throw new Error("question må være et objekt.");
    const out = {};
    if (question.text != null) out.text = String(question.text);
    return Object.keys(out).length ? out : null;
  }

  function normalizeProgramItems(items) {
    if (!Array.isArray(items)) throw new Error("Program items må være en array.");
    if (items.length < 1) throw new Error("Program må ha minst 1 item.");
    if (items.length > 200) throw new Error("Program for stort (maks 200 items i MVP).");

    return items.map((it, idx) => {
      if (!isPlainObject(it)) throw new Error("Item #" + (idx + 1) + " er ikke et objekt.");
      const mode = it.mode;
      assertAllowedMode(mode);

      const q = normalizeQuestionForMode(mode, it.question || {});
      if (!q) throw new Error("Item #" + (idx + 1) + " mangler question (eller er tom).");

      return { mode, question: q };
    });
  }

  function sanitizeTitle(title) {
    const t = String(title || "").trim();
    if (!t) throw new Error("Program title mangler.");
    if (t.length > 120) throw new Error("Program title er for lang (maks 120 tegn).");
    return t;
  }

  window.App = {
    db,
    auth,

    getClientId: function () {
      return getOrCreateClientId();
    },

    // ---- Refs (kontrakt) ----
    ownerRef: (ownerId) => db.collection("owners").doc(ownerId),
    sessionRef: (sessionId) => db.collection("sessions").doc(sessionId),
    joinCodeRef: (joinCode) => db.collection("joinCodes").doc(joinCode),
    liveStateRef: (sessionId) => db.collection("sessions").doc(sessionId).collection("state").doc("live"),

    roundVoteRef: function (sessionId, roundId, clientId) {
      return db.collection("sessions").doc(sessionId)
        .collection("rounds").doc(roundId)
        .collection("votes").doc(clientId);
    },

    aggRef: function (sessionId, roundId) {
      return db.collection("sessions").doc(sessionId)
        .collection("rounds").doc(roundId)
        .collection("agg").doc("live");
    },

    // ---- Steg 7: Programs (NY path: owners/{ownerId}/programs/{programId}) ----
    ownerProgramsCol: function (ownerId) {
      return db.collection("owners").doc(ownerId).collection("programs");
    },
    programRef: function (ownerId, programId) {
      return db.collection("owners").doc(ownerId).collection("programs").doc(programId);
    },

    // ---- Join routing (READ ONLY) ----
    resolveJoinCode: async function (joinCode) {
      const code = (joinCode || "").toUpperCase();
      if (!/^[A-Z0-9]{6}$/.test(code)) throw new Error("JoinCode må være 6 tegn (A–Z/0–9).");

      const ref = this.joinCodeRef(code);
      const snap = await ref.get();
      if (!snap.exists) throw new Error("Ukjent joinCode.");

      const data = snap.data() || {};
      if (data.active !== true) throw new Error("JoinCode er ikke aktiv (utløpt/erstattet).");
      if (!data.sessionId) throw new Error("JoinCode mangler sessionId.");

      return { joinCode: code, sessionId: data.sessionId, ownerId: data.ownerId || null };
    },

    setParticipantSession: function (sessionId, joinCode) {
      const payload = {
        sessionId: sessionId || null,
        joinCode: (joinCode || "").toUpperCase(),
        clientId: getOrCreateClientId(),
        savedAtMs: Date.now()
      };
      localStorage.setItem(PARTICIPANT_SESSION_KEY, JSON.stringify(payload));
    },

    getParticipantSession: function () {
      const raw = localStorage.getItem(PARTICIPANT_SESSION_KEY);
      if (!raw) return null;
      try { return JSON.parse(raw); } catch { return null; }
    },

    // ---- Listen (read) ----
    listenLiveState: function (sessionId, onData, onError) {
      const ref = this.liveStateRef(sessionId);
      return ref.onSnapshot(
        (snap) => onData(snap.exists ? (snap.data() || {}) : null),
        (err) => onError && onError(err)
      );
    },

    listenVoteLock: function (sessionId, roundId, clientId, onData, onError) {
      const ref = this.roundVoteRef(sessionId, roundId, clientId);
      return ref.onSnapshot(
        (snap) => onData({ exists: snap.exists, data: snap.exists ? (snap.data() || {}) : null }),
        (err) => onError && onError(err)
      );
    },

    listenAgg: function (sessionId, roundId, onData, onError) {
      const ref = this.aggRef(sessionId, roundId);
      return ref.onSnapshot(
        (snap) => onData(snap.exists ? (snap.data() || {}) : null),
        (err) => onError && onError(err)
      );
    },

    // ---- Submit vote ----
    submitVoteOnce: async function (sessionId, roundId, mode, value) {
      if (!sessionId) throw new Error("Mangler sessionId.");
      if (!roundId) throw new Error("Mangler roundId (venter på reset/ny runde).");
      assertAllowedMode(mode);

      const clientId = getOrCreateClientId();
      const ref = this.roundVoteRef(sessionId, roundId, clientId);

      const res = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (snap.exists) return { ok: true, already: true };

        tx.set(ref, {
          clientId,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          mode,
          value
        }, { merge: false });

        return { ok: true, already: false };
      });

      return res;
    },

    // ---- Controller/Session ----
    ensureSignedInWithGoogle: async function () {
      if (!this.auth) throw new Error("Auth SDK ikke lastet i denne siden.");
      const user = this.auth.currentUser;
      if (user) return user;

      const provider = new firebase.auth.GoogleAuthProvider();
      const res = await this.auth.signInWithPopup(provider);
      return res.user;
    },

    getActiveSessionInfo: async function (ownerId) {
      const snap = await this.ownerRef(ownerId).get();
      if (!snap.exists) return null;
      const o = snap.data() || {};
      if (!o.activeSessionId || !o.activeJoinCode) return null;
      return { ownerId, activeSessionId: o.activeSessionId, activeJoinCode: o.activeJoinCode };
    },

    startOrReplaceSession: async function (opts) {
      if (!this.auth) throw new Error("Auth SDK ikke lastet i denne siden.");
      const user = this.auth.currentUser;
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

      const newSessionDocRef = db.collection("sessions").doc();
      const sessionId = newSessionDocRef.id;
      if (sessionId === ownerId) throw new Error("Generert sessionId var lik ownerId (ikke tillatt).");

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

      await batch.commit();
      return { ownerId, sessionId, joinCode };
    },

    // ---------- Lease-guarded state write ----------
    writeLiveStateWithLease: async function (sessionId, patch) {
      if (!sessionId) throw new Error("Mangler sessionId.");
      if (!patch || typeof patch !== "object") throw new Error("Mangler patch.");

      const myControllerId = getOrCreateClientId();
      const ref = this.liveStateRef(sessionId);

      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw new Error("state/live finnes ikke.");

        const cur = snap.data() || {};
        const curCid = cur.controllerId || null;
        const untilMs = toMillisMaybe(cur.controllerLeaseUntil);
        const active = (untilMs !== null) ? (untilMs > nowMs()) : false;

        if (active && curCid && curCid !== myControllerId) {
          throw new Error("Lease aktiv hos annen controller. Kan ikke skrive nå.");
        }

        tx.set(ref, Object.assign({}, patch, {
          controllerId: myControllerId,
          controllerTs: firebase.firestore.FieldValue.serverTimestamp(),
          controllerLeaseUntil: leaseUntilTimestampFromNow()
        }), { merge: true });
      });
    },

    setLiveStatusLease: async function (sessionId, status) {
      assertAllowedStatus(status);
      await this.writeLiveStateWithLease(sessionId, { status });
      return { status };
    },

    resetRoundLease: async function (sessionId) {
      const roundId = makeRoundId();
      await this.writeLiveStateWithLease(sessionId, { roundId, status: "collect" });
      return { roundId };
    },

    setQuestionLease: async function (sessionId, mode, question) {
      assertAllowedMode(mode);
      const q = normalizeQuestionForMode(mode, question);
      await this.writeLiveStateWithLease(sessionId, { mode, question: q });
      return { mode };
    },

    startQuestionLease: async function (sessionId, mode, question) {
      assertAllowedMode(mode);
      const q = normalizeQuestionForMode(mode, question);
      const roundId = makeRoundId();
      await this.writeLiveStateWithLease(sessionId, {
        mode,
        question: q,
        roundId,
        status: "collect"
      });
      return { roundId };
    },

    // ---- Steg 7: Programs API (NY path) ----
    createProgram: async function (title, items) {
      if (!this.auth) throw new Error("Auth SDK ikke lastet i denne siden.");
      const user = this.auth.currentUser;
      if (!user) throw new Error("Ikke innlogget.");

      const ownerId = user.uid;
      const col = this.ownerProgramsCol(ownerId);
      const doc = col.doc();
      const programId = doc.id;

      const normalizedItems = normalizeProgramItems(items);
      const safeTitle = sanitizeTitle(title);

      await doc.set({
        programId,
        ownerId,
        title: safeTitle,
        items: normalizedItems,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: false });

      return { programId };
    },

    listProgramsForOwner: async function () {
      if (!this.auth) throw new Error("Auth SDK ikke lastet i denne siden.");
      const user = this.auth.currentUser;
      if (!user) throw new Error("Ikke innlogget.");

      const ownerId = user.uid;

      const qs = await this.ownerProgramsCol(ownerId)
        .orderBy("updatedAt", "desc")
        .limit(100)
        .get();

      const out = [];
      qs.forEach((doc) => {
        const d = doc.data() || {};
        out.push({
          programId: doc.id,
          title: d.title || "(uten tittel)",
          updatedAt: d.updatedAt || null,
          createdAt: d.createdAt || null,
          count: Array.isArray(d.items) ? d.items.length : 0
        });
      });
      return out;
    },

    getProgram: async function (programId) {
      if (!this.auth) throw new Error("Auth SDK ikke lastet i denne siden.");
      const user = this.auth.currentUser;
      if (!user) throw new Error("Ikke innlogget.");
      if (!programId) throw new Error("Mangler programId.");

      const ownerId = user.uid;
      const snap = await this.programRef(ownerId, programId).get();
      if (!snap.exists) throw new Error("Program finnes ikke.");

      const data = snap.data() || {};
      if (data.ownerId !== ownerId) throw new Error("Ikke tilgang til dette programmet.");

      const items = normalizeProgramItems(Array.isArray(data.items) ? data.items : []);
      return {
        programId: snap.id,
        ownerId: data.ownerId,
        title: data.title || "",
        items
      };
    },

    setSessionProgramId: async function (sessionId, programId) {
      if (!this.auth) throw new Error("Auth SDK ikke lastet i denne siden.");
      const user = this.auth.currentUser;
      if (!user) throw new Error("Ikke innlogget.");
      if (!sessionId) throw new Error("Mangler sessionId.");

      const sRef = this.sessionRef(sessionId);
      const snap = await sRef.get();
      if (!snap.exists) throw new Error("Session finnes ikke.");
      const s = snap.data() || {};
      if (s.ownerId !== user.uid) throw new Error("Ikke tilgang til session.");

      if (programId) {
        const pSnap = await this.programRef(user.uid, programId).get();
        if (!pSnap.exists) throw new Error("Program finnes ikke.");
        const p = pSnap.data() || {};
        if (p.ownerId !== user.uid) throw new Error("Ikke tilgang til program.");
      }

      await sRef.set({
        programId: programId || null,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      return { ok: true, programId: programId || null };
    },

    exportAggregatedJson: async function (sessionId) {
      if (!this.auth) throw new Error("Auth SDK ikke lastet i denne siden.");
      const user = this.auth.currentUser;
      if (!user) throw new Error("Ikke innlogget.");
      if (!sessionId) throw new Error("Mangler sessionId.");

      const sSnap = await this.sessionRef(sessionId).get();
      if (!sSnap.exists) throw new Error("Session finnes ikke.");

      const s = sSnap.data() || {};
      if (s.ownerId !== user.uid) throw new Error("Ikke tilgang til session.");

      const saveResults = (s.saveResults === true);
      if (!saveResults) {
        throw new Error("Eksport er deaktivert fordi saveResults=false for denne session.");
      }

      const roundsSnap = await db.collection("sessions").doc(sessionId)
        .collection("rounds")
        .limit(500)
        .get();

      const roundIds = [];
      roundsSnap.forEach((d) => roundIds.push(d.id));

      const rounds = [];
      for (const roundId of roundIds) {
        const aSnap = await this.aggRef(sessionId, roundId).get();
        if (!aSnap.exists) continue;
        rounds.push({ roundId, agg: aSnap.data() || {} });
      }

      return {
        exportedAtMs: Date.now(),
        session: {
          sessionId: s.sessionId || sessionId,
          ownerId: s.ownerId || null,
          status: s.status || null,
          startedAt: s.startedAt || null,
          endedAt: s.endedAt || null,
          joinCode: s.joinCode || null,
          saveResults: s.saveResults === true,
          programId: s.programId || null
        },
        rounds
      };
    },

    endSession: async function (sessionId) {
      if (!this.auth) throw new Error("Auth SDK ikke lastet i denne siden.");
      const user = this.auth.currentUser;
      if (!user) throw new Error("Ikke innlogget.");
      if (!sessionId) throw new Error("Mangler sessionId.");

      const ownerId = user.uid;
      const sessionRef = this.sessionRef(sessionId);

      const sSnap = await sessionRef.get();
      if (!sSnap.exists) throw new Error("Session finnes ikke.");
      const sData = sSnap.data() || {};
      const joinCode = sData.joinCode || null;

      const batch = db.batch();

      batch.set(sessionRef, {
        status: "ended",
        endedAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      if (joinCode) {
        batch.set(this.joinCodeRef(String(joinCode).toUpperCase()), { active: false }, { merge: true });
      }

      batch.set(this.ownerRef(ownerId), {
        activeSessionId: null,
        activeJoinCode: null,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      await batch.commit();
      return { ok: true };
    }
  };

  if (auth) auth.onAuthStateChanged(() => { });

})();
