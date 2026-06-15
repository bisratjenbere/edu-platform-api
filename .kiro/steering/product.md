---
inclusion: always
---

# EduFlow — Product Overview

## What this product is

EduFlow is a cloud-based K–12 Learning Experience Platform (LXP) for PreK–Grade 5 students.
It is functionally equivalent to Seesaw. It connects three actors — teachers, students, and
families — through digital portfolios, activity-based learning, and two-way communication.

## Three separate client applications

- **EduFlow Class App** — for students and teachers (Web, iOS, Android)
- **EduFlow Family App** — for parents/guardians (Web, iOS, Android)
- **EduFlow Admin Portal** — for school and district administrators (Web only)

## Five user roles (never deviate from these)

| Role | What they can do |
|---|---|
| SUPER_ADMIN | Full platform access |
| DISTRICT_ADMIN | Manage multiple schools |
| SCHOOL_ADMIN | Manage one school — teachers, rosters, reports |
| TEACHER | Create classes, assign activities, review submissions, message families |
| STUDENT | Complete activities, build portfolio, view own journal |
| FAMILY | View child's journal, react, message teacher |

## Core feature areas

1. Authentication — email/password, Google OAuth, QR code for K–2 students, Clever SSO
2. Class & student management — roster import, co-teaching, family invites
3. Activity builder — drag-and-drop block editor, 10+ block types, scheduled publish
4. Student submissions — drawing canvas, audio/video recording, file upload, auto-save
5. Digital portfolio (Student Journal) — chronological feed, teacher approval gate, family reactions
6. Assessment — inline feedback, voice feedback, canvas annotation, auto-grading
7. Messaging — teacher↔family, translation into 100+ languages, announcements
8. Push notifications — FCM + APNs, per-user preferences
9. Content library — 100k+ community templates, Elasticsearch search
10. AI features — Claude-powered activity generator, reading fluency assessment (AWS Transcribe)
11. Admin portal — school dashboard, bulk roster import, engagement analytics
12. Integrations — Clever SSO, Google Workspace, CSV SIS import

## Key product constraints

- Students as young as 4 years old use the app — UI must be icon-based with QR login for K–2
- All student data falls under COPPA, FERPA, and GDPR compliance requirements
- Family members only ever see content explicitly approved by a teacher
- Teacher-to-student messages must be visible to school admins for safeguarding
- Video responses capped at 5 minutes; non-video file uploads max 50 MB; video files max 500 MB (see security.md MIME type table for full per-type size limits)
- System must support 99.9% uptime and 10 million concurrent users
