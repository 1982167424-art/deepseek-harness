/**
 * Per-message recall controls: a "撤回" (Recall) button on user messages.
 * @module @deepseek-ai/dsh-session-message-recall/client/MessageRecallActions
 */

import { useCallback, useState } from 'react'
import {
  ConfirmDialog, IconUndoOutline16, Tooltip, useToast,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { MessageRecallActionProps } from './slots.ts'

export function MessageRecallActions({
  sessionId, messageId, role, canRecall, recallMessage, useRecallState, t,
}: MessageRecallActionProps & {
  useRecallState: HostObservable<unknown>
  role: string
}) {
  const toast = useToast()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [pending, setPending] = useState(false)

  if (role !== 'user') return null

  const available = canRecall(sessionId, messageId)

  const handleRecall = useCallback(async () => {
    setPending(true)
    try {
      const result = await recallMessage(sessionId, messageId)
      if (result.ok) {
        toast({
          variant: 'success',
          title: t('recallSuccess'),
          description: result.revertedFiles.length > 0
            ? `${t('filesRestoredLabel')}: ${result.revertedFiles.length}`
            : undefined,
        })
      } else {
        toast({
          variant: 'error',
          title: t('recallFailed'),
          description: result.error ?? t('error.generic'),
        })
      }
    } finally {
      setPending(false)
      setConfirmOpen(false)
    }
  }, [sessionId, messageId, recallMessage, toast, t])

  return (
    <>
      <Tooltip label={t('recallMessage')} side="bottom">
        <button
          type="button"
          aria-label={t('recallMessage')}
          disabled={!available || pending}
          onClick={() => { setConfirmOpen(true) }}
        >
          <IconUndoOutline16 />
        </button>
      </Tooltip>
      <ConfirmDialog
        open={confirmOpen}
        title={t('confirmRecallTitle')}
        body={t('confirmRecallBody')}
        confirmLabel={t('recallMessage')}
        cancelLabel="取消"
        onCancel={() => { setConfirmOpen(false) }}
        onConfirm={handleRecall}
        pending={pending}
      />
    </>
  )
}
