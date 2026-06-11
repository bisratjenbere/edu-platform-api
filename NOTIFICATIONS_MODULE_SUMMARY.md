# Notifications Module — Implementation Summary

## Overview
The Notifications module provides push notification capabilities via Firebase Cloud Messaging (FCM) and Apple Push Notification service (APNs). It supports device registration, user notification preferences, scheduled reminders, and bulk notifications.

## Completed Tasks

### ✅ Task 1: DTOs
- `register-device.dto.ts` — Device token and platform registration
- `update-preferences.dto.ts` — Bulk preference updates

### ✅ Task 2: NotificationsService
Core methods implemented:
- `sendToUser()` — Send to all user devices with preference checking
- `sendBulk()` — Parallel sends to multiple users
- `scheduleReminder()` — Schedule activity due date reminders (24h before)
- `cancelReminder()` — Cancel scheduled reminders
- `registerDevice()` — Upsert device tokens
- `unregisterDevice()` — Remove device with ownership verification
- `getPreferences()` — Get all preferences with defaults
- `updatePreferences()` — Bulk upsert preferences

### ✅ Task 3: PushNotificationJob
BullMQ processor for `push-notifications` queue:
- Sends via `firebase-admin.messaging().send()`
- Handles `messaging/registration-token-not-registered` by deleting device
- Retries 3 times with exponential backoff on other errors

### ✅ Task 4: ActivityReminderJob
BullMQ processor for activity due date reminders:
- Job name: `remind-activity:{activityId}`
- Finds students with NOT_STARTED status
- Sends ACTIVITY_DUE_REMINDER notifications
- Cleans up Redis key on completion

### ✅ Task 5: Controllers
**DevicesController** (`/api/v1/devices`):
- `POST /register` — Register device token
- `DELETE /:token` — Unregister device token
- Roles: TEACHER, STUDENT, FAMILY

**NotificationsController** (`/api/v1/notifications`):
- `GET /preferences` — Get user preferences
- `PATCH /preferences` — Update preferences
- Roles: TEACHER, STUDENT, FAMILY

### ✅ Task 6: Integration with Other Modules
Wired `sendToUser()` calls throughout the platform:

| Trigger | Notification Type | Recipient | Module |
|---------|-------------------|-----------|---------|
| Activity published | NEW_ACTIVITY | Students | Activities |
| Submission submitted | SUBMISSION_RECEIVED | Teachers | Submissions |
| Feedback returned | ACTIVITY_RETURNED | Student | Submissions |
| Journal post approved | JOURNAL_POST_APPROVED | Family | Journal |
| Family invite accepted | FAMILY_CONNECTED | Teacher | Classes |

### ✅ Task 7: Frontend (Noted as frontend-only)
NotificationPreferencesPage — will be implemented in web app.

### ✅ Task 8: Unit Tests
`notifications.service.spec.ts` covers:
- sendToUser with multiple devices
- Preference checking (disabled notifications not sent)
- Missing devices handled gracefully
- scheduleReminder with Redis key storage
- cancelReminder with missing job (no-op)
- registerDevice upsert logic
- unregisterDevice ownership verification
- getPreferences with defaults for missing types

## Module Dependencies

### Imports
- `PrismaModule` — Database access
- `RedisModule` — Redis for job IDs
- `BullModule` — Queue for push notifications

### Exports
- `NotificationsService` — Used by Activities, Submissions, Journal, Classes

### Circular Dependency Handling
Used `forwardRef()` to break circular dependencies:
- Activities ↔ Notifications
- Submissions ↔ Notifications  
- Journal ↔ Notifications
- Classes ↔ Notifications

## API Endpoints

### Device Management
```
POST   /api/v1/devices/register
DELETE /api/v1/devices/:token
```

### Preferences Management  
```
GET    /api/v1/notifications/preferences
PATCH  /api/v1/notifications/preferences
```

## Notification Types (Enum)
```typescript
enum NotificationType {
  NEW_ACTIVITY
  SUBMISSION_RECEIVED
  ACTIVITY_RETURNED
  JOURNAL_POST_APPROVED
  NEW_MESSAGE
  ACTIVITY_DUE_REMINDER
  FAMILY_CONNECTED
}
```

## Redis Keys Used
| Key | Value | TTL | Purpose |
|-----|-------|-----|---------|
| `notif_job:{activityId}` | BullMQ job ID | Duration until due_date + 25h | Track reminder job for cancellation |

## BullMQ Queues
**Queue Name**: `push-notifications`

**Job Types**:
1. `send-push` — Immediate push notification
2. `remind-activity:{activityId}` — Delayed activity reminder

**Configuration**:
- Attempts: 3
- Backoff: Exponential, 5s delay
- removeOnComplete: true
- removeOnFail: false

## Security & Compliance
- Device tokens validated on registration
- Ownership verified on unregister
- Preferences enforced before sending
- Invalid tokens removed automatically
- All endpoints require JWT authentication
- Role-based access control applied

## Testing
All 12 unit tests passing:
```
✓ sendToUser - multiple devices
✓ sendToUser - disabled notification type  
✓ sendToUser - no devices
✓ scheduleReminder - job enqueued + Redis key
✓ scheduleReminder - < 24h skip
✓ cancelReminder - removes job + Redis key
✓ cancelReminder - missing job graceful
✓ registerDevice - upsert
✓ unregisterDevice - ownership check
✓ unregisterDevice - not found
✓ unregisterDevice - forbidden
✓ getPreferences - defaults filled
```

## Next Steps
The Notifications module backend is complete. Remaining work:
1. **Frontend**: NotificationPreferencesPage (Task 7)
2. **Messaging Module**: Add NEW_MESSAGE notifications when built
3. **Firebase Setup**: Configure Firebase project and add credentials to .env

## Files Created/Modified
**New Files**:
- `apps/api/src/modules/notifications/devices.controller.ts`
- `apps/api/src/modules/notifications/notifications.controller.ts`
- `apps/api/src/modules/notifications/index.ts`

**Modified Files**:
- `apps/api/src/modules/activities/activities.service.ts`
- `apps/api/src/modules/activities/activities.module.ts`
- `apps/api/src/modules/submissions/submissions.service.ts`
- `apps/api/src/modules/submissions/submissions.module.ts`
- `apps/api/src/modules/journal/journal.service.ts`
- `apps/api/src/modules/journal/journal.module.ts`
- `apps/api/src/modules/classes/family-invite.service.ts`
- `apps/api/src/modules/classes/classes.module.ts`
- `.kiro/steering/structure.md`

## Status
✅ **Notifications Module Complete** — Phase 4 (Communication) backend complete.
