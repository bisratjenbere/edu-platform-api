# Messaging Module — Tasks

## Implementation order (follow this sequence exactly)

- [ ] Task 1: DTOs
  - `create-thread.dto.ts` — thread_type (IsEnum ThreadType), class_id (IsUUID), subject (IsString, optional, max 200), recipient_ids (IsArray IsUUID, required for DIRECT/GROUP), allow_replies (IsBoolean, default true)
  - `send-message.dto.ts` — body (IsString, IsNotEmpty, max 10000), attachments (IsArray, optional, max 5 items, each: { url: IsUrl, type: 'image'|'pdf'|'link', displayName: string })
  - `translate-message.dto.ts` — message_id (IsUUID), target_lang (IsString, min 2, max 5)

- [ ] Task 2: MessagesService
  - `createThread(creatorId, dto)` — verify creator is TEACHER, verify all recipient_ids are in class, create MessageThread + ThreadParticipant rows
  - `sendMessage(threadId, senderId, dto)` — verify sender is ThreadParticipant, create Message, increment Redis `unread:{userId}` for each participant except sender, enqueue TranslationJob if any participant's preferred_language != 'en', emit `new-message` via MessagingGateway
  - `getThreads(userId, cursor?, limit?)` — return threads where user is participant, cursor-based pagination, include last message and unread count
  - `getThread(threadId, userId, cursor?, limit?)` — verify participant, return messages cursor-paginated, return body in user's preferred_language if translation cached
  - `markRead(threadId, userId)` — update ThreadParticipant.last_read_at, delete Redis key `unread:{userId}` (full reset — correct per redis-key.md)
  - `getUnreadCount(userId)` — GET Redis `unread:{userId}`, return 0 if key missing

- [ ] Task 3: TranslationJob — BullMQ queue: `translations`
  - For each recipient with preferred_language != 'en' and != source language
  - Call Google Cloud Translate API v3
  - Cache result in Message.translated_bodies[langCode]
  - On API error: log at warn level, do not fail the job — message is still readable in original

- [ ] Task 4: MessagingGateway
  - Namespace: `/messages`
  - Room: `user:{userId}` — each user joins their own room on connect
  - Auth: validate JWT from handshake auth token
  - Event emitted: `new-message` with full message payload
  - If recipient offline: push notification job enqueued (NEW_MESSAGE type)

- [ ] Task 5: MessagesController — all endpoints
  - `@Roles(Role.TEACHER)` on createThread
  - `@Roles(Role.TEACHER, Role.FAMILY)` on sendMessage, getThreads, getThread, markRead, getUnreadCount
  - Full OpenAPI decorators on every method

- [ ] Task 6: Unread count Redis integration
  - `INCR unread:{userId}` on every new message per recipient (in MessagesService.sendMessage)
  - `DEL unread:{userId}` on markRead
  - `GET unread:{userId}` on getUnreadCount — return 0 if nil (never error)

- [ ] Task 7: Frontend — MessagingInbox
  - Thread list with unread badge (red dot + count)
  - Last message preview (truncated to 60 chars)
  - Search bar (filter by recipient name or subject)
  - New message compose button

- [ ] Task 8: Frontend — ThreadView
  - Message bubbles (sent = right/blue, received = left/grey)
  - Timestamp below each bubble
  - Attachment renderer (image thumbnail, PDF icon + filename, link preview)
  - Reply input at bottom (hidden if allow_replies = false for FAMILY user)
  - Auto-scroll to latest message on open
  - WebSocket subscription for real-time new messages

- [ ] Task 9: Frontend — NewMessageModal
  - Step 1: type selector (Direct / Group / Announcement)
  - Step 2: recipient picker (search family members in class)
  - Subject input (optional)
  - Attachment upload (uses mediaUpload.service.ts)
  - Allow replies toggle (announcements only)

- [ ] Task 10: Unit tests
  - `messages.service.spec.ts` — createThread, sendMessage (unread increment, translation enqueued), markRead (unread reset), getUnreadCount (missing key = 0), access control
