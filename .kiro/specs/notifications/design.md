# Notifications Module — Design

## API endpoints

```
POST   /api/v1/devices/register              — register FCM/APNs device token
DELETE /api/v1/devices/:token                — unregister device token
GET    /api/v1/notifications/preferences     — get current user's notification preferences
PATCH  /api/v1/notifications/preferences     — bulk update enabled/disabled per type
```

## File structure

```
src/modules/notifications/
  dto/
    register-device.dto.ts
    update-preferences.dto.ts
  notifications.module.ts
  notifications.controller.ts
  notifications.service.ts
  notifications.service.spec.ts
  push-notification.job.ts
  activity-reminder.job.ts
  index.ts

apps/web/components/notifications/
  NotificationPreferencesPage.tsx
```

## Push delivery flow

```
NotificationsService.sendToUser(userId, payload)
  → look up all UserDevice records for userId
  → for each device: enqueue job to `push-notifications` queue
PushNotificationJob
  → call firebase-admin messaging.send({ token, notification, data })
  → on error messaging/registration-token-not-registered
    → delete UserDevice record (token no longer valid)
  → on other error: retry up to 3 times (exponential backoff)
```

## Reminder job flow

```
Activity published with due_date set
  → NotificationsService.scheduleReminder(activityId, dueDate)
    → create delayed BullMQ job in `push-notifications` queue (fires 24h before due_date)
    → store job id in Redis: notif_job:{activityId}
Reminder fires
  → find all students with status = NOT_STARTED for this activity
  → sendToUser for each
```

## Key dependencies

- `firebase-admin` — FCM delivery
- `@nestjs/bull` + BullMQ — async delivery queue
- Redis key `notif_job:{activityId}` for reminder job tracking (see redis-key.md)
