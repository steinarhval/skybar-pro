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
    const aggRef = roundRef.doc("agg"); // <-- DOKUMENT, ikke collection

    await db.runTransaction(async (tx) => {
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
    });

    return null;
  });