# Journal (Digital Portfolio) Module — Full Spec

## Requirements

### Overview
Each student has a personal journal — a chronological feed of approved posts visible
to their family. Posts come from approved activity submissions, teacher posts, and
student self-posts pending teacher approval.

### User stories

**US-JOUR-01 — Student journal feed**
As a family member, I want to see my child's approved work in a beautiful feed.
- Shows: submitted activities (approved), teacher posts, student self-posts (approved)
- Newest first, infinite scroll
- Each post shows: media, activity title (if linked), teacher comment, heart count

**US-JOUR-02 — Teacher approval gate**
As a teacher, I want to approve student posts before families can see them.
- Student self-posts and activity submissions start as PENDING_APPROVAL
- Teacher sees pending count badge
- One-click approve or reject (with optional reason)
- Only APPROVED posts visible to family

**US-JOUR-03 — Family reactions**
As a family member, I want to heart my child's work to celebrate them.
- Heart button on every post
- Toggle: tap once to heart, tap again to un-heart
- Heart count visible to teacher and family

**US-JOUR-04 — Comments**
As a teacher or family member, I want to leave encouraging comments on posts.
- Teachers and family can comment
- Students cannot see comments (age-appropriate — teacher controls this)
- Comment author and timestamp shown

---

## Design

### API endpoints
```
GET    /api/v1/journal/:studentId              — paginated feed (cursor)
POST   /api/v1/journal/:studentId/posts        — student self-post
GET    /api/v1/journal/:studentId/pending      — teacher: pending approval list
POST   /api/v1/journal/posts/:postId/approve
POST   /api/v1/journal/posts/:postId/reject
POST   /api/v1/journal/posts/:postId/reactions — toggle heart
GET    /api/v1/journal/posts/:postId/reactions
POST   /api/v1/journal/posts/:postId/comments
GET    /api/v1/journal/posts/:postId/comments
DELETE /api/v1/journal/posts/:postId/comments/:commentId
```

### Access control
- Students: own approved posts only
- Teachers: all posts in their class (all statuses)
- Family: only APPROVED posts for their connected child only

### File structure
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

---

## Tasks

- [ ] Task 1: JournalService — feed, approve, reject, reaction toggle, comments
- [ ] Task 2: JournalController — all endpoints with RBAC
- [ ] Task 3: Auto-create journal post on submission approval
- [ ] Task 4: Frontend — StudentJournalPage (infinite scroll, masonry for media)
- [ ] Task 5: Frontend — JournalPostCard (media, heart animation, comments)
- [ ] Task 6: Frontend — PendingApprovalBanner (teacher view, approve/reject flow)
- [ ] Task 7: Unit tests
