import {
  normalise,
  levenshtein,
  alignSequences,
  compareWords,
} from './word-comparison.util';

describe('WordComparisonUtil', () => {
  // ─── normalise ─────────────────────────────────────────────────────────────

  describe('normalise', () => {
    it('lowercases all words', () => {
      expect(normalise('Hello World')).toEqual(['hello', 'world']);
    });

    it('strips punctuation', () => {
      expect(normalise('Hello, world!')).toEqual(['hello', 'world']);
    });

    it('keeps apostrophes in contractions', () => {
      expect(normalise("Don't stop")).toEqual(["don't", 'stop']);
    });

    it('collapses extra whitespace', () => {
      expect(normalise('  the   cat  ')).toEqual(['the', 'cat']);
    });

    it('returns empty array for blank string', () => {
      expect(normalise('')).toEqual([]);
    });

    it('matches "Hello," to "hello" after normalisation', () => {
      const p = normalise('Hello,');
      const t = normalise('hello');
      expect(p).toEqual(t);
    });
  });

  // ─── levenshtein ──────────────────────────────────────────────────────────

  describe('levenshtein', () => {
    it('returns 0 for identical strings', () => {
      expect(levenshtein('kitten', 'kitten')).toBe(0);
    });

    it('returns full length for empty string vs word', () => {
      expect(levenshtein('', 'cat')).toBe(3);
      expect(levenshtein('cat', '')).toBe(3);
    });

    it('computes single substitution', () => {
      expect(levenshtein('cat', 'bat')).toBe(1);
    });

    it('computes single insertion', () => {
      expect(levenshtein('cat', 'cats')).toBe(1);
    });

    it('computes single deletion', () => {
      expect(levenshtein('cats', 'cat')).toBe(1);
    });

    it('computes example "kitten" → "sitting" = 3', () => {
      expect(levenshtein('kitten', 'sitting')).toBe(3);
    });
  });

  // ─── compareWords — integration ───────────────────────────────────────────

  describe('compareWords', () => {
    it('perfect reading: all words correct', () => {
      const passage = 'the cat sat on the mat';
      const transcript = 'the cat sat on the mat';
      const result = compareWords(passage, transcript);

      expect(result.correctWords).toBe(6);
      expect(result.mispronounced).toHaveLength(0);
      expect(result.omitted).toHaveLength(0);
      expect(result.added).toHaveLength(0);
      expect(result.accuracy).toBe(100.0);
      result.passageAnnotated.forEach((w) =>
        expect(w.status).toBe('correct'),
      );
    });

    it('one mispronounced word (Levenshtein distance ≤ 2, len > 3)', () => {
      // "photosynthesis" → "fotosynthesis" (distance 1, len > 3) → mispronounced
      const passage = 'plants use photosynthesis to grow';
      const transcript = 'plants use fotosynthesis to grow';
      const result = compareWords(passage, transcript);

      expect(result.mispronounced).toHaveLength(1);
      expect(result.mispronounced[0].passageWord).toBe('photosynthesis');
      expect(result.mispronounced[0].heardWord).toBe('fotosynthesis');
      expect(result.omitted).toHaveLength(0);
      expect(result.added).toHaveLength(0);
    });

    it('one omitted word: detected as omitted', () => {
      const passage = 'the quick brown fox jumps';
      const transcript = 'the quick fox jumps'; // "brown" omitted
      const result = compareWords(passage, transcript);

      expect(result.omitted).toContain('brown');
      expect(result.omitted).toHaveLength(1);
      expect(result.mispronounced).toHaveLength(0);
      expect(result.added).toHaveLength(0);
    });

    it('one added word: detected as added', () => {
      const passage = 'the cat sat';
      const transcript = 'the big cat sat'; // "big" added
      const result = compareWords(passage, transcript);

      expect(result.added).toContain('big');
      expect(result.added).toHaveLength(1);
      expect(result.omitted).toHaveLength(0);
    });

    it('multiple consecutive omissions: all detected', () => {
      const passage = 'one two three four five six';
      const transcript = 'one six'; // two three four five all omitted
      const result = compareWords(passage, transcript);

      expect(result.omitted).toContain('two');
      expect(result.omitted).toContain('three');
      expect(result.omitted).toContain('four');
      expect(result.omitted).toContain('five');
      expect(result.omitted).toHaveLength(4);
    });

    it('student reads extra words at end: correctly marked as added', () => {
      const passage = 'the sun rises';
      const transcript = 'the sun rises every single morning';
      const result = compareWords(passage, transcript);

      expect(result.added).toContain('every');
      expect(result.added).toContain('single');
      expect(result.added).toContain('morning');
      expect(result.added).toHaveLength(3);
      expect(result.omitted).toHaveLength(0);
    });

    it('short word (len ≤ 3) with distance 1: treated as different word, NOT mispronounced', () => {
      // "cat" (len=3) → "cut" (distance=1) — should NOT be mispronounced
      const passage = 'the cat sat';
      const transcript = 'the cut sat'; // "cat" → "cut": len=3 so NOT mispronounced
      const result = compareWords(passage, transcript);

      // Should be treated as omitted "cat" + added "cut"
      expect(result.mispronounced).toHaveLength(0);
    });

    it('case and punctuation normalisation: "Hello," matches "hello"', () => {
      const passage = 'Hello, world today';
      const transcript = 'hello world today';
      const result = compareWords(passage, transcript);

      expect(result.correctWords).toBe(3);
      expect(result.mispronounced).toHaveLength(0);
      expect(result.omitted).toHaveLength(0);
    });

    it('accuracy is 0 for completely wrong transcript', () => {
      const passage = 'apple banana cherry date elderberry';
      const transcript = 'one two three four five';
      const result = compareWords(passage, transcript);

      expect(result.correctWords).toBe(0);
      expect(result.accuracy).toBe(0);
    });

    it('accuracy rounds to 1 decimal place', () => {
      // 2 out of 3 words correct = 66.666... → 66.7
      const passage = 'one two three';
      const transcript = 'one two xyz';
      const result = compareWords(passage, transcript);

      expect(result.correctWords).toBe(2);
      expect(result.accuracy).toBe(66.7);
    });

    it('passageAnnotated and transcriptAnnotated lengths match input word counts', () => {
      const passage = 'the quick brown fox';
      const transcript = 'the quick fox jumps';
      const result = compareWords(passage, transcript);

      expect(result.passageAnnotated).toHaveLength(4);
      expect(result.transcriptAnnotated).toHaveLength(4);
    });
  });
});
