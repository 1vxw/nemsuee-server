# Backend API Documentation

Base URL: `/api`

Authentication:

- Cookie: `nemsuee_auth` (httpOnly JWT)
- Or `Authorization: Bearer <token>`
- Some endpoints are public (mainly under `/auth` and `/public`)

Response format is JSON unless otherwise stated.

## Health

- `GET /health`
  - Returns `{ ok: true }`

## Auth

- `POST /auth/register`
  - Register student/instructor
- `POST /auth/login`
  - Login and set auth cookie
- `POST /auth/logout`
  - Clear auth cookie
- `POST /auth/guest`
  - Guest session token
- `GET /auth/me`
  - Current user profile (auth required)
- `POST /auth/verify-email`
  - Verify account by token
- `POST /auth/resend-verification`
  - Resend verification email
- `POST /auth/account-status`
  - Activation check flow (public-facing response)
- `POST /auth/forgot-password`
  - Request password reset link
- `POST /auth/reset-password`
  - Reset password by token
- `POST /auth/promote-admin`
  - Bootstrap admin promotion (requires bootstrap key)
- `GET /auth/instructor-applications`
  - Admin/registrar view
- `PATCH /auth/instructor-applications/:userId`
  - Admin/registrar decision

## Public

- `GET /public/courses/catalog`
  - Public course catalog (guest-safe)

## Courses

- `GET /courses`
  - Role-specific course listing
- `GET /courses/catalog`
  - Student catalog
- `GET /courses/instructors`
  - Admin/registrar instructors
- `GET /courses/archived`
  - Instructor archived courses
- `GET /courses/teaching-blocks`
  - Instructor block assignments
- `GET /courses/:id/enrollment-key`
  - Enrollment key (role-restricted)
- `POST /courses/:id/enroll-request`
  - Student enrollment request
- `GET /courses/:id/enrollments/pending`
  - Instructor pending requests
- `POST /courses/:id/enrollments/manual`
  - Instructor manual student add
- `PATCH /courses/:courseId/enrollments/:enrollmentId`
  - Instructor enrollment decision
- `DELETE /courses/:courseId/enrollments/:enrollmentId`
  - Instructor remove enrollment
- `DELETE /courses/:id/enrollment/me`
  - Student self-drop
- `PATCH /courses/:id/enrollment-key/regenerate`
  - Instructor key regenerate
- `PATCH /courses/:id/archive`
  - Instructor archive/unarchive
- `PUT /courses/:id`
  - Admin or owning instructor update
- `DELETE /courses/:id`
  - Admin or owning instructor delete

Announcements and content:

- `GET /courses/:id/announcements`
- `POST /courses/:id/announcements`
- `POST /courses/:courseId/sections/:sectionId/lessons`
- `PATCH /courses/:courseId/sections/:sectionId/lessons/:lessonId`
- `DELETE /courses/:courseId/sections/:sectionId/lessons/:lessonId`

Block/instructor management:

- `POST /courses/:id/sections`
- `PATCH /courses/:courseId/sections/:sectionId`
- `DELETE /courses/:courseId/sections/:sectionId`
- `GET /courses/:courseId/sections/:sectionId/instructors`
- `POST /courses/:courseId/sections/:sectionId/instructors`
- `DELETE /courses/:courseId/sections/:sectionId/instructors/:instructorId`

## Quizzes

V2 lesson quiz endpoints:

- `GET /quizzes/course/:courseId`
- `POST /quizzes/lessons/:lessonId`
- `PATCH /quizzes/:id/settings`
- `DELETE /quizzes/:id/questions/:questionId`
- `POST /quizzes/:id/submit-v2`
- `GET /quizzes/:id/score`
- `GET /quizzes/:id/results/me`
- `GET /quizzes/:id/results/attempt/:attemptId`
- `GET /quizzes/:id/analytics`
- `GET /quizzes/course/:courseId/analytics`

Legacy quiz endpoints (still present for compatibility):

- `POST /quizzes`
- `PUT /quizzes/:id`
- `DELETE /quizzes/:id`
- `POST /quizzes/:id/submit`
- `GET /quizzes/scores/me`
- `GET /quizzes/scores/instructor`

## Tasks

- `GET /tasks/course/:courseId?kind=ASSIGNMENT|ACTIVITY`
- `POST /tasks/course/:courseId/sections/:sectionId`
- `GET /tasks/:taskId`
- `PATCH /tasks/:taskId`
- `DELETE /tasks/:taskId`
- `POST /tasks/:taskId/submissions`
- `DELETE /tasks/:taskId/submissions/me`
- `GET /tasks/:taskId/submissions`
- `PATCH /tasks/submissions/:submissionId/grade`

## Grade Computation

- `GET /grade-computation/course/:courseId/weights`
- `PATCH /grade-computation/course/:courseId/weights`
- `GET /grade-computation/course/:courseId`
- `GET /grade-computation/course/:courseId/computed`
- `PATCH /grade-computation/course/:courseId/student/:studentId`
- `POST /grade-computation/course/:courseId/student/:studentId/submit`
- `GET /grade-computation/review/pending`
- `PATCH /grade-computation/review/block`
- `GET /grade-computation/review/block`
- `PATCH /grade-computation/review/:id`
- `GET /grade-computation/me`
- `GET /grade-computation/me/final-course`

## Terms

- `GET /terms/active`
- `GET /terms/context`
- `GET /terms`
- `POST /terms`
- `PATCH /terms/:id/activate`
- `PATCH /terms/:id/archive`
- `PATCH /terms/:id`
- `DELETE /terms/:id`
- `PATCH /terms/courses/:courseId/assign`
- `GET /terms/:id/offerings`
- `POST /terms/:id/offerings`

## Admin Settings

- `GET /admin/settings/public`
- `GET /admin/settings`
- `PATCH /admin/settings`
- `PATCH /admin/settings/security`
- `POST /admin/settings/security/api-key/rotate`
- `POST /admin/settings/security/api-key/revoke`

## Storage (Google Drive)

- `GET /storage/google/connect-url`
- `GET /storage/google/callback`
- `GET /storage/google/status`
- `GET /storage/google/files`
- `POST /storage/google/upload`
- `GET /storage/google/folders`
- `POST /storage/google/folders`
- `PATCH /storage/google/files/:id/move`
- `DELETE /storage/google/files/:id`
- `DELETE /storage/google/disconnect`

## Notifications

- `POST /notifications/actions`
- `GET /notifications/me`
- `PATCH /notifications/read-all`
- `PATCH /notifications/:id/read`
- `DELETE /notifications/clear`

## Error Semantics

Common response patterns:

- `400` validation/input errors
- `401` missing/invalid authentication token
- `403` role/ownership/policy denied
- `404` resource or route not found
- `409` conflict (duplicate, already exists, etc.)
- `429` rate limit exceeded
- `500` internal server error
