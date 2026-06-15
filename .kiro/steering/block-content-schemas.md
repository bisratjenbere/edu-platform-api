---
inclusion: fileMatch
fileMatchPattern: ["**/activities/**", "**/blocks/**", "**/submissions/**"]
---

# EduFlow — Activity Block Content Schemas

## Location
`src/modules/activities/schemas/block-content.schemas.ts`

## Purpose
Every ActivityBlock has a `content: Json` field in Prisma.
This file defines the exact shape of that Json per block type using Zod.
All writes to ActivityBlock.content MUST be validated against the
relevant schema before saving. All reads should be parsed for type safety.

## Usage rules
- BlocksService validates content on every addBlock() and updateBlock() call
- Invalid content returns 400 with the Zod error message
- Frontend imports these schemas for type inference only — no runtime validation on client
- Never accept content that hasn't passed its schema

## Schema definitions per BlockType

### Instruction / content blocks (no student response)

**TEXT**
- `html: string` — sanitized HTML, max 50,000 chars

**VOICE_INSTRUCTION**
- `audio.url: string` — CloudFront signed URL
- `audio.mimeType: string`
- `audio.durationSeconds?: number`
- `transcriptText?: string` — accessibility transcript

**VIDEO_INSTRUCTION**
- `video.url: string` — CloudFront signed URL
- `video.mimeType: string`
- `video.durationSeconds?: number`
- `thumbnailUrl?: string`
- `captionsUrl?: string` — VTT file for accessibility

**IMAGE**
- `image.url: string` — CloudFront signed URL
- `image.mimeType: string`
- `altText?: string` max 500 chars
- `caption?: string` max 500 chars

**PDF**
- `pdf.url: string` — CloudFront signed URL
- `pdf.mimeType: string`
- `displayName: string` max 200 chars

**LINK**
- `url: string` — valid URL
- `displayText: string` max 200 chars
- `embedType?: 'youtube' | 'vimeo' | 'googledocs' | 'external'`

---

### Response blocks (student submits content into these)

**DRAWING_CANVAS**
- `backgroundImageUrl?: string` — optional prompt image, CloudFront signed URL
- `backgroundAltText?: string` max 500 chars
- `canvasWidthPx: number` — default 800
- `canvasHeightPx: number` — default 600

**MULTIPLE_CHOICE**
- `question: string` max 1000 chars
- `options: array` min 2 items, max 6 items
  - each option: `{ id: string, text: string (max 500 chars) }`
- `correctOptionId: string` — must match one of the option ids
- `allowMultipleCorrect: boolean` default false

**TRUE_FALSE**
- `question: string` max 1000 chars
- `correctAnswer: boolean`

**POLL**
- `question: string` max 1000 chars
- `options: array` min 2 items, max 10 items
  - each option: `{ id: string, text: string (max 500 chars) }`
- No correctOptionId — polls are not graded

**DRAG_DROP**
- `instruction: string` max 1000 chars
- `items: array` min 2, max 20
  - each item: `{ id: string, label: string (max 200 chars), imageUrl?: string }`
- `targets: array` min 2, max 20
  - each target: `{ id: string, label: string (max 200 chars) }`
- `correctMapping: Record<itemId, targetId>` — every item id must map to a target id

**SHORT_ANSWER**
- `prompt: string` max 1000 chars
- `maxCharacters: number` default 500, max 2000
- `placeholder?: string` max 200 chars

**OPEN_ENDED**
- `prompt: string` max 1000 chars
- `allowedResponseTypes: array` min 1 item
  - values: `'drawing' | 'audio' | 'video' | 'photo' | 'text'`
- `maxVideoDurationSeconds: number` default 300 (5 min cap from product constraints)
- `maxAudioDurationSeconds: number` default 300

---

## Validation rules that apply across all block types

- All URLs must be CloudFront domain URLs — never raw S3 URLs
- All string fields must have HTML stripped before storage (sanitizeHtml)
- correctOptionId in MULTIPLE_CHOICE must reference an id that exists
  in the options array — validate this referential integrity in BlocksService,
  not just in the Zod schema
- correctMapping keys in DRAG_DROP must all exist in items ids,
  and all values must exist in targets ids — same referential integrity rule
- POLL has no correctOptionId and must never be auto-graded

## Auto-grade eligibility (used by AutoGradeService)

| BlockType       | Auto-gradeable | Method                              |
|-----------------|----------------|-------------------------------------|
| MULTIPLE_CHOICE | Yes            | selectedOptionId === correctOptionId |
| TRUE_FALSE      | Yes            | answer === correctAnswer             |
| DRAG_DROP       | Yes            | correct pairs / total pairs          |
| POLL            | No             | —                                    |
| SHORT_ANSWER    | No             | —                                    |
| OPEN_ENDED      | No             | —                                    |
| All others      | No             | instruction blocks, not responses    |