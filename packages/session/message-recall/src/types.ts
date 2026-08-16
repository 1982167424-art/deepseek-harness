/**
 * Public types for the message-recall package.
 * @module @deepseek-ai/dsh-session-message-recall/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import type { SessionId } from '@deepseek-ai/dsh-session'

export type RecallSnapshotId = Branded<'RecallSnapshotId'>
export type RecallId = Branded<'RecallId'>

export interface RecallFileSnapshotPayload {
  snapshotId: RecallSnapshotId
  sessionId: SessionId
  turnId: string
  stepId?: string
  filePath: string
  sha256Before: string
  contentBefore: string
}

export interface RecallRecalledPayload {
  recallId: RecallId
  sessionId: SessionId
  recalledMessageIds: MessageId[]
  revertedFilePaths: string[]
  newSessionSeq: number
}

export interface RecallFileSnapshotEntry {
  snapshotId: RecallSnapshotId
  sessionId: SessionId
  turnId: string
  stepId?: string
  filePath: string
  sha256Before: string
  contentBefore: string
  createdAt: number
}

export interface RecallRecalledEntry {
  recallId: RecallId
  sessionId: SessionId
  recalledMessageIds: MessageId[]
  revertedFilePaths: string[]
  newSessionSeq: number
  createdAt: number
}

export interface RecallAvailableSnapshot {
  snapshotId: RecallSnapshotId
  turnId: string
  stepId?: string
  filePath: string
  createdAt: number
}

export interface RecallResult {
  ok: boolean
  revertedFiles: string[]
  recalledCount: number
  error?: string
}

export interface MessageRecallSettings {
  maxRecallWindow: number
  autoSnapshotOnFileEdits: boolean
}
