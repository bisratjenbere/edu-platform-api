# Classes Module — Requirements

## Overview
Classes are the primary organisational unit of EduFlow. A class groups students
under one or more teachers for a school year. Teachers manage rosters, invite
families, and archive classes. All downstream modules (activities, submissions,
journal, messaging) are scoped to a class.

---

## User stories

### US-CLS-01 — Create a class
As a teacher, I want to create a class so I can organise my students.

**Acceptance criteria:**
- WHEN I submit a valid name, grade level, subject, school year, and optional cover colour
- THEN a Class record is created with my user as PRIMARY co-teacher in ClassTeacher
- AND the class is returned with status 201
- AND a duplicate name within the same school year and school returns 409 Conflict

### US-CLS-02 — List my classes
As a teacher, I want to see all my active classes so I can navigate between them.

**Acceptance criteria:**
- WHEN I call GET /api/v1/classes
- THEN I receive only classes where I am a ClassTeacher (PRIMARY or CO_TEACHER)
- AND archived classes are excluded by default
- AND I can pass ?includeArchived=true to include them
- AND each class includes teacher count, student count, and pending submission count

### US-CLS-03 — Add a co-teacher
As a primary teacher, I want to invite a colleague to co-teach my class.

**Acceptance criteria:**
- WHEN I submit a valid teacher email
- THEN IF the user exists with role TEACHER in the same school, they are added as CO_TEACHER
- AND they receive an email notification
- WHEN the email does not match any teacher in the school
- THEN I receive 404 with message "No teacher found with that email in your school"
- WHEN I try to add someone who is already a co-teacher
- THEN I receive 409 Conflict

### US-CLS-04 — Remove a co-teacher
As a primary teacher, I want to remove a co-teacher from my class.

**Acceptance criteria:**
- WHEN I remove a co-teacher
- THEN their ClassTeacher record is deleted
- AND they lose access to all class content immediately
- WHEN I try to remove the PRIMARY teacher (myself)
- THEN I receive 400 with message "Cannot remove the primary teacher"

### US-CLS-05 — Add students to a class
As a teacher, I want to add students to my class individually or via CSV import.

**Acceptance criteria:**
- WHEN I add a student by user ID
- THEN a ClassStudent record is created with default avatar emoji
- AND the student immediately sees the class in their app

**CSV import:**
- WHEN I upload a CSV with columns: firstName, lastName, email, gradeLevel
- THEN each row is validated and upserted (create if not exists, link if exists)
- AND a summary is returned: { added, updated, failed, errors[] }
- AND rows with missing firstName or lastName are skipped with an error entry
- AND the import is processed synchronously for ≤ 50 rows, async (BullMQ) for > 50

### US-CLS-06 — Remove a student
As a teacher, I want to remove a student from my class.

**Acceptance criteria:**
- WHEN I remove a student
- THEN ClassStudent.is_active is set to false (soft remove, preserves submission history)
- AND the student no longer sees the class or its activities
- AND their existing submissions and journal posts are preserved

### US-CLS-07 — Invite a family member
As a teacher, I want to invite a parent or guardian to connect to a student in my class.

**Acceptance criteria:**
- WHEN I submit a family member's email and the student ID
- THEN a FamilyStudent record is created with status PENDING
- AND an invitation email is sent with a secure accept link (JWT, 7-day expiry)
- WHEN the family member clicks the link and accepts
- THEN FamilyStudent.status is set to ACTIVE and they can view the student's journal
- WHEN the invite token is expired
- THEN they receive 401 and a prompt to request a new invite from the teacher

### US-CLS-08 — Archive a class
As a teacher, I want to archive a class at the end of a school year.

**Acceptance criteria:**
- WHEN I archive a class
- THEN Class.is_archived is set to true
- AND no new activities can be published to it (returns 400 if attempted)
- AND all existing content remains accessible in read-only mode
- AND the class disappears from the default class list

### US-CLS-09 — Student joins via class code
As a student (Grade 3–5), I want to join a class using a short class code.

**Acceptance criteria:**
- WHEN a teacher generates a class code
- THEN a 6-character alphanumeric code is stored with 48-hour expiry
- WHEN a student submits the code
- THEN they are added to the class as a ClassStudent
- AND the code is single-use-per-student (same student cannot rejoin via same code)
- WHEN the code is expired
- THEN the student receives 400 with message "Class code has expired"

### US-CLS-10 — School admin views all classes
As a school admin, I want to see all classes in my school with key stats.

**Acceptance criteria:**
- WHEN I call GET /api/v1/admin/classes (scoped in Admin module)
- THEN I receive all classes for my school_id including archived ones
- AND each class shows: teacher names, student count, activity count, last active date
- WHEN a district admin calls the same endpoint with ?schoolId=
- THEN results are filtered to that school only

---

## Out of scope for this module
- Google Classroom import (Phase 2 consideration)
- Class templates / duplicate class (Phase 2)
- Student self-enrol without teacher approval (not in product)