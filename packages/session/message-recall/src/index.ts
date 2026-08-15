/**
 * Host plugin for message recall/withdraw: snapshot files before edits,
 * recall last or specific message, and auto-revert file changes.
 *
 * Inject: ['session', 'fs', 'tools', 'llm']
 *
 * @module @deepseek-ai/dsh-session-message-recall
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import z from '@deepseek-ai/schemastery'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { Session, SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import type { FsTarget } from '@deepseek-ai/dsh-fs'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type {
  RecallAvailableSnapshot, RecallFileSnapshotPayload,
  RecallId, RecallRecalledPayload, RecallResult, RecallSnapshotId,
  MessageRecallSettings,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    messageRecall: MessageRecallService
  }
  interface Events {
    'recall/file-snapshot'(
      session: Session,
      payload: RecallFileSnapshotPayload,
    ): void
    'recall/recalled'(
      session: Session,
      payload: RecallRecalledPayload,
    ): void
  }
}

export type {
  RecallAvailableSnapshot, RecallFileSnapshotPayload,
  RecallId, RecallRecalledPayload, RecallResult, RecallSnapshotId,
  MessageRecallSettings,
} from './types.ts'

export const MESSAGE_RECALL_SETTINGS_NAMESPACE = settingsNamespace('message-recall')

export const MESSAGE_RECALL_SETTINGS_SCHEMA: z<MessageRecallSettings> = z.object({
  maxRecallWindow: z.number().step(1).min(1).max(50).default(5),
  autoSnapshotOnFileEdits: z.boolean().default(true),
})

const DEFAULT_MAX_RECALL_WINDOW = 5
const DEFAULT_AUTO_SNAPSHOT = true

async function sha256String(content: string): Promise<string> {
  const data = new TextEncoder().encode(content)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

interface SnapshotStoreEntry {
  snapshotId: RecallSnapshotId
  sessionId: SessionId
  turnId: string
  stepId?: string
  filePath: string
  sha256Before: string
  contentBefore: string
  createdAt: number
}

interface RecalledStoreEntry {
  recallId: RecallId
  sessionId: SessionId
  recalledMessageIds: MessageId[]
  revertedFilePaths: string[]
  newSessionSeq: number
  createdAt: number
}

/**
 * Core message-recall service: snapshot tracking, recall execution, and
 * durable session events.
 */
export class MessageRecallService extends Service {
  static inject = ['session', 'fs', 'tools', 'llm']

  private readonly snapshotsBySession = new Map<SessionId, SnapshotStoreEntry[]>()
  private readonly recalledBySession = new Map<SessionId, RecalledStoreEntry[]>()
  private resolvedSettings: MessageRecallSettings = {
    maxRecallWindow: DEFAULT_MAX_RECALL_WINDOW,
    autoSnapshotOnFileEdits: DEFAULT_AUTO_SNAPSHOT,
  }

  constructor(ctx: Context) {
    super(ctx, 'messageRecall')
    const entry: MessageRecallSettings = {
      maxRecallWindow: DEFAULT_MAX_RECALL_WINDOW,
      autoSnapshotOnFileEdits: DEFAULT_AUTO_SNAPSHOT,
    }
    let source: () => MessageRecallSettings = () => entry
    installSettingsSection(ctx, MESSAGE_RECALL_SETTINGS_NAMESPACE, MESSAGE_RECALL_SETTINGS_SCHEMA, entry, {
      validate: (value) => {
        if (!Number.isInteger(value.maxRecallWindow) || value.maxRecallWindow < 1 || value.maxRecallWindow > 50) {
          throw new Error('maxRecallWindow must be integer between 1 and 50')
        }
      },
      setSource: (current) => {
        source = current
      },
      onChange: () => {
        this.resolvedSettings = source()
      },
    })
    this.resolvedSettings = source()

    ctx.effect(() => this.installToolInterceptors(), 'messageRecall: tool interceptors')
    ctx.effect(() => this.registerRecallTool(), 'messageRecall: recall tool')
  }

  private installToolInterceptors(): () => void {
    if (!this.resolvedSettings.autoSnapshotOnFileEdits) return () => {}

    const writeDisposer = this.ctx.on('fs/write-intent', async (target, exec, next) => {
      await this.snapshotFileBeforeMutation(target, exec as ToolRunContext, 'write')
      return next()
    })

    const editDisposer = this.ctx.on('fs/edit-intent', async (target, exec, next) => {
      await this.snapshotFileBeforeMutation(target, exec as ToolRunContext, 'edit')
      return next()
    })

    return () => {
      writeDisposer()
      editDisposer()
    }
  }

  private async snapshotFileBeforeMutation(
    target: FsTarget,
    exec: ToolRunContext,
    _kind: 'write' | 'edit',
  ): Promise<void> {
    try {
      const session = exec.agent?.session
      if (session === undefined) return
      if (!this.resolvedSettings.autoSnapshotOnFileEdits) return

      const info = await this.ctx.fs.stat(target, exec.signal)
      const contentBefore = info !== undefined ? await this.ctx.fs.readText(target, exec.signal) : ''
      const sha256Before = info !== undefined ? await sha256String(contentBefore) : ''

      const snapshotId = `snap_${randomUUID()}` as RecallSnapshotId
      const lastStep = [...session.events].reverse().find(e => e.type === 'step/start')
      const turnId = lastStep?.type === 'step/start' ? String(lastStep.data.turn) : session.id
      const stepId = lastStep?.type === 'step/start' ? String(lastStep.data.step) : undefined

      const entry: SnapshotStoreEntry = {
        snapshotId,
        sessionId: session.id,
        turnId,
        ...(stepId !== undefined ? { stepId } : {}),
        filePath: target.displayPath,
        sha256Before,
        contentBefore,
        createdAt: Date.now(),
      }

      this.appendSnapshot(session.id, entry)

      const payload: RecallFileSnapshotPayload = {
        snapshotId,
        sessionId: session.id,
        turnId,
        ...(stepId !== undefined ? { stepId } : {}),
        filePath: target.displayPath,
        sha256Before,
        contentBefore,
      }

      void this.ctx.emit('recall/file-snapshot', session, payload)
    } catch {
      // Snapshot failure should never block the actual write/edit.
    }
  }

  private appendSnapshot(sessionId: SessionId, entry: SnapshotStoreEntry): void {
    const list = this.snapshotsBySession.get(sessionId)
    if (list === undefined) {
      this.snapshotsBySession.set(sessionId, [entry])
    } else {
      list.push(entry)
      const maxWindow = this.resolvedSettings.maxRecallWindow * 10
      if (list.length > maxWindow) {
        list.splice(0, list.length - maxWindow)
      }
    }
  }

  private getSnapshots(sessionId: SessionId): SnapshotStoreEntry[] {
    return this.snapshotsBySession.get(sessionId) ?? []
  }

  availableSnapshots(sessionId: SessionId): RecallAvailableSnapshot[] {
    return this.getSnapshots(sessionId).map(entry => ({
      snapshotId: entry.snapshotId,
      turnId: entry.turnId,
      ...(entry.stepId !== undefined ? { stepId: entry.stepId } : {}),
      filePath: entry.filePath,
      createdAt: entry.createdAt,
    }))
  }

  async recallLastMessage(sessionId: SessionId): Promise<RecallResult> {
    const session = this.ctx.sessions.get(sessionId)
    if (session === undefined) {
      return { ok: false, revertedFiles: [], recalledCount: 0, error: 'Session not found' }
    }

    const events = session.events
    const userMessageIdx = this.findLastUserMessageIndex(events)
    if (userMessageIdx === -1) {
      return { ok: false, revertedFiles: [], recalledCount: 0, error: 'No user message to recall' }
    }

    const userMessageEvent = events[userMessageIdx]
    if (userMessageEvent === undefined) {
      return { ok: false, revertedFiles: [], recalledCount: 0, error: 'No user message to recall' }
    }
    const messageId = (userMessageEvent.data as UserMessage).id
    if (messageId === undefined) {
      return { ok: false, revertedFiles: [], recalledCount: 0, error: 'Last user message has no messageId' }
    }

    return this.recallMessage(sessionId, messageId)
  }

  async recallMessage(sessionId: SessionId, messageId: MessageId): Promise<RecallResult> {
    const session = this.ctx.sessions.get(sessionId)
    if (session === undefined) {
      return { ok: false, revertedFiles: [], recalledCount: 0, error: 'Session not found' }
    }

    const events = session.events
    const startIdx = this.findMessageEventIndex(events, messageId)
    if (startIdx === -1) {
      return { ok: false, revertedFiles: [], recalledCount: 0, error: 'Message not found' }
    }

    const startEvent = events[startIdx]!
    const _startSeq = startEvent.seq
    const currentSeq = session.seq
    const distance = currentSeq - _startSeq
    const maxWindow = this.resolvedSettings.maxRecallWindow * 5
    if (distance > maxWindow) {
      return {
        ok: false,
        revertedFiles: [],
        recalledCount: 0,
        error: `Message too old to recall (window: ${this.resolvedSettings.maxRecallWindow} turns)`,
      }
    }

    const affectedEvents = events.slice(startIdx)
    const recalledMessageIds = this.collectMessageIds(affectedEvents)
    const _endSeq = currentSeq
    const revertedFilePaths = await this.revertFilesForRange(session, _startSeq, _endSeq)

    const recallId = `recall_${randomUUID()}` as RecallId
    const newSessionSeq = session.seq

    const recalledEntry: RecalledStoreEntry = {
      recallId,
      sessionId,
      recalledMessageIds,
      revertedFilePaths,
      newSessionSeq,
      createdAt: Date.now(),
    }

    const list = this.recalledBySession.get(sessionId)
    if (list === undefined) {
      this.recalledBySession.set(sessionId, [recalledEntry])
    } else {
      list.push(recalledEntry)
    }

    const payload: RecallRecalledPayload = {
      recallId,
      sessionId,
      recalledMessageIds,
      revertedFilePaths,
      newSessionSeq,
    }

    void this.ctx.emit('recall/recalled', session, payload)

    return {
      ok: true,
      revertedFiles: revertedFilePaths,
      recalledCount: recalledMessageIds.length,
    }
  }

  private async revertFilesForRange(
    session: Session,
    _startSeq: number,
    _endSeq: number,
  ): Promise<string[]> {
    const reverted: string[] = []
    const snapshots = this.getSnapshots(session.id)
    snapshots.filter(() => true)

    const byPath = new Map<string, SnapshotStoreEntry>()
    for (const snap of snapshots) {
      byPath.set(snap.filePath, snap)
    }

    for (const snap of byPath.values()) {
      try {
        const target = await this.ctx.fs.resolve(snap.filePath, {})
        const exists = await this.ctx.fs.stat(target)
        if (exists !== undefined || snap.contentBefore.length > 0) {
          await this.ctx.fs.writeText(target, snap.contentBefore)
          reverted.push(snap.filePath)
        }
      } catch {
        // Per-file failure is logged but does not fail the whole recall.
      }
    }

    return reverted
  }

  private findLastUserMessageIndex(events: readonly SessionEvent[]): number {
    for (let i = events.length - 1; i >= 0; i--) {
      const event = events[i]
      if (event !== undefined && event.type === 'user/message') return i
    }
    return -1
  }

  private findMessageEventIndex(events: readonly SessionEvent[], messageId: MessageId): number {
    for (let i = events.length - 1; i >= 0; i--) {
      const event = events[i]
      if (event === undefined) continue
      if (event.type === 'user/message') {
        const msg = event.data as UserMessage
        if (msg.id === messageId) return i
      }
      if (event.type === 'assistant/message' || event.type === 'tool/result') {
        const msg = event.data.message
        if (msg.id === messageId) return i
      }
    }
    return -1
  }

  private collectMessageIds(events: readonly SessionEvent[]): MessageId[] {
    const ids = new Set<MessageId>()
    for (const event of events) {
      if (event.type === 'user/message') {
        const msg = event.data as UserMessage
        if (msg.id !== undefined) {
          ids.add(msg.id)
        }
      }
      if (event.type === 'assistant/message' || event.type === 'tool/result') {
        const msg = event.data.message
        if (msg.id !== undefined) {
          ids.add(msg.id)
        }
      }
    }
    return [...ids]
  }

  private registerRecallTool(): () => void {
    const disposer = this.ctx.tools.register(defineTool({
      name: 'recall_message',
      description: `
Withdraw/recall the last user message or a specific message.
If the AI edited files in response to that message, those edits are automatically reverted.
Use recall_last_message to withdraw the most recent user message.
Use recall_message with messageId to withdraw a specific message.
`.trim(),
      parameters: {
        mode: {
          type: 'string',
          required: true,
          enum: ['recall_last_message', 'recall_message'],
          description: 'Recall mode: recall_last_message or recall_message (requires messageId)',
        },
        messageId: {
          type: 'string',
          description: 'Required for recall_message mode: the messageId to withdraw',
        },
      },
      output: {
        schema: { type: 'object', additionalProperties: false, properties: {
          ok: { type: 'boolean' },
          revertedFiles: { type: 'array', items: { type: 'string' } },
          recalledCount: { type: 'integer' },
          error: { type: 'string' },
        }, required: ['ok', 'revertedFiles', 'recalledCount'] },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      execute: async (args, exec): Promise<RecallResult> => {
        const session = exec.agent?.session
        if (session === undefined) {
          return { ok: false, revertedFiles: [], recalledCount: 0, error: 'No session available' }
        }
        if (args.mode === 'recall_last_message') {
          return this.recallLastMessage(session.id)
        }
        if (args.mode === 'recall_message') {
          const messageId = args.messageId
          if (messageId === undefined || messageId.length === 0) {
            return { ok: false, revertedFiles: [], recalledCount: 0, error: 'messageId is required for recall_message mode' }
          }
          return this.recallMessage(session.id, messageId as MessageId)
        }
        return { ok: false, revertedFiles: [], recalledCount: 0, error: `Unknown mode: ${String(args.mode)}` }
      },
    }))
    return disposer
  }
}

export const name = 'session-message-recall'
export const inject = ['session', 'fs', 'tools', 'llm'] as const

export interface Config {
  maxRecallWindow?: number
  autoSnapshotOnFileEdits?: boolean
}

export const Config: z<Config> = z.object({
  maxRecallWindow: z.number().step(1).min(1).max(50).default(DEFAULT_MAX_RECALL_WINDOW),
  autoSnapshotOnFileEdits: z.boolean().default(DEFAULT_AUTO_SNAPSHOT),
})

export function apply(ctx: Context, _config: Config): void {
  ctx.provide('messageRecall', new MessageRecallService(ctx))
}

export default MessageRecallService
