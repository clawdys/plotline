/**
 * aligner.js — Script-to-Cut Alignment ("Paper Edit")
 *
 * Pure algorithmic alignment of a written script against a timestamped
 * transcript from whisper-cpp.  No API key needed.
 *
 * Algorithm overview:
 *   1. Normalize & tokenize both script lines and transcript segments.
 *   2. Score every (script line, transcript segment) pair via a weighted
 *      combination of Jaccard word overlap, LCS ratio, and word-order score.
 *   3. Run dynamic programming for globally optimal many-to-one alignment
 *      that respects transcript order while allowing script reordering.
 *   4. Trim matched segments to word-level precision using whisper word
 *      timestamps.
 *   5. Return a complete alignment map with confidence scores.
 *
 * Exports:
 *   alignScriptToTranscript(scriptText, transcript) → AlignmentResult
 *
 * @module aligner
 */

// ─── Text Normalization ─────────────────────────────────────────────────────

/**
 * Normalize text: lowercase, strip punctuation, collapse whitespace.
 * @param {string} text
 * @returns {string}
 */
function normalize(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s']/g, ' ')   // keep apostrophes for contractions
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Tokenize normalized text into words.
 * @param {string} text
 * @returns {string[]}
 */
function tokenize(text) {
  const n = normalize(text);
  return n ? n.split(' ') : [];
}

/**
 * Split script text into sentences/lines.
 * Splits on newlines first, then on sentence-ending punctuation.
 * Filters out empty lines and screenplay formatting markers.
 * @param {string} scriptText
 * @returns {string[]}
 */
export function splitScriptIntoLines(scriptText) {
  // Split on newlines first
  const rawLines = scriptText.split(/\n/);
  const lines = [];

  for (const raw of rawLines) {
    const trimmed = raw.trim();
    if (!trimmed) continue;

    // Skip pure formatting lines (scene headings left as-is for alignment)
    // but skip lines that are just dashes or asterisks
    if (/^[-=*_]{3,}$/.test(trimmed)) continue;

    // If line is very long, split on sentence boundaries
    if (trimmed.length > 200) {
      const sentences = trimmed.split(/(?<=[.!?])\s+/);
      for (const s of sentences) {
        const st = s.trim();
        if (st) lines.push(st);
      }
    } else {
      lines.push(trimmed);
    }
  }

  return lines;
}

// ─── Similarity Scoring ─────────────────────────────────────────────────────

/**
 * Jaccard similarity between two word sets.
 * @param {string[]} a
 * @param {string[]} b
 * @returns {number} 0–1
 */
function jaccard(a, b) {
  if (a.length === 0 && b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const w of setA) {
    if (setB.has(w)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Longest Common Subsequence length.
 * @param {string[]} a
 * @param {string[]} b
 * @returns {number}
 */
function lcsLength(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0 || n === 0) return 0;

  // Space-optimized: two rows
  let prev = new Uint16Array(n + 1);
  let curr = new Uint16Array(n + 1);

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        curr[j] = prev[j - 1] + 1;
      } else {
        curr[j] = Math.max(prev[j], curr[j - 1]);
      }
    }
    [prev, curr] = [curr, prev];
    curr.fill(0);
  }

  return prev[n];
}

/**
 * LCS ratio: LCS length / max(len(a), len(b)).
 * @param {string[]} a
 * @param {string[]} b
 * @returns {number} 0–1
 */
function lcsRatio(a, b) {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 0;
  return lcsLength(a, b) / maxLen;
}

/**
 * Word-order score: Spearman-like correlation of shared word positions.
 * Measures whether words appear in the same relative order.
 * @param {string[]} a
 * @param {string[]} b
 * @returns {number} 0–1
 */
function wordOrderScore(a, b) {
  // Build position maps for shared words
  const posA = new Map();
  for (let i = 0; i < a.length; i++) {
    if (!posA.has(a[i])) posA.set(a[i], []);
    posA.get(a[i]).push(i);
  }

  const posB = new Map();
  for (let i = 0; i < b.length; i++) {
    if (!posB.has(b[i])) posB.set(b[i], []);
    posB.get(b[i]).push(i);
  }

  // Collect position pairs for shared words
  const pairs = [];
  for (const [word, positionsA] of posA) {
    const positionsB = posB.get(word);
    if (!positionsB) continue;
    // Take the first occurrence in each for simplicity
    pairs.push([positionsA[0] / Math.max(a.length - 1, 1), positionsB[0] / Math.max(b.length - 1, 1)]);
  }

  if (pairs.length < 2) return pairs.length > 0 ? 0.5 : 0;

  // Compute rank correlation (simplified: mean absolute position difference)
  let totalDiff = 0;
  for (const [pa, pb] of pairs) {
    totalDiff += Math.abs(pa - pb);
  }
  const meanDiff = totalDiff / pairs.length;

  // Convert to 0–1 score (0 diff = 1.0 score)
  return Math.max(0, 1 - meanDiff);
}

/**
 * Combined similarity score between a script line and a transcript segment.
 * @param {string[]} scriptWords  Tokenized script line
 * @param {string[]} segmentWords Tokenized transcript segment
 * @returns {number} 0–1
 */
function combinedScore(scriptWords, segmentWords) {
  if (scriptWords.length === 0 || segmentWords.length === 0) return 0;

  const j = jaccard(scriptWords, segmentWords);
  const l = lcsRatio(scriptWords, segmentWords);
  const o = wordOrderScore(scriptWords, segmentWords);

  // Weighted: LCS ratio is the strongest signal, Jaccard catches coverage,
  // word order breaks ties between similar-content segments.
  return 0.35 * j + 0.45 * l + 0.20 * o;
}

// ─── Multi-Segment Matching ─────────────────────────────────────────────────

/**
 * Score a script line against a contiguous range of transcript segments.
 * Concatenates the segment texts and scores against the script line.
 * @param {string[]} scriptWords
 * @param {Object[]} segments       Transcript segments (must have .text)
 * @param {number} startIdx         Start index in segments array
 * @param {number} endIdx           End index (exclusive)
 * @param {Map} segWordCache        Cache of tokenized segment words
 * @returns {number}
 */
function scoreMultiSegment(scriptWords, segments, startIdx, endIdx, segWordCache) {
  const key = `${startIdx}-${endIdx}`;
  let words = segWordCache.get(key);
  if (!words) {
    const text = segments.slice(startIdx, endIdx).map(s => s.text).join(' ');
    words = tokenize(text);
    segWordCache.set(key, words);
  }
  return combinedScore(scriptWords, words);
}

// ─── Dynamic Programming Alignment ──────────────────────────────────────────

/**
 * Find the globally optimal alignment of script lines to transcript segments
 * using dynamic programming.
 *
 * Each script line can match 0, 1, 2, or 3 contiguous transcript segments.
 * Transcript segments can only be used once. The DP finds the assignment
 * that maximizes total weighted score.
 *
 * @param {string[][]} scriptTokens   Array of tokenized script lines
 * @param {Object[]} segments         Transcript segments
 * @returns {{ assignments: Array<{scriptIdx: number, segStart: number, segEnd: number, score: number}> }}
 */
function dpAlign(scriptTokens, segments) {
  const S = scriptTokens.length;
  const T = segments.length;
  const MAX_SPAN = 3; // max transcript segments per script line

  // Pre-tokenize segments
  const segWordCache = new Map();
  for (let i = 0; i < T; i++) {
    segWordCache.set(`${i}-${i + 1}`, tokenize(segments[i].text));
  }

  // Pre-compute all scores: score[s][t][span] = score of matching script line s
  // to segments[t..t+span)
  const score = [];
  for (let s = 0; s < S; s++) {
    score[s] = [];
    for (let t = 0; t < T; t++) {
      score[s][t] = [];
      for (let span = 1; span <= MAX_SPAN && t + span <= T; span++) {
        score[s][t][span] = scoreMultiSegment(scriptTokens[s], segments, t, t + span, segWordCache);
      }
    }
  }

  // DP table: dp[s][t] = best total score aligning script lines [s..S)
  // using transcript segments [t..T)
  // choice[s][t] = { span: number } or { skip: true } (skip this script line)
  const dp = Array.from({ length: S + 1 }, () => new Float64Array(T + 1));
  const choice = Array.from({ length: S + 1 }, () => new Array(T + 1).fill(null));

  // Fill DP table backwards
  for (let s = S - 1; s >= 0; s--) {
    for (let t = T; t >= 0; t--) {
      // Option 1: skip this script line (mark as unmatched)
      let best = dp[s + 1][t];
      let bestChoice = { skip: true };

      // Option 2: match script line s to segments starting at some position t2 >= t
      // Allow gaps in transcript (skip unused segments)
      for (let t2 = t; t2 < T; t2++) {
        for (let span = 1; span <= MAX_SPAN && t2 + span <= T; span++) {
          const sc = score[s][t2][span];
          if (sc < 0.15) continue; // skip very poor matches

          const future = dp[s + 1][t2 + span];
          const total = sc + future;

          if (total > best) {
            best = total;
            bestChoice = { t2, span };
          }
        }
      }

      dp[s][t] = best;
      choice[s][t] = bestChoice;
    }
  }

  // Trace back to recover assignments
  const assignments = [];
  let s = 0;
  let t = 0;

  while (s < S) {
    const c = choice[s][t];
    if (c.skip) {
      assignments.push({ scriptIdx: s, segStart: -1, segEnd: -1, score: 0 });
      s++;
    } else {
      const { t2, span } = c;
      assignments.push({
        scriptIdx: s,
        segStart: t2,
        segEnd: t2 + span,
        score: score[s][t2][span],
      });
      s++;
      t = t2 + span;
    }
  }

  return { assignments };
}

// ─── Word-Level Trimming ────────────────────────────────────────────────────

/**
 * Given a script line and matched transcript segments (with word-level timestamps),
 * find the precise start/end times by matching the first and last words of the
 * script line within the transcript words.
 *
 * @param {string} scriptLine   Original script line text
 * @param {Object[]} segments   Matched transcript segments
 * @returns {{ trimmedStart: number, trimmedEnd: number }}
 */
function trimToWords(scriptLine, segments) {
  const scriptWords = tokenize(scriptLine);
  if (scriptWords.length === 0) {
    return {
      trimmedStart: segments[0]?.start ?? 0,
      trimmedEnd: segments[segments.length - 1]?.end ?? 0,
    };
  }

  // Collect all words with timestamps from matched segments
  const allWords = [];
  for (const seg of segments) {
    if (Array.isArray(seg.words) && seg.words.length > 0) {
      for (const w of seg.words) {
        allWords.push({
          text: normalize(w.text),
          start: w.start,
          end: w.end,
        });
      }
    } else {
      // Fallback: treat entire segment as one "word"
      allWords.push({
        text: normalize(seg.text),
        start: seg.start,
        end: seg.end,
      });
    }
  }

  if (allWords.length === 0) {
    return {
      trimmedStart: segments[0]?.start ?? 0,
      trimmedEnd: segments[segments.length - 1]?.end ?? 0,
    };
  }

  // Find first matching word (start)
  const firstScriptWord = scriptWords[0];
  let trimmedStart = allWords[0].start;
  for (const w of allWords) {
    if (w.text.includes(firstScriptWord) || firstScriptWord.includes(w.text)) {
      trimmedStart = w.start;
      break;
    }
  }

  // Find last matching word (end)
  const lastScriptWord = scriptWords[scriptWords.length - 1];
  let trimmedEnd = allWords[allWords.length - 1].end;
  for (let i = allWords.length - 1; i >= 0; i--) {
    if (allWords[i].text.includes(lastScriptWord) || lastScriptWord.includes(allWords[i].text)) {
      trimmedEnd = allWords[i].end;
      break;
    }
  }

  // Safety: ensure start < end
  if (trimmedStart >= trimmedEnd) {
    trimmedStart = segments[0].start;
    trimmedEnd = segments[segments.length - 1].end;
  }

  return { trimmedStart, trimmedEnd };
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * @typedef {Object} AlignmentEntry
 * @property {number}   scriptIndex       Index in the script lines array
 * @property {string}   scriptLine        Original script line text
 * @property {number[]} matchedSegments   Indices of matched transcript segments
 * @property {string}   matchedText       Concatenated text of matched segments
 * @property {number|null} trimmedStart   Word-level start time (seconds)
 * @property {number|null} trimmedEnd     Word-level end time (seconds)
 * @property {number}   confidence        Match confidence 0–1
 * @property {'matched'|'approximate'|'unmatched'} status
 */

/**
 * @typedef {Object} AlignmentResult
 * @property {AlignmentEntry[]} entries        One per script line
 * @property {number[]}         unusedSegments Transcript segment indices not matched
 * @property {{ totalLines: number, matched: number, approximate: number, unmatched: number, avgConfidence: number }} stats
 */

/**
 * Align a written script against a timestamped transcript.
 *
 * @param {string} scriptText   The written script (plain text, one logical line per line)
 * @param {Object} transcript   Plotline transcript object with .segments[]
 * @returns {AlignmentResult}
 */
export function alignScriptToTranscript(scriptText, transcript) {
  if (!scriptText || !transcript || !Array.isArray(transcript.segments) || transcript.segments.length === 0) {
    throw new Error('Both scriptText and a transcript with segments are required.');
  }

  const scriptLines = splitScriptIntoLines(scriptText);
  if (scriptLines.length === 0) {
    throw new Error('Script text produced no usable lines after splitting.');
  }

  const scriptTokens = scriptLines.map(tokenize);
  const segments = transcript.segments;

  // Run DP alignment
  const { assignments } = dpAlign(scriptTokens, segments);

  // Track which segments are used
  const usedSegments = new Set();

  // Build entries
  const entries = assignments.map((a) => {
    const scriptLine = scriptLines[a.scriptIdx];

    if (a.segStart < 0) {
      // Unmatched
      return {
        scriptIndex: a.scriptIdx,
        scriptLine,
        matchedSegments: [],
        matchedText: '',
        trimmedStart: null,
        trimmedEnd: null,
        confidence: 0,
        status: 'unmatched',
      };
    }

    const matchedSegs = segments.slice(a.segStart, a.segEnd);
    const segIndices = [];
    for (let i = a.segStart; i < a.segEnd; i++) {
      segIndices.push(i);
      usedSegments.add(i);
    }

    const matchedText = matchedSegs.map(s => s.text).join(' ');
    const { trimmedStart, trimmedEnd } = trimToWords(scriptLine, matchedSegs);

    let status;
    if (a.score >= 0.7) status = 'matched';
    else if (a.score >= 0.3) status = 'approximate';
    else status = 'unmatched';

    return {
      scriptIndex: a.scriptIdx,
      scriptLine,
      matchedSegments: segIndices,
      matchedText,
      trimmedStart,
      trimmedEnd,
      confidence: Math.round(a.score * 1000) / 1000,
      status,
    };
  });

  // Find unused segments
  const unusedSegments = [];
  for (let i = 0; i < segments.length; i++) {
    if (!usedSegments.has(i)) unusedSegments.push(i);
  }

  // Stats
  const matched = entries.filter(e => e.status === 'matched').length;
  const approximate = entries.filter(e => e.status === 'approximate').length;
  const unmatched = entries.filter(e => e.status === 'unmatched').length;
  const confidences = entries.filter(e => e.confidence > 0).map(e => e.confidence);
  const avgConfidence = confidences.length > 0
    ? Math.round((confidences.reduce((a, b) => a + b, 0) / confidences.length) * 1000) / 1000
    : 0;

  return {
    entries,
    unusedSegments,
    stats: {
      totalLines: entries.length,
      matched,
      approximate,
      unmatched,
      avgConfidence,
    },
  };
}
