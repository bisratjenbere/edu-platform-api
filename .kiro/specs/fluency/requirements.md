# Reading Fluency Assessment Module — Requirements

## Overview
Reading fluency assessment measures how accurately and quickly a student reads
aloud. A teacher assigns a reading passage. The student records themselves reading
it. AWS Transcribe converts the audio to text. EduFlow's analysis pipeline compares
the transcript word-by-word against the passage and produces a scored report with
Words Per Minute, accuracy percentage, and a breakdown of mispronounced, omitted,
and added words.

---

## User stories

### US-FLU-01 — Teacher creates a fluency assessment
As a teacher, I want to create a reading fluency assessment with a passage so
my students can practise and be scored.

**Acceptance criteria:**
- WHEN I submit a class_id and passage_text (min 20 words, max 500 words)
- THEN a FluencyAssessment record is created with status PENDING
- AND the passage is stored verbatim — no modification
- WHEN passage_text is fewer than 20 words
- THEN I receive 400 with message "Passage must be at least 20 words"
- WHEN passage_text is more than 500 words
- THEN I receive 400 with message "Passage cannot exceed 500 words"

### US-FLU-02 — Student records a reading
As a student, I want to record myself reading the passage aloud so my teacher
can assess my fluency.

**Acceptance criteria:**
- WHEN I upload a recording URL (already uploaded to S3 via Uploads module)
- THEN the FluencyAssessment recording_url is saved
- AND the assessment status changes to PROCESSING
- AND an analysis job is enqueued immediately
- WHEN recording_url is not a valid S3/CloudFront key
- THEN I receive 400
- WHEN the assessment status is already COMPLETE or PROCESSING
- THEN I receive 409 Conflict with message "Recording already submitted"

### US-FLU-03 — Automated fluency analysis
As the system, I want to analyse the student's recording automatically using
AWS Transcribe and produce a scored fluency report.

**Acceptance criteria:**
- WHEN the analysis job runs
- THEN AWS Transcribe is invoked with the recording audio
- AND the system polls for completion (max 2 minutes, every 5 seconds)
- AND the transcript is compared word-by-word against the passage
- AND the result includes:
  - wpm (words per minute, rounded to nearest integer)
  - accuracy (percentage of passage words read correctly, rounded to 1 decimal)
  - fluencyScore (composite 0–100, see scoring formula below)
  - mispronounced: array of { passageWord, heardWord, index }
  - omitted: array of passage words missing from transcript
  - added: array of words in transcript not in passage
- AND the assessment status is set to COMPLETE
- WHEN AWS Transcribe fails or times out
- THEN the assessment status is set to ERROR
- AND the teacher is notified
- AND the student can re-submit a new recording

### US-FLU-04 — Teacher reviews fluency results
As a teacher, I want to see a detailed fluency report so I can identify areas
where each student needs support.

**Acceptance criteria:**
- WHEN I call GET /api/v1/fluency/assessments/:id
- THEN I receive the full FluencyAssessment including analysis JSON
- AND the passage text is returned with each word annotated:
  `[{ word: 'the', status: 'correct' | 'mispronounced' | 'omitted' }]`
- AND the transcript text is returned with each word annotated:
  `[{ word: 'ze', status: 'correct' | 'mispronounced' | 'added' }]`

### US-FLU-05 — Teacher views class fluency progress
As a teacher, I want to see all students' fluency results for a class so I
can track progress over time.

**Acceptance criteria:**
- WHEN I call GET /api/v1/fluency/class/:classId
- THEN I receive all assessments for that class, ordered by created_at DESC
- AND each entry shows: student name, wpm, accuracy, fluencyScore, status, created_at
- WHEN I pass ?studentId= filter
- THEN only assessments for that student are returned (showing progress over time)

---

## Fluency scoring formula

```
fluencyScore = (0.40 × accuracy) + (0.30 × wpm_score) + (0.30 × prosody_proxy)

Where:
  accuracy      = (correct_words / total_passage_words) × 100
  wpm_score     = min(wpm / GRADE_WPM_BENCHMARK[gradeLevel], 1.0) × 100
  prosody_proxy = (1 - (mispronounced.length / total_passage_words)) × 100

GRADE_WPM_BENCHMARK = {
  PREK: 20, K: 30, G1: 60, G2: 90, G3: 110, G4: 130, G5: 150
}
```

Score is always 0–100. Round to 1 decimal.

---

## Word comparison rules

1. Normalise both passage and transcript: lowercase, strip punctuation
2. Use Levenshtein distance for word matching:
   - distance = 0 → correct
   - distance ≤ 2 AND len(word) > 3 → mispronounced
   - distance > 2 → treated as different word (omitted + added)
3. Use sequence alignment (LCS-based) to match transcript words to passage words in order
   — this handles insertions and deletions correctly
4. Words in transcript with no passage match = added
5. Passage words with no transcript match = omitted

---

## Out of scope for this module
- Real-time streaming transcription (batch only via AWS Transcribe)
- Prosody / intonation scoring beyond the proxy formula above
- Student self-assessment playback in the student app (Phase 2)
- Peer comparison / class percentile ranking (Phase 2)