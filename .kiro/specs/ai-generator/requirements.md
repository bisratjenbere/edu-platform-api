# AI Activity Generator Module — Full Spec

## Requirements
Teachers describe a topic or learning standard and Claude generates a complete
set of activity blocks. Teacher reviews and approves before anything is saved.

## API endpoints
```
POST /api/v1/ai/generate-activity     — generate (does NOT save)
POST /api/v1/ai/save-generated        — save as DRAFT activity after teacher review
```

## Claude API prompt contract
- Model: claude-sonnet-4-20250514
- max_tokens: 2000
- System: "You are an expert elementary curriculum designer. Respond ONLY with valid JSON. No markdown, no preamble."
- Response schema: { suggestedTitle, suggestedDescription, blocks: [{ type, content, order }] }
- Parse: strip markdown fences → JSON.parse() → validate with Zod
- Retry once on parse failure with stricter prompt
- Rate limit: 20 generations per teacher per day (checked against AiUsageLog)

## Tasks
- [ ] Task 1: AiService — generateActivity(), Zod schema validation, retry logic
- [ ] Task 2: AiController — generate + save endpoints, rate limit check
- [ ] Task 3: AiUsageLog — log every call (tokens, timestamp, teacher_id)
- [ ] Task 4: Frontend — AiActivityGeneratorModal (Step 1: input form, Step 2: preview + edit)
- [ ] Task 5: Unit tests — generateActivity (valid response, parse failure, rate limit hit)
