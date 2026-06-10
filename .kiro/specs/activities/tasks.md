# Activities Module — Tasks

## Implementation order (follow this sequence exactly)

- [ ] Task 1: DTOs
  - `create-activity.dto.ts` — title (required, max 200), description (optional), class_id (IsUUID), due_date (IsDateString, optional), scheduled_publish_at (IsDateString, optional), assigned_to (IsEnum AssignedTo)
  - `update-activity.dto.ts` — PartialType of CreateActivityDto
  - `create-block.dto.ts` — type (IsEnum BlockType), content (IsObject), order (IsInt), is_required (IsBoolean, default true)
  - `update-block.dto.ts` — PartialType of CreateBlockDto (type not updatable)
  - `assign-individual.dto.ts` — student_ids (IsUUID each, IsArray), custom_instructions (optional map of studentId → string)

- [ ] Task 2: ActivitiesService
  - `create(teacherId, dto)` — create Activity as DRAFT, verify teacher owns class_id
  - `findAll(teacherId, classId, status?)` — return activities for teacher's class with _count on submissions
  - `findOne(activityId, requesterId)` — include all blocks ordered by order ASC
  - `update(activityId, teacherId, dto)` — verify teacher ownership, patch allowed fields
  - `softDelete(activityId, teacherId)` — verify PRIMARY teacher only
  - `publish(activityId, teacherId)` — validate all required blocks have content, status → PUBLISHED, create ActivityAssignment per student, enqueue push notification job
  - `duplicate(activityId, teacherId, targetClassId)` — deep copy Activity + all ActivityBlocks with new UUIDs, status = DRAFT
  - `schedulePublish(activityId, teacherId, scheduledAt)` — create/update/cancel BullMQ delayed job in `activity-scheduler` queue

- [ ] Task 3: BlocksService
  - `addBlock(activityId, teacherId, dto)` — verify activity is DRAFT, validate content against block-content-schemas.md Zod schema, append at end
  - `updateBlock(activityId, blockId, teacherId, dto)` — verify activity is DRAFT, validate content schema
  - `removeBlock(activityId, blockId, teacherId)` — verify activity is DRAFT, delete block, reorder remaining
  - `replaceAllBlocks(activityId, teacherId, blocks)` — atomic replace for drag-and-drop reorder, verify DRAFT status
  - `validateBlockContent(type, content)` — private, runs Zod schema per BlockType from block-content-schemas.md

- [ ] Task 4: ActivitySchedulerJob
  - BullMQ processor for `activity-scheduler` queue
  - Job name format: `publish-activity:{activityId}`
  - On execute: call activitiesService.publish(activityId), handle already-published gracefully
  - On failure: log to Sentry, update activity status back to DRAFT with error metadata

- [ ] Task 5: ActivitiesController — all endpoints wired
  - Apply `@UseGuards(JwtAuthGuard, RolesGuard)` on controller class
  - `@Roles(Role.TEACHER)` on all write endpoints
  - `@Roles(Role.TEACHER, Role.STUDENT)` on GET endpoints (students can read assigned activities)
  - Full OpenAPI decorators on every method

- [ ] Task 6: SubmissionStatusGateway
  - WebSocket gateway, namespace `/submissions`
  - Room: `activity:{activityId}` — teacher joins on page open
  - Event: `submission-updated` — emitted with { submissionId, studentId, status } on every status change
  - Auth: validate JWT from handshake query param

- [ ] Task 7: Unit tests
  - `activities.service.spec.ts` — create, publish (valid, missing content), duplicate, schedule, cancel schedule
  - `blocks.service.spec.ts` — addBlock (valid schema, invalid schema), reorder, remove

- [ ] Task 8: Frontend — ActivityBuilderPage
  - Zustand store: `useActivityBuilderStore` (blocks, isDirty, selectedBlockId)
  - DnD block list with `@dnd-kit/sortable`
  - Block palette sidebar (all 13 block types with icons)
  - Activity settings sidebar (title, due date, schedule toggle, assign to)
  - Auto-save every 30s via PATCH when isDirty = true
  - Each block type has its own edit component under `components/blocks/`

- [ ] Task 9: Frontend — SubmissionStatusGrid
  - WebSocket connection on mount, disconnect on unmount
  - Student card grid with status badge (colour per status)
  - Filter bar (All / Not Started / In Progress / Submitted / Returned / Approved)
  - StudentSubmissionDrawer on card click (read-only submission view)
  - Skeleton loading state on initial load
