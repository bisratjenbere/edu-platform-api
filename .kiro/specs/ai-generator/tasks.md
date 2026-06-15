# AI Generator Module — Tasks

## Implementation order (follow this sequence exactly)

- [ ] Task 1: DTOs
  - `generate-activity.dto.ts` — topic (IsString, IsNotEmpty, max 500), gradeLevel (IsEnum GradeLevel, optional), subject (IsString, optional, max 100), standardsTags (IsArray IsString, optional), blockTypes (IsArray IsEnum BlockType, optional — hints for desired block types)
  - `save-generated.dto.ts` — classId (IsUUID), title (IsString, IsNotEmpty, max 200), description (IsString, optional), blocks (IsArray, each: { type: BlockType, content: object, order: number })

- [ ] Task 2: AiService
  - `generateActivity(teacherId, dto)` — check daily rate limit via AiUsageLog count, call OpenRouter API, strip markdown, JSON.parse, Zod validate, retry once on failure, log to AiUsageLog on success, return parsed result WITHOUT saving
  - `saveGenerated(teacherId, dto)` — verify teacher owns classId, create Activity (DRAFT) + all ActivityBlocks, validate each block content against block-content-schemas.md, return full activity with blocks
  - Private `callOpenRouter(messages, strict?)` — builds OpenAI-compatible request payload, calls `https://openrouter.ai/api/v1/chat/completions` with model `meta-llama/llama-3.3-70b-instruct:free`, includes required `HTTP-Referer` and `X-Title` headers, returns raw response text
  - Private `buildMessages(dto, strict?)` — constructs system + user message array, strict mode adds "Return ONLY raw JSON" instruction

- [ ] Task 3: AiController
  - `POST /api/v1/ai/generate-activity` — `@Roles(Role.TEACHER)`, call AiService.generateActivity
  - `POST /api/v1/ai/save-generated` — `@Roles(Role.TEACHER)`, call AiService.saveGenerated
  - Full OpenAPI decorators including 422 response for parse failure, 429 for rate limit

- [ ] Task 4: Frontend — AiActivityGeneratorModal
  - Step 1 (input form): topic textarea, grade selector, subject input, block type checkboxes
  - Loading state: animated skeleton while Llama is thinking (estimated 3–8s)
  - Step 2 (preview + edit): read-only block list preview, edit title/description, back button
  - "Add to Class" button → opens class selector → calls save-generated → navigates to ActivityBuilderPage

- [ ] Task 5: Unit tests
  - `ai.service.spec.ts` — generateActivity (valid response, parse failure + retry, second failure = 422), rate limit hit (count >= 20 returns 429), saveGenerated (blocks created with correct content), AiUsageLog created on success
