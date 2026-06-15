# Activities Module — Design

## API endpoints

```
POST   /api/v1/activities                          — create draft
GET    /api/v1/activities?classId=&status=         — list activities for a class
GET    /api/v1/activities/:id                      — get with all blocks
PATCH  /api/v1/activities/:id                      — update metadata
POST   /api/v1/activities/:id/publish              — validate + publish
POST   /api/v1/activities/:id/duplicate            — deep copy to target class
DELETE /api/v1/activities/:id                      — soft delete
POST   /api/v1/activities/:id/blocks               — add block
PUT    /api/v1/activities/:id/blocks               — replace all blocks (reorder)
PATCH  /api/v1/activities/:id/blocks/:blockId      — update single block content
DELETE /api/v1/activities/:id/blocks/:blockId      — remove block
POST   /api/v1/activities/:id/assign-individual    — assign to specific students
GET    /api/v1/activities/:id/submission-status    — all student statuses for teacher
```

## File structure

```
src/modules/activities/
  dto/
    create-activity.dto.ts
    update-activity.dto.ts
    create-block.dto.ts
    update-block.dto.ts
    assign-individual.dto.ts
  schemas/
    block-content.schemas.ts     — Zod schemas per BlockType (see block-content-schemas.md)
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

## BullMQ queue

- Queue name: `activity-scheduler`
- Job name: `publish-activity:{activityId}`
- Delay: milliseconds until `scheduled_publish_at`
- On execute: `activitiesService.publish(activityId)`
- Cancel: look up job by name, call `job.remove()`, delete Redis key `notif_job:{activityId}`

## WebSocket gateway

- Namespace: `/submissions`
- Room: `activity:{activityId}`
- Teacher joins room on page load via `joinActivity` event
- Server emits `submission-updated` on every submission status change
- Payload: `{ submissionId, studentId, activityId, status, updatedAt }`

## Key dependencies

- `@nestjs/bull` + `bullmq` — job scheduling
- `@nestjs/websockets` + `socket.io` — WebSocket gateway
- `zod` — block content validation (imported from block-content.schemas.ts)
- `@dnd-kit/sortable` (frontend only)

## Data flow — publish

```
Teacher clicks Publish
  → ActivitiesService.publish()
    → validate all required blocks have non-empty content
    → set activity.status = PUBLISHED
    → for each student in class: create ActivityAssignment
    → enqueue push-notification job: NEW_ACTIVITY to all students
    → return updated activity
```

## Data flow — scheduled publish

```
Teacher sets scheduled_publish_at
  → ActivitiesService.schedulePublish()
    → if existing job: remove old BullMQ job
    → create delayed BullMQ job (delay = scheduledAt - now)
    → store job id in Redis: notif_job:{activityId}
Teacher removes scheduled_publish_at
  → look up Redis key, cancel job, delete key
```
