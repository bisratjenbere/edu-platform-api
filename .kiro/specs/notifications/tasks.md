# Notifications Module — Tasks

## Implementation order (follow this sequence exactly)

- [ ] Task 1: DTOs
  - `register-device.dto.ts` — token (IsString, IsNotEmpty, max 500), platform (IsEnum Platform)
  - `update-preferences.dto.ts` — preferences (IsArray, each: { type: IsEnum NotificationType, enabled: IsBoolean })

- [ ] Task 2: NotificationsService
  - `sendToUser(userId, payload)` — look up UserDevice records, enqueue one PushNotificationJob per device token, handle missing devices gracefully
  - `scheduleReminder(activityId, dueDate, classId)` — compute delay = dueDate - 24h - now, enqueue delayed job, store job id in Redis `notif_job:{activityId}`
  - `cancelReminder(activityId)` — look up Redis `notif_job:{activityId}`, remove BullMQ job, delete Redis key
  - `sendBulk(userIds, payload)` — call sendToUser for each userId in parallel (Promise.all)
  - `registerDevice(userId, dto)` — upsert UserDevice by token (update last_seen_at if exists)
  - `unregisterDevice(userId, token)` — delete UserDevice, verify ownership
  - `getPreferences(userId)` — return all NotificationPreference rows for user (fill in defaults for missing types)
  - `updatePreferences(userId, dto)` — upsert each NotificationPreference in dto

- [ ] Task 3: PushNotificationJob — BullMQ queue: `push-notifications`
  - Process: call `firebase-admin.messaging().send({ token, notification: { title, body }, data })`
  - On `messaging/registration-token-not-registered`: delete UserDevice record, do NOT retry
  - On other Firebase error: let BullMQ retry (3 attempts, exponential backoff)

- [ ] Task 4: ActivityReminderJob — BullMQ queue: `push-notifications` (same queue, different job name)
  - Job name: `remind-activity:{activityId}`
  - Process: find students where ActivityAssignment status = NOT_STARTED for activityId
  - Call NotificationsService.sendBulk(studentIds, { type: ACTIVITY_DUE_REMINDER, activityId })
  - Delete Redis key `notif_job:{activityId}` on completion

- [ ] Task 5: DevicesController + NotificationsController
  - DevicesController: `POST /api/v1/devices/register`, `DELETE /api/v1/devices/:token`
  - NotificationsController: `GET /api/v1/notifications/preferences`, `PATCH /api/v1/notifications/preferences`
  - `@Roles(Role.TEACHER, Role.STUDENT, Role.FAMILY)` on all device endpoints
  - Full OpenAPI decorators

- [ ] Task 6: Integration — wire sendToUser calls from other modules
  - Activities publish → NEW_ACTIVITY to students
  - Submissions submit → SUBMISSION_RECEIVED to teacher
  - Assessment return → ACTIVITY_RETURNED to student
  - Journal approve → JOURNAL_POST_APPROVED to family
  - Messaging send → NEW_MESSAGE to recipient (if offline)
  - Classes family invite accept → FAMILY_CONNECTED to teacher

- [ ] Task 7: Frontend — NotificationPreferencesPage
  - Grouped toggles by category (Learning, Communication, Reminders)
  - Optimistic update on toggle (PATCH immediately, revert on error)
  - Skeleton loading state

- [ ] Task 8: Unit tests
  - `notifications.service.spec.ts` — sendToUser (multiple devices), scheduleReminder (job enqueued + Redis key set), cancelReminder (key missing = no-op), registerDevice (upsert), getPreferences (defaults for missing types)
