# AI Generator Module — Tasks

## Implementation order (follow this sequence exactly)

- [x] Task 1: DTOs
  - `generate-activity.dto.ts` — topic (IsString, IsNotEmpty, max 500), gradeLevel (IsEnum GradeLevel, optional), subject (IsString, optional, max 100), standardsTags (IsArray IsString, optional), blockTypes (IsArray IsEnum BlockType, optional — hints for desired block types)
  - `save-generated.dto.ts` — classId (IsUUID), title (IsString, IsNotEmpty, max 200), description (IsString, optional), blocks (IsArray, each: { type: BlockType, content: object, order: number })
  - 11 additional DTOs for extended AI features (draft-feedback, misconception-report, adaptive-activity, draft-family-message, fluency-passage, rubric-generator, standards-alignment, differentiation, journal-comment, template-quality, save-generated)

- [x] Task 2: AiService — fully implemented with 12 public methods
  - `generateActivity(teacherId, dto)` — rate limit via AiUsageLog, OpenRouter API, strip markdown, JSON.parse, Zod validate, retry once on failure, log to AiUsageLog
  - `saveGenerated(teacherId, dto)` — verify teacher owns class, create Activity (DRAFT) + ActivityBlocks, validate against block-content-schemas.md
  - `draftFeedback`, `getMisconceptionReport`, `generateAdaptiveActivity`, `draftFamilyMessage`, `generateFluencyPassage`, `generateRubric`, `checkStandardsAlignment`, `generateDifferentiation`, `suggestJournalComment`, `scoreTemplateQuality`
  - Private: `callOpenRouter`, `callWithRetry`, `parseWith`, `validateActivityBlocks`, `buildActivityMessages`, `blockSchemasPrompt`, `outputSchemaPrompt`, `assertTeacherOwnsClass`, `assertDailyLimitNotReached`, `logUsage`, `wrapApiError`

- [x] Task 3: AiController
  - `POST /api/v1/ai/generate-activity` — `@Roles(Role.TEACHER)`, rate limit 20/day, 422 on parse failure, 429 on limit
  - `POST /api/v1/ai/save-generated` — `@Roles(Role.TEACHER)`, returns DRAFT activity with blocks
  - Full OpenAPI decorators on both endpoints

- [ ] Task 4: Frontend — AiActivityGeneratorModal (pending — frontend not scaffolded yet)
  - Step 1 (input form): topic textarea, grade selector, subject input, block type checkboxes
  - Loading state: animated skeleton while Llama is thinking (estimated 3–8s)
  - Step 2 (preview + edit): read-only block list preview, edit title/description, back button
  - "Add to Class" button → opens class selector → calls save-generated → navigates to ActivityBuilderPage

- [x] Task 5: Unit tests — `ai.service.spec.ts`
  - generateActivity: valid response ✓, parse failure + retry ✓, second failure = 422 ✓, rate limit (count >= 20) = 429 ✓, markdown fence stripping ✓
  - saveGenerated: blocks created with correct content ✓, teacher not in class = 400 ✓, invalid block content = 400 ✓
  - AiUsageLog created on success ✓
