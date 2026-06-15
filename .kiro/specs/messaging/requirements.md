# Messaging Module — Full Spec

## Requirements

### Overview
Two-way communication between teachers and families. Supports direct messages,
group messages, and one-way announcements. Auto-translates into 100+ languages
based on recipient's device language preference.

### User stories

**US-MSG-01 — Direct message to family**
As a teacher, I want to send a private message to a student's family member.
- Message visible only to that family member and the teacher
- Family member can reply (two-way)

**US-MSG-02 — Group message**
As a teacher, I want to message all families in my class at once.
- All class family members receive the message
- Each can reply privately back to the teacher only
- Other families cannot see each other's replies

**US-MSG-03 — Class announcement**
As a teacher, I want to broadcast an announcement to all class families.
- Teacher can disable replies (one-way broadcast mode)
- When allow_replies = false, family sees message but no reply input

**US-MSG-04 — Auto-translation**
As a family member who speaks Spanish, I want to receive messages in Spanish automatically.
- WHEN my preferred_language is set to 'es'
- THEN all incoming messages are automatically translated to Spanish
- AND the original language is preserved (teacher sees original)

**US-MSG-05 — Unread count**
As a teacher, I want to see how many unread messages I have.
- Unread count badge shown on messaging icon in nav
- Resets to 0 when I open the thread

**US-MSG-06 — Multimedia attachments**
As a teacher, I want to attach photos, PDFs, and links to my messages.
- Supported: image/jpeg, image/png, application/pdf, links (URL)
- Max attachment size: 50 MB

---

## Design

### API endpoints
```
POST   /api/v1/messages/threads              — create thread
GET    /api/v1/messages/threads              — list my threads (paginated, cursor)
GET    /api/v1/messages/threads/:id          — thread + messages (cursor paginated)
POST   /api/v1/messages/threads/:id/messages — send message
PATCH  /api/v1/messages/threads/:id/read     — mark as read
GET    /api/v1/messages/unread-count         — total unread
POST   /api/v1/messages/translate            — on-demand translate { messageId, targetLang }
```

### Translation flow
1. Message sent → check recipient's preferred_language
2. If != 'en' → enqueue TranslationJob (BullMQ queue: `translations`)
3. TranslationJob calls Google Translate API
4. Result cached in message.translated_bodies['es']
5. GET /threads/:id returns body in recipient's language if cached

### WebSocket gateway
- Namespace: `/messages`
- Room: `user:{userId}` — each user joins their own room
- Event on new message: `new-message` → emitted to all thread participants
- If user offline: push notification sent instead

### File structure
```
src/modules/messages/
  dto/
    create-thread.dto.ts
    send-message.dto.ts
    translate-message.dto.ts
  messages.module.ts
  messages.controller.ts
  messages.service.ts
  messages.service.spec.ts
  messaging.gateway.ts
  translation.job.ts
  index.ts

apps/web/components/messaging/
  MessagingInbox.tsx      — thread list with unread badges
  ThreadView.tsx          — message bubbles
  NewMessageModal.tsx     — compose: direct/group/announcement
  MessageAttachment.tsx   — render attachments
```

---

## Tasks

- [ ] Task 1: DTOs — create-thread, send-message, translate
- [ ] Task 2: MessagesService — createThread, sendMessage, getThreads, markRead, getUnreadCount
- [ ] Task 3: TranslationJob — BullMQ processor, Google Translate call, cache result
- [ ] Task 4: MessagingGateway — WebSocket, user rooms, new-message events
- [ ] Task 5: MessagesController — all endpoints with role guards
- [ ] Task 6: Unread count — Redis counter per user, increment on new message, reset on read
- [ ] Task 7: Frontend — MessagingInbox (thread list, unread badge, search)
- [ ] Task 8: Frontend — ThreadView (bubbles, timestamp, attachment renderer, reply input)
- [ ] Task 9: Frontend — NewMessageModal (type selector, recipient picker, attachment upload)
- [ ] Task 10: Unit tests — messages.service.spec.ts (create, send, translate, unread)
