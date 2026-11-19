# Security Specification & Threat Model (BAMS Attendance & Analytics)

## 1. Data Invariants
1. **Strict RBAC & Non-Self-Escalation**: Only verified Admin (`ajayby0198@gmail.com` or existing `admins/{uid}`) can assign `admin`, `principal`, or `teacher` roles. Self-registration is locked to `role: 'student'`.
2. **PII Isolation**: User email addresses and phone numbers reside exclusively in `/users/{userId}/private/{docId}`, readable only by the profile owner and Admin.
3. **Session Terminal Locking**: Once an `attendanceSessions/{sessionId}` document reaches `status: 'submitted'`, teachers and students cannot mutate it or its child `records` / `checkIns`. Only an Admin may perform corrective updates.
4. **Student Self-Check-In Integrity**: Students can only create a `checkIns/{uid}` document under `/attendanceSessions/{sessionId}` when the parent session exists, `status == 'draft'`, `allowStudentSelfMark == true`, and `incoming().checkInCode == parent.checkInCode`. Students can never write directly to `records/{studentId}` or `students/{studentId}`.
5. **Temporal Integrity**: All `createdAt`, `updatedAt`, and `checkedInAt` timestamps must equal `request.time`.
6. **Zero-Trust List Queries**: Every `allow list` rule evaluates `resource.data` directly without `get()` or `exists()` lookups.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Role Self-Escalation**: Student tries creating `/users/{uid}` with `role: 'principal'`. -> `PERMISSION_DENIED`.
2. **Role Update Escalation**: Teacher tries updating `/users/{uid}` changing `role` to `'admin'`. -> `PERMISSION_DENIED`.
3. **Ghost Field Injection**: User creates `/users/{uid}` with extra field `isVerifiedAdmin: true`. -> `PERMISSION_DENIED`.
4. **PII Cross-Read**: Teacher tries reading `/users/{studentUid}/private/info`. -> `PERMISSION_DENIED`.
5. **Email Spoofing**: Unverified user token attempts write/admin action with `email_verified: false`. -> `PERMISSION_DENIED`.
6. **ID Poisoning**: Client writes `/attendanceSessions/aaaa...200chars` or `/students/bad$id`. -> `PERMISSION_DENIED`.
7. **Post-Submit Tampering**: Teacher attempts updating `/attendanceSessions/{id}` after `status == 'submitted'`. -> `PERMISSION_DENIED`.
8. **Student Forging Session Record**: Student tries writing `/attendanceSessions/{id}/records/{studentId}` directly. -> `PERMISSION_DENIED`.
9. **Wrong Check-In Code**: Student submits `/attendanceSessions/{id}/checkIns/{uid}` with wrong `checkInCode`. -> `PERMISSION_DENIED`.
10. **Check-In on Submitted Session**: Student submits `/attendanceSessions/{id}/checkIns/{uid}` when parent `status == 'submitted'`. -> `PERMISSION_DENIED`.
11. **Backdated Timestamp**: Teacher creates `/attendanceSessions/{id}` with forged past `createdAt`. -> `PERMISSION_DENIED`.
12. **Blanket Student Scraping**: Student attempts unbounded `list` on `/students` or `/users`. -> `PERMISSION_DENIED`.
