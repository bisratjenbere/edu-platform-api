# AI Generator Module — Design

## API endpoints

```
POST /api/v1/ai/generate-activity    — generate blocks from prompt (does NOT save to DB)
POST /api/v1/ai/save-generated       — save reviewed AI output as DRAFT Activity
```

## File structure

```
src/modules/ai/
  dto/
    generate-activity.dto.ts
    save-generated.dto.ts
  ai.module.ts
  ai.controller.ts
  ai.service.ts
  ai.service.spec.ts
  index.ts

apps/web/components/ai/
  AiActivityGeneratorModal.tsx   — Step 1: input, Step 2: preview + edit
```

## AI API contract

- Provider: OpenRouter (https://openrouter.ai) — single API key, OpenAI-compatible endpoint
- Endpoint: `https://openrouter.ai/api/v1/chat/completions`
- Model: `meta-llama/llama-3.3-70b-instruct:free`
- max_tokens: 2000
- API key env var: `OPENROUTER_API_KEY`
- Required headers:
  - `Authorization: Bearer ${OPENROUTER_API_KEY}`
  - `HTTP-Referer: https://eduflow.app` (required by OpenRouter)
  - `X-Title: EduFlow` (required by OpenRouter)
- System prompt: `"You are an expert elementary curriculum designer. Respond ONLY with valid JSON. No markdown, no preamble."`

Expected response shape (validated with Zod):
```typescript
const AiActivitySchema = z.object({
  suggestedTitle: z.string().max(200),
  suggestedDescription: z.string().max(1000).optional(),
  blocks: z.array(z.object({
    type: z.nativeEnum(BlockType),
    content: z.record(z.unknown()),
    order: z.number().int(),
  })).min(1).max(20),
});
```

## Retry logic

1. Call OpenRouter API
2. Strip markdown fences (```json ... ```) if present
3. JSON.parse()
4. Validate with Zod
5. If parse or validation fails → retry ONCE with stricter prompt: "Return ONLY raw JSON, no markdown"
6. If second attempt fails → throw 422 with message "AI response could not be parsed"

## Rate limiting

- Check AiUsageLog count for teacherId where created_at >= UTC midnight today
- If count >= 20 → throw 429 "Daily generation limit reached"
- Log every successful generation to AiUsageLog (prompt_tokens + completion_tokens from response)

## Key dependencies

- `axios` — OpenRouter API HTTP calls
- `zod` — response validation
