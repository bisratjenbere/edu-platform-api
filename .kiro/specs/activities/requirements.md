# Activities Module — Full Spec

## Requirements

### Overview
The Activity Builder is the most critical teacher-facing feature. Teachers create
multi-block activities with instructions, questions, and interactive elements,
then assign them to whole classes or individual students.

### User stories

**US-ACT-01 — Create activity**
As a teacher, I want to create a new activity from scratch so I can assign it to my class.
- WHEN I create an activity, it starts as DRAFT status
- AND I can add, remove, and reorder blocks freely before publishing
- AND auto-save runs every 30 seconds

**US-ACT-02 — Block types**
As a teacher, I want to add different types of content blocks to an activity.
- Supported types: TEXT, VOICE_INSTRUCTION, VIDEO_INSTRUCTION, IMAGE, PDF, LINK,
  DRAWING_CANVAS, MULTIPLE_CHOICE, TRUE_FALSE, POLL, DRAG_DROP, SHORT_ANSWER, OPEN_ENDED
- MULTIPLE_CHOICE must have 2–6 options and exactly one correct answer marked
- TRUE_FALSE must have a correct answer marked
- DRAG_DROP must have items, targets, and a correct mapping defined

**US-ACT-03 — Publish activity**
As a teacher, I want to publish an activity to my students.
- WHEN I publish, status changes from DRAFT to PUBLISHED
- AND one ActivityAssignment row is created per student in the class
- AND students receive a push notification
- AND I cannot publish if required blocks have missing content

**US-ACT-04 — Schedule activity**
As a teacher, I want to schedule an activity to publish at a future date and time.
- WHEN I set scheduled_publish_at and save
- THEN a BullMQ delayed job is created to auto-publish at that time
- AND if I remove the schedule, the job is cancelled

**US-ACT-05 — Differentiated assignment**
As a teacher, I want to assign an activity to specific students with custom instructions.
- WHEN assigned_to = INDIVIDUAL, only selected students see the activity
- AND I can set custom_instructions per student within the same activity

**US-ACT-06 — Submission status view**
As a teacher, I want to see real-time submission status for all students on an activity.
- Statuses shown: NOT_STARTED | IN_PROGRESS | SUBMITTED | RETURNED | APPROVED
- Updates reflect within 5 seconds of student action via WebSocket

**US-ACT-07 — Duplicate activity**
As a teacher, I want to duplicate an existing activity to reuse it in another class.
- WHEN I duplicate, all blocks are deep-copied
- AND the new activity starts as DRAFT with the target class_id

---

## Design

### API endpoints
```
POST   /api/v1/activities                      — create draft
GET    /api/v1/activities?classId=&status=     — list activities
GET    /api/v1/activities/:id                  — get with all blocks
PATCH  /api/v1/activities/:id                  — update metadata
POST   /api/v1/activities/:id/publish          — validate + publish
POST   /api/v1/activities/:id/duplicate        — deep copy
DELETE /api/v1/activities/:id                  — soft delete
POST   /api/v1/activities/:id/blocks           — add block
PUT    /api/v1/activities/:id/blocks           — replace all blocks (reorder)
PATCH  /api/v1/activities/:id/blocks/:blockId  — update single block
DELETE /api/v1/activities/:id/blocks/:blockId  — remove block
POST   /api/v1/activities/:id/assign-individual
GET    /api/v1/activities/:id/submission-status
```

### BullMQ queue: `activity-scheduler`
- Job created/updated when scheduled_publish_at is set
- Job name: `publish-activity:{activityId}`
- Delay: ms until scheduled_publish_at
- On execute: call activitiesService.publish(activityId)

### WebSocket gateway
- Namespace: `/submissions`
- Room: `activity:{activityId}`
- Teacher joins on page open
- Event emitted on status change: `submission-updated`

### File structure
```
src/modules/activities/
  dto/
    create-activity.dto.ts
    update-activity.dto.ts
    create-block.dto.ts
    update-block.dto.ts
    assign-individual.dto.ts
  activities.module.ts
  activities.controller.ts
  activities.service.ts
  activities.service.spec.ts
  blocks.service.ts
  blocks.service.spec.ts
  activity-scheduler.job.ts
  submission-status.gateway.ts
  index.ts
```

---

## Tasks

- [ ] Task 1: DTOs — all 5 DTO files with full validation
- [ ] Task 2: ActivitiesService
  - create(), findAll(), findOne(), update(), softDelete()
  - publish() — validates blocks, creates assignments, enqueues notification job
  - duplicate() — deep copy with new IDs
  - schedulePublish() — create/update/cancel BullMQ delayed job
- [ ] Task 3: BlocksService
  - addBlock(), updateBlock(), removeBlock()
  - replaceAllBlocks() — atomic replace for reorder
  - validateBlock() — type-specific validation rules
- [ ] Task 4: ActivitySchedulerJob
  - BullMQ processor for `activity-scheduler` queue
  - Handles delayed publish + error retry
- [ ] Task 5: ActivitiesController — all endpoints wired, guards applied
- [ ] Task 6: SubmissionStatusGateway
  - WebSocket gateway, namespace /submissions
  - Teacher join/leave room
  - Emit submission-updated event
- [ ] Task 7: Unit tests — activities.service.spec.ts + blocks.service.spec.ts
- [ ] Task 8: Frontend — ActivityBuilderPage
  - Zustand store: useActivityBuilderStore
  - DnD block list with @dnd-kit/sortable
  - Block palette sidebar
  - Activity settings sidebar (title, due date, schedule, assign to)
  - Auto-save every 30s via PATCH
  - Each block type has its own edit component
- [ ] Task 9: Frontend — SubmissionStatusGrid
  - WebSocket connection on mount
  - Status badge colors per status
  - Student card grid with filter bar
  - StudentSubmissionDrawer on card click
