import { z } from "zod";

export const studySessionStatusSchema = z.enum([
  "active",
  "processing",
  "ready",
  "archived",
]);
export type StudySessionStatus = z.infer<typeof studySessionStatusSchema>;

export const studySessionSourceRoleSchema = z.enum([
  "primary_pdf",
  "reference",
  "recording_note",
  "generated_note",
]);
export type StudySessionSourceRole = z.infer<typeof studySessionSourceRoleSchema>;

export const sessionRecordingStatusSchema = z.enum([
  "uploaded",
  "processing",
  "ready",
  "failed",
]);
export type SessionRecordingStatus = z.infer<typeof sessionRecordingStatusSchema>;

export const transcriptStatusSchema = z.enum([
  "pending",
  "processing",
  "ready",
  "failed",
]);
export type TranscriptStatus = z.infer<typeof transcriptStatusSchema>;

export const studySessionSourceSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  noteId: z.string().uuid(),
  role: studySessionSourceRoleSchema,
  createdAt: z.string(),
});
export type StudySessionSource = z.infer<typeof studySessionSourceSchema>;

export const studySessionSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  projectId: z.string().uuid(),
  title: z.string(),
  status: studySessionStatusSchema,
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  sources: z.array(studySessionSourceSchema).default([]),
});
export type StudySession = z.infer<typeof studySessionSchema>;

export const sessionRecordingSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  objectKey: z.string(),
  mimeType: z.string(),
  durationSec: z.number().nonnegative().nullable(),
  status: sessionRecordingStatusSchema,
  transcriptStatus: transcriptStatusSchema,
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SessionRecording = z.infer<typeof sessionRecordingSchema>;

export const transcriptSegmentSchema = z.object({
  id: z.string().uuid(),
  recordingId: z.string().uuid(),
  index: z.number().int().nonnegative(),
  startSec: z.number().nonnegative(),
  endSec: z.number().nonnegative(),
  text: z.string(),
  speaker: z.string().nullable(),
  language: z.string().nullable(),
  confidence: z.number().nullable(),
  createdAt: z.string(),
});
export type TranscriptSegment = z.infer<typeof transcriptSegmentSchema>;

export const createStudySessionRequestSchema = z.object({
  projectId: z.string().uuid(),
  title: z.string().trim().min(1).max(160).optional(),
  sourceNoteId: z.string().uuid().optional(),
});
export type CreateStudySessionRequest = z.infer<typeof createStudySessionRequestSchema>;

export const listStudySessionsQuerySchema = z.object({
  sourceNoteId: z.string().uuid().optional(),
});

export const studySessionTranscriptResponseSchema = z.object({
  sessionId: z.string().uuid(),
  text: z.string(),
  segments: z.array(transcriptSegmentSchema),
});
export type StudySessionTranscriptResponse = z.infer<
  typeof studySessionTranscriptResponseSchema
>;
