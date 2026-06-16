/**
 * WordComparisonUtil
 *
 * Compares a student's transcript against the original passage word-by-word
 * using LCS-based sequence alignment and Levenshtein distance.
 *
 * Exported as plain functions (not a class) so they can be tested individually
 * and injected into FluencyAnalysisJob without requiring NestJS DI.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AnnotatedWord {
  word: string;
  status: 'correct' | 'mispronounced' | 'omitted' | 'added';
}

export interface MispronouncedWord {
  passageWord: string;
  heardWord: string;
  index: number; // 0-based position in passage
}

export interface WordComparisonResult {
  totalPassageWords: number;
  correctWords: number;
  mispronounced: MispronouncedWord[];
  omitted: string[];
  added: string[];
  passageAnnotated: AnnotatedWord[];
  transcriptAnnotated: AnnotatedWord[];
  accuracy: number; // 0-100, 1 decimal
}

interface AlignedPair {
  passageIndex: number;
  transcriptIndex: number;
}

// ─── Normalisation ──────────────────────────────────────────────────────────

/**
 * Lowercase, strip punctuation (keep apostrophes for contractions),
 * collapse whitespace, split into word array.
 */
export function normalise(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, '')
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0);
}

// ─── Levenshtein distance ────────────────────────────────────────────────────

/**
 * Standard dynamic-programming Levenshtein distance. O(m×n).
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const m = a.length;
  const n = b.length;

  // Use two rows to minimise memory
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array<number>(n + 1).fill(0);

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,         // insertion
        prev[j] + 1,             // deletion
        prev[j - 1] + cost,      // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }

  return prev[n];
}

// ─── Is a mismatch "mispronounced" or "different word"? ─────────────────────

/**
 * Returns true if distance ≤ 2 AND the passage word has more than 3 characters.
 * Short words (≤ 3 chars) are never classified as mispronounced — a single-letter
 * edit on "cat" or "the" is too ambiguous.
 */
function isMispronounced(passageWord: string, heardWord: string): boolean {
  if (passageWord.length <= 3) return false;
  const dist = levenshtein(passageWord, heardWord);
  return dist > 0 && dist <= 2;
}

// ─── LCS-based sequence alignment ───────────────────────────────────────────

/**
 * Aligns transcript words to passage words using LCS.
 * Two words are considered a "match" if their Levenshtein distance ≤ 2
 * (covers both exact matches and mispronunciations).
 *
 * Returns the set of aligned pairs (passage index ↔ transcript index).
 */
export function alignSequences(
  passage: string[],
  transcript: string[],
): AlignedPair[] {
  const m = passage.length;
  const n = transcript.length;

  // Build LCS table treating "close enough" words as equal
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (levenshtein(passage[i - 1], transcript[j - 1]) <= 2) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to recover aligned pairs
  const pairs: AlignedPair[] = [];
  let i = m;
  let j = n;

  while (i > 0 && j > 0) {
    if (levenshtein(passage[i - 1], transcript[j - 1]) <= 2) {
      pairs.unshift({ passageIndex: i - 1, transcriptIndex: j - 1 });
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  return pairs;
}

// ─── Classify passage words ──────────────────────────────────────────────────

export function classifyPassageWords(
  passage: string[],
  transcript: string[],
  alignment: AlignedPair[],
): AnnotatedWord[] {
  const alignedByPassage = new Map<number, number>();
  for (const pair of alignment) {
    alignedByPassage.set(pair.passageIndex, pair.transcriptIndex);
  }

  return passage.map((word, idx) => {
    const transcriptIdx = alignedByPassage.get(idx);

    if (transcriptIdx === undefined) {
      // No match found in transcript → omitted
      return { word, status: 'omitted' } as AnnotatedWord;
    }

    const heardWord = transcript[transcriptIdx];
    if (isMispronounced(word, heardWord)) {
      return { word, status: 'mispronounced' } as AnnotatedWord;
    }

    return { word, status: 'correct' } as AnnotatedWord;
  });
}

// ─── Classify transcript words ───────────────────────────────────────────────

export function classifyTranscriptWords(
  transcript: string[],
  alignment: AlignedPair[],
  passage: string[],
): AnnotatedWord[] {
  const alignedByTranscript = new Map<number, number>();
  for (const pair of alignment) {
    alignedByTranscript.set(pair.transcriptIndex, pair.passageIndex);
  }

  return transcript.map((word, idx) => {
    const passageIdx = alignedByTranscript.get(idx);

    if (passageIdx === undefined) {
      // No match found in passage → added
      return { word, status: 'added' } as AnnotatedWord;
    }

    const passageWord = passage[passageIdx];
    if (isMispronounced(passageWord, word)) {
      return { word, status: 'mispronounced' } as AnnotatedWord;
    }

    return { word, status: 'correct' } as AnnotatedWord;
  });
}

// ─── Main entry point ────────────────────────────────────────────────────────

/**
 * Compare a passage against a transcript and return the full analysis result.
 * WPM and fluencyScore are NOT computed here — they require recording duration
 * and grade level, which the FluencyAnalysisJob provides.
 */
export function compareWords(
  passageText: string,
  transcriptText: string,
): WordComparisonResult {
  const passage = normalise(passageText);
  const transcript = normalise(transcriptText);

  const alignment = alignSequences(passage, transcript);
  const passageAnnotated = classifyPassageWords(passage, transcript, alignment);
  const transcriptAnnotated = classifyTranscriptWords(transcript, alignment, passage);

  // Build mispronounced list from passage perspective
  const alignedByPassage = new Map<number, number>();
  for (const pair of alignment) {
    alignedByPassage.set(pair.passageIndex, pair.transcriptIndex);
  }

  const mispronounced: MispronouncedWord[] = [];
  const omitted: string[] = [];
  let correctWords = 0;

  passageAnnotated.forEach((aw, idx) => {
    if (aw.status === 'correct') {
      correctWords++;
    } else if (aw.status === 'mispronounced') {
      const transcriptIdx = alignedByPassage.get(idx)!;
      mispronounced.push({
        passageWord: passage[idx],
        heardWord: transcript[transcriptIdx],
        index: idx,
      });
    } else if (aw.status === 'omitted') {
      omitted.push(passage[idx]);
    }
  });

  const added: string[] = transcriptAnnotated
    .filter((aw) => aw.status === 'added')
    .map((aw) => aw.word);

  const totalPassageWords = passage.length;
  const accuracy =
    totalPassageWords === 0
      ? 0
      : Math.round((correctWords / totalPassageWords) * 1000) / 10; // 1 decimal

  return {
    totalPassageWords,
    correctWords,
    mispronounced,
    omitted,
    added,
    passageAnnotated,
    transcriptAnnotated,
    accuracy,
  };
}
