# Notifications Module — Full Spec

## Requirements

Push notifications delivered via FCM (Android/Web) and APNs via Firebase (iOS).
Users control which notification types they receive.

## Notification types
| Type | Recipient | Trigger |
|---|---|---|
| NEW_ACTIVITY | Student | Activity published to their class |
| SUBMISSION_RECEIVED | Teacher | Student submits activity |
| ACTIVITY_RETURNED | Student | Teacher returns submission |
| JOURNAL_POST_APPROVED | Family | Teacher approves a post |
| NEW_MESSAGE | Teacher + Family | New message in any thread |
| ACTIVITY_DUE_REMINDER | Student | 24h before due_date |
| FAMILY_CONNECTED | Teacher | Family member connects to a student |

## API endpoints
```
POST   /api/v1/devices/register           — { token, platform } upsert device
DELETE /api/v1/devices/:token             — unregister
GET    /api/v1/notifications/preferences  — get user's preferences
PATCH  /api/v1/notifications/preferences  — bulk update enabled/disabled
```

## Push delivery logic
1. NotificationService.sendToUser(userId, payload)
2. Look up UserDevice records for user
3. Send via firebase-admin SDK
4. On error `messaging/registration-token-not-registered`: delete UserDevice
5. All sends via BullMQ queue `push-notifications` with 3 retries, exponential backoff

## Reminder job
- BullMQ delayed job created when activity is published with a due_date
- Fires 24h before due_date
- Finds students with NOT_STARTED status → sends reminder

## Tasks
- [ ] Task 1: NotificationsService — sendToUser, scheduleReminder, sendBulk
- [ ] Task 2: PushNotificationJob + ActivityReminderJob (BullMQ processors)
- [ ] Task 3: DevicesController + NotificationsController
- [ ] Task 4: Integration — call sendToUser from submissions, messaging, journal modules
- [ ] Task 5: Frontend — NotificationPreferencesPage (toggles grouped by category)
- [ ] Task 6: Unit tests
