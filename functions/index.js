"use strict";

const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

const ALLOWED_MODES = new Set(["multi", "likert", "open", "wordcloud"]);

function normalizeWord(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wordsFromText(text) {
  const t = normalizeWord(text);
  if (!t) return [];
  // enkel tokenisering, maks 50 tokens for å unngå ekstrem-input
  return t.split(" ").filter(w => w.length >= 2).slice(0, 50);
}

async function resolveModeFallback(sessionId, roundId) {
  // Fallback kun dersom vote mangler mode:
  // les state/live, men bare stol på det hvis roundId matcher.
  const liveRef = db.collection("sessions").doc(sessionId).collection("state").doc("live");
  const liveSnap = await liveRef.get();
  if (!liveSnap.exists) return null;
  const live = liveSnap.data() || {};
  if (live.roundId !== roundId) return null;
  if (!ALLOWED_MODES.has(live.mode)) return null;
  return live.mode;
}

exports.onVoteCreated = functions.firestore
  .document("sessions/{sessionId}/rounds/{roundId}/votes/{clientId}")
  .onCreate(async (snap, ctx) => {
    const { sessionId, roundId } = ctx.params;
    const vote = snap.data() || {};
    let mode = vote.mode;

    if (!ALLOWED_MODES.has(mode)) {
      mode = await resolveModeFallback(sessionId, roundId);
    }
    if (!ALLOWED_MODES.has(mode)) {
      // Hvis vi ikke kan fastslå mode trygt -> ikke aggreger (for å unngå feil data)
      return null;
    }

    const value = vote.value;

const roundRef = db.collection("sessions").doc(sessionId).collection("rounds").doc(roundId);
const aggRef = roundRef.collection("agg").doc("live"); // ✅ riktig path

    await db.runTransaction(async (tx) => {
      const sessionRef = roundRef.parent.parent;
      const session = await tx.get(sessionRef);
      const state = await tx.get(sessionRef.collection("state").doc("live"));
      const currentVote = await tx.get(snap.ref);
      if (!session.exists || session.data().status !== "active" || !state.exists ||
          state.data().roundId !== roundId || !currentVote.exists || currentVote.data().processed === true) return;
      const aggSnap = await tx.get(aggRef);
      const prev = aggSnap.exists ? (aggSnap.data() || {}) : {};

      const next = {
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        mode,
        n: (typeof prev.n === "number" ? prev.n : 0) + 1
      };

      if (mode === "multi") {
        const counts = (prev.counts && typeof prev.counts === "object") ? { ...prev.counts } : {};
        const key = String(value);
        counts[key] = (typeof counts[key] === "number" ? counts[key] : 0) + 1;
        next.counts = counts;
      }

      if (mode === "likert") {
        const num = Number(value);
        const sumPrev = typeof prev.sum === "number" ? prev.sum : 0;
        const countPrev = typeof prev.count === "number" ? prev.count : 0;
        next.sum = sumPrev + (Number.isFinite(num) ? num : 0);
        next.count = countPrev + 1;
      }

      if (mode === "open") {
        const texts = Array.isArray(prev.texts) ? prev.texts.slice() : [];
        const t = String(value || "").trim();
        if (t) texts.push(t);
        next.texts = texts;
      }

      if (mode === "wordcloud") {
        const freq = (prev.freq && typeof prev.freq === "object") ? { ...prev.freq } : {};
        const words = wordsFromText(String(value || ""));
        for (const w of words) {
          freq[w] = (typeof freq[w] === "number" ? freq[w] : 0) + 1;
        }
        next.freq = freq;
      }

      tx.set(aggRef, next, { merge: true });
      tx.update(snap.ref, { processed: true });
      tx.update(sessionRef, { updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    });

    return null;

  });

// Cleanup only for sessions created with cleanupEnabled (legacy data handled separately).
const INACTIVE_MS = 24 * 60 * 60 * 1000;
const timestamp = () => admin.firestore.FieldValue.serverTimestamp();

async function removeOldRound(sessionRef, roundId) {
  if (!roundId) return;
  const state = await sessionRef.collection("state").doc("live").get();
  if (state.exists && state.data().roundId === roundId) return;
  // Round IDs are never reused; vote rules and aggregation guard prevent late writes.
  await db.recursiveDelete(sessionRef.collection("rounds").doc(roundId));
}

async function removeEndedSession(ref) {
  const snapshot = await ref.get();
  if (!snapshot.exists || snapshot.data().cleanupEnabled !== true || snapshot.data().status !== "ended") return;
  // Keep parent as retry marker until all descendants have been deleted successfully.
  for (const collection of await ref.listCollections()) await db.recursiveDelete(collection);
  await db.runTransaction(async tx => {
    const session = await tx.get(ref);
    if (!session.exists || session.data().status !== "ended" || session.data().cleanupEnabled !== true) return;
    const data = session.data();
    const ownerRef = db.collection("owners").doc(data.ownerId);
    const joinRef = db.collection("joinCodes").doc(data.joinCode);
    const owner = await tx.get(ownerRef);
    const join = await tx.get(joinRef);
    if (owner.exists && owner.data().activeSessionId === ref.id) tx.update(ownerRef, {
      activeSessionId: null, activeJoinCode: null, updatedAt: timestamp()
    });
    if (join.exists && join.data().sessionId === ref.id) tx.delete(joinRef);
    tx.delete(ref);
  });
}

exports.onRoundChanged = functions.runWith({timeoutSeconds: 540}).firestore
  .document("sessions/{sessionId}/state/live").onUpdate(async change => {
    const oldRound = change.before.data().roundId;
    if (!oldRound || oldRound === change.after.data().roundId) return;
    const ref = change.after.ref.parent.parent;
    const session = await ref.get();
    if (session.exists && session.data().cleanupEnabled === true) await removeOldRound(ref, oldRound);
  });

exports.onSessionEnded = functions.runWith({timeoutSeconds: 540}).firestore
  .document("sessions/{sessionId}").onUpdate(async change => {
    if (change.before.data().status === "active" && change.after.data().status === "ended") {
      await removeEndedSession(change.after.ref);
    }
  });

exports.cleanupInactiveSessions = functions.runWith({timeoutSeconds: 540, maxInstances: 1})
  .pubsub.schedule("every 15 minutes").onRun(async () => {
    const sessions = await db.collection("sessions").where("cleanupEnabled", "==", true).get();
    for (const doc of sessions.docs) {
      try {
        const ref = doc.ref;
        const ended = await db.runTransaction(async tx => {
          const current = await tx.get(ref);
          if (!current.exists || current.data().cleanupEnabled !== true) return false;
          const data = current.data();
          if (data.status === "ended") return true;
          if (data.status !== "active" || !data.updatedAt || Date.now() - data.updatedAt.toMillis() < INACTIVE_MS) return false;
          tx.update(ref, { status: "ended", endedAt: timestamp(), updatedAt: timestamp() });
          return true;
        });
        if (ended) await removeEndedSession(ref);
        else {
          // Retry failed round cleanup, including missing parent documents.
          const rounds = await ref.collection("rounds").listDocuments();
          for (const round of rounds) await removeOldRound(ref, round.id);
        }
      } catch (err) { console.error("Cleanup failed", doc.id, err); }
    }
    return null;
  });
