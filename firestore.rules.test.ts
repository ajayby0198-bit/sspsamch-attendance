import assert from 'node:assert';

/**
 * Security Rules Verification Suite (Dirty Dozen Adversarial Payloads)
 * Maps each attack vector in security_spec.md to its rule enforcement check.
 */
export const DIRTY_DOZEN_CASES = [
  {
    name: '1. Role Self-Escalation on User Create',
    path: '/users/student_uid_1',
    payload: { uid: 'student_uid_1', role: 'principal', approvalStatus: 'active' },
    expected: 'PERMISSION_DENIED',
    enforcedBy: "incoming().role == 'student'"
  },
  {
    name: '2. Role Update Escalation by Teacher',
    path: '/users/teacher_uid_1',
    payload: { role: 'admin' },
    expected: 'PERMISSION_DENIED',
    enforcedBy: 'incoming().role == existing().role && affectedKeys().hasOnly([...])'
  },
  {
    name: '3. Ghost Field Injection',
    path: '/users/student_uid_1',
    payload: { uid: 'student_uid_1', isVerifiedAdmin: true },
    expected: 'PERMISSION_DENIED',
    enforcedBy: 'data.keys().hasOnly([...])'
  },
  {
    name: '4. PII Cross-Read by Non-Owner Staff',
    path: '/users/student_uid_1/private/info',
    payload: null,
    expected: 'PERMISSION_DENIED',
    enforcedBy: 'isOwner(userId) || isAdmin()'
  },
  {
    name: '5. Unverified Email Token Spoof',
    path: '/users/spoof_uid',
    payload: { email: 'ajayby0198@gmail.com', email_verified: false },
    expected: 'PERMISSION_DENIED',
    enforcedBy: 'request.auth.token.email_verified == true'
  },
  {
    name: '6. Document ID Poisoning',
    path: '/attendanceSessions/invalid$id_with_special_chars',
    payload: { id: 'invalid$id_with_special_chars' },
    expected: 'PERMISSION_DENIED',
    enforcedBy: 'isValidId(sessionId)'
  },
  {
    name: '7. Post-Submit Attendance Tampering by Teacher',
    path: '/attendanceSessions/session_1',
    payload: { status: 'draft', presentCount: 40 },
    expected: 'PERMISSION_DENIED',
    enforcedBy: "existing().status == 'draft'"
  },
  {
    name: '8. Student Forging Session Record Directly',
    path: '/attendanceSessions/session_1/records/student_1',
    payload: { status: 'present', creditedHours: 2 },
    expected: 'PERMISSION_DENIED',
    enforcedBy: 'hasActiveStaffRole() || isAdmin()'
  },
  {
    name: '9. Wrong Check-In Code Submission',
    path: '/attendanceSessions/session_1/checkIns/student_uid_1',
    payload: { checkInCode: '000000' },
    expected: 'PERMISSION_DENIED',
    enforcedBy: 'incoming().checkInCode == get(...).data.checkInCode'
  },
  {
    name: '10. Check-In on Already Submitted Session',
    path: '/attendanceSessions/session_submitted/checkIns/student_uid_1',
    payload: { checkInCode: '482910' },
    expected: 'PERMISSION_DENIED',
    enforcedBy: "get(...).data.status == 'draft'"
  },
  {
    name: '11. Backdated Client Timestamp Injection',
    path: '/attendanceSessions/session_2',
    payload: { createdAt: '2020-01-01T00:00:00Z' },
    expected: 'PERMISSION_DENIED',
    enforcedBy: 'incoming().createdAt == request.time'
  },
  {
    name: '12. Blanket Student Directory Scraping',
    path: '/students',
    payload: null,
    expected: 'PERMISSION_DENIED',
    enforcedBy: 'resource.data.uid == request.auth.uid || request.auth.uid in resource.data.staffUids'
  }
];

assert.strictEqual(DIRTY_DOZEN_CASES.length, 12);
