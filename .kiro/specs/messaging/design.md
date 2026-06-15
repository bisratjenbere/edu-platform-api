# Messaging Module — Design

## API endpoints

```
POST   /api/v1/messages/threads               — create thread
GET    /api/v1/messages/threads               — list my threads (cursor-paginated)
GET    /api/v1/messages/threads/:id           — thread + messages (cursor-paginated)
POST   /api/v1/messages/threads/:id/messages  — send message
PATCH  /api/v1/messages/threads/:id/read      — mark thread as read
GET    /api/v1/messages/unread-count          — total unread for current user
POST   /api/v1/messages/translate             — on-demand translate { messageId, targetLang }
```

## File structure

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
  MessagingInbox.tsx
  ThreadView.tsx
  NewMessageModal.tsx
  MessageAttachment.tsx
```

## Translation flow

```
sendMessage()
  → for each recipient where preferred_language != 'en'
    → enqueue TranslationJob to `translations` queue
TranslationJob
  → call Google Translate API v3
  → store result in message.translated_bodies['es'] (or target lang code)
getThread()
  → if recipient's preferred_language in message.translated_bodies
    → return translated body
  → else return original body (translation may still be pending)
```

## WebSocket gateway

- Namespace: `/messages`
- Room: `user:{userId}`
- Auth: JWT from `socket.handshake.auth.token`
- Events:
  - Client → server: `joinUser` (auto-joined on connect)
  - Server → client: `new-message` payload: `{ threadId, message, unreadCount }`

## Redis keys used (see redis-key.md for full spec)

- `unread:{userId}` — integer string, no expiry, deleted on markRead

## Key dependencies

- `@nestjs/bull` + BullMQ — translation queue
- `@nestjs/websockets` + `socket.io` — messaging gateway
- `@google-cloud/translate` — Google Translate API v3
- `firebase-admin` — push notification fallback when user offline
