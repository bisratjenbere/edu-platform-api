# Journal Module — Tasks

## Implementation order (follow this sequence exactly)

- [ ] Task 1: DTOs
  - `create-post.dto.ts` — content_text (IsString, optional, max 5000), media_urls (IsArray, IsUrl each, max 10 items)
  - `reject-post.dto.ts` — reason (IsString, optional, max 500)
  - `add-comment.dto.ts` — content (IsString, IsNotEmpty, max 1000)

- [ ] Task 2: JournalService
  - `getFeed(studentId, requesterId, cursor?, limit?)` — cursor-based pagination, APPROVED posts only for FAMILY role, all statuses for TEACHER, verify access rights per role
  - `createPost(studentId, dto)` — create JournalPost with PENDING_APPROVAL status, type = STUDENT_SELF_POST
  - `getPending(classId, teacherId)` — list all PENDING_APPROVAL posts in teacher's class
  - `approve(postId, teacherId)` — verify teacher owns class, set status = APPROVED, enqueue push notification (JOURNAL_POST_APPROVED) to family
  - `reject(postId, teacherId, dto)` — verify teacher owns class, set status = REJECTED, soft note reason in metadata
  - `toggleReaction(postId, userId)` — upsert/delete JournalReaction, return new heart count
  - `getReactions(postId)` — return count + whether requesting user has reacted
  - `addComment(postId, userId, role, dto)` — verify TEACHER or FAMILY role, create JournalComment
  - `getComments(postId, requesterId)` — return non-deleted comments, verify access
  - `deleteComment(postId, commentId, requesterId)` — soft delete, only comment author or teacher can delete

- [ ] Task 3: Auto-create journal post on submission approval
  - In SubmissionsService.updateFeedback(): when status changes to APPROVED, call JournalService.createPostFromSubmission()
  - `createPostFromSubmission(submissionId)` — create JournalPost with type = ACTIVITY_SUBMISSION, link submission_id, status starts as PENDING_APPROVAL

- [ ] Task 4: JournalController — all endpoints with RBAC
  - `@Roles(Role.STUDENT, Role.TEACHER, Role.FAMILY)` on GET feed (service enforces visibility)
  - `@Roles(Role.STUDENT)` on createPost
  - `@Roles(Role.TEACHER)` on getPending, approve, reject
  - `@Roles(Role.TEACHER, Role.FAMILY)` on addComment, deleteComment
  - `@Roles(Role.TEACHER, Role.FAMILY, Role.STUDENT)` on reactions
  - Full OpenAPI decorators on every method

- [ ] Task 5: Frontend — StudentJournalPage
  - Infinite scroll (TanStack Query + cursor pagination)
  - Masonry layout for mixed media posts
  - Pending approval banner for teacher (count badge + quick approve/reject)
  - Empty state: "No posts yet" with illustration

- [ ] Task 6: Frontend — JournalPostCard
  - Media display (image, audio player, video player, drawing thumbnail)
  - Heart button with animation (optimistic update)
  - Heart count display
  - Comment section (collapsed by default, expand on tap)
  - Activity title badge if linked to activity

- [ ] Task 7: Unit tests
  - `journal.service.spec.ts` — getFeed (family sees only approved, teacher sees all), approve, reject, toggleReaction (add + remove), addComment, access control violations
