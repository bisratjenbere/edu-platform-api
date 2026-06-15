# Journal Module — Design

## API endpoints

```
GET    /api/v1/journal/:studentId                       — paginated feed (cursor-based)
POST   /api/v1/journal/:studentId/posts                 — student self-post
GET    /api/v1/journal/:studentId/pending               — teacher: pending approval list
POST   /api/v1/journal/posts/:postId/approve            — approve post
POST   /api/v1/journal/posts/:postId/reject             — reject post with optional reason
POST   /api/v1/journal/posts/:postId/reactions          — toggle heart reaction
GET    /api/v1/journal/posts/:postId/reactions          — reaction count + user's reaction
POST   /api/v1/journal/posts/:postId/comments           — add comment
GET    /api/v1/journal/posts/:postId/comments           — list comments
DELETE /api/v1/journal/posts/:postId/comments/:id       — soft delete comment
```

## File structure

```
src/modules/journal/
  dto/
    create-post.dto.ts
    reject-post.dto.ts
    add-comment.dto.ts
  journal.module.ts
  journal.controller.ts
  journal.service.ts
  journal.service.spec.ts
  index.ts

apps/web/components/journal/
  StudentJournalPage.tsx
  JournalPostCard.tsx
  PendingApprovalBanner.tsx
  JournalCommentSection.tsx
```

## Access control matrix

| Action | STUDENT | TEACHER | FAMILY |
|---|---|---|---|
| View feed | Own approved posts only | All posts in own classes | Only approved posts for connected child |
| Create post | Own posts | Via createPostFromSubmission | No |
| Approve / Reject | No | Own class posts | No |
| React | Yes | Yes | Yes |
| Comment | No | Yes | Yes |
| Delete comment | No (own) | Yes (any in class) | Own comments only |

## Auto-post creation flow

```
Teacher sets submission status = APPROVED
  → SubmissionsService calls JournalService.createPostFromSubmission(submissionId)
    → create JournalPost { type: ACTIVITY_SUBMISSION, status: PENDING_APPROVAL, submission_id }
    → teacher sees new item in pending approval list
Teacher approves journal post
  → status = APPROVED
  → enqueue push notification: JOURNAL_POST_APPROVED → family members
```

## Pagination

Feed uses cursor-based pagination (see api-standards.md):
- `cursor` = last post id
- `limit` = 20 (default), max 50
- `orderBy: created_at DESC`
