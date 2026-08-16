/**
 * Dictionary for the task board plugin: one namespace, two languages.
 * @module @deepseek-ai/dsh-client-ui-task-board/client/locales
 */

/** Every key the task board namespace owns. */
export type TaskBoardKey =
  | 'title'
  | 'open'
  | 'close'
  | 'search'
  | 'kind.all'
  | 'kind.agent'
  | 'kind.manual'
  | 'kind.agent.short'
  | 'kind.manual.short'
  | 'column.initialized'
  | 'column.running'
  | 'column.review'
  | 'column.completed'
  | 'column.failed'
  | 'column.empty'
  | 'card.attempts'
  | 'create'
  | 'create.heading'
  | 'create.startNow'
  | 'create.submit'
  | 'create.cancel'
  | 'field.title'
  | 'field.requirements'
  | 'field.acceptanceCriteria'
  | 'field.workspace'
  | 'field.agentPreset'
  | 'field.referenceImages'
  | 'detail.heading'
  | 'detail.attempts'
  | 'detail.revision'
  | 'detail.created'
  | 'detail.updated'
  | 'detail.activity'
  | 'detail.activity.empty'
  | 'action.start'
  | 'action.stop'
  | 'action.submit'
  | 'action.approve'
  | 'action.reject'
  | 'action.fail'
  | 'action.retry'
  | 'action.reopen'
  | 'action.remove'
  | 'action.remove.confirm'
  | 'event.created'
  | 'event.edited'
  | 'event.moved'
  | 'event.start'
  | 'event.stop'
  | 'event.submit'
  | 'event.approve'
  | 'event.reject'
  | 'event.fail'
  | 'event.retry'
  | 'event.reopen'
  | 'error.generic'
  | 'error.revision-conflict'
  | 'error.task-not-found'
  | 'error.invalid-transition'
  | 'error.board-full'
  | 'error.text-blank'
  | 'error.field-too-long'
  | 'error.reference-images-too-many'
  | 'error.move-target-invalid'
  | 'error.disposed'
  | 'error.transport'
  | 'load.failed'

/** The failure keys this namespace owns, for runtime code→key mapping. */
export const ERROR_KEYS: readonly TaskBoardKey[] = [
  'error.generic',
  'error.revision-conflict',
  'error.task-not-found',
  'error.invalid-transition',
  'error.board-full',
  'error.text-blank',
  'error.field-too-long',
  'error.reference-images-too-many',
  'error.move-target-invalid',
  'error.disposed',
  'error.transport',
]

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The task board overlay, drawer, and opener copy. */
    taskBoard: TaskBoardKey
  }
}

/** English dictionary. */
export const en: Record<TaskBoardKey, string> = {
  'title': 'Task Board',
  'open': 'Open task board',
  'close': 'Close task board',
  'search': 'Search tasks',
  'kind.all': 'All kinds',
  'kind.agent': 'Agent task',
  'kind.manual': 'Manual task',
  'kind.agent.short': 'agent',
  'kind.manual.short': 'manual',
  'column.initialized': 'Initialized',
  'column.running': 'Running',
  'column.review': 'In review',
  'column.completed': 'Completed',
  'column.failed': 'Failed',
  'column.empty': 'No tasks',
  'card.attempts': '{count} attempt(s)',
  'create': 'New task',
  'create.heading': 'Create task',
  'create.startNow': 'Start immediately',
  'create.submit': 'Create',
  'create.cancel': 'Cancel',
  'field.title': 'Title',
  'field.requirements': 'Requirements',
  'field.acceptanceCriteria': 'Acceptance criteria (optional)',
  'field.workspace': 'Workspace directory (optional)',
  'field.agentPreset': 'Agent preset (optional)',
  'field.referenceImages': 'Reference images, one per line (optional)',
  'detail.heading': 'Task detail',
  'detail.attempts': 'Attempts',
  'detail.revision': 'Revision',
  'detail.created': 'Created',
  'detail.updated': 'Updated',
  'detail.activity': 'Activity',
  'detail.activity.empty': 'No activity yet',
  'action.start': 'Start',
  'action.stop': 'Stop',
  'action.submit': 'Submit for review',
  'action.approve': 'Approve',
  'action.reject': 'Reject — continue revision',
  'action.fail': 'Mark failed',
  'action.retry': 'Retry',
  'action.reopen': 'Reopen',
  'action.remove': 'Delete',
  'action.remove.confirm': 'Delete this task and its activity log?',
  'event.created': 'Created',
  'event.edited': 'Edited',
  'event.moved': 'Reordered',
  'event.start': 'Started',
  'event.stop': 'Stopped',
  'event.submit': 'Submitted for review',
  'event.approve': 'Approved',
  'event.reject': 'Rejected — revision continues',
  'event.fail': 'Failed',
  'event.retry': 'Retried',
  'event.reopen': 'Reopened',
  'error.generic': 'The operation failed',
  'error.revision-conflict': 'The task changed elsewhere; showing the current card',
  'error.task-not-found': 'The task no longer exists',
  'error.invalid-transition': 'The task cannot take that action in its current state',
  'error.board-full': 'The board is full',
  'error.text-blank': 'A required field is empty',
  'error.field-too-long': 'A field is too long',
  'error.reference-images-too-many': 'Too many reference images',
  'error.move-target-invalid': 'That drop target is in another column',
  'error.disposed': 'The task board is shutting down',
  'error.transport': 'The connection failed',
  'load.failed': 'The board failed to load',
}

/** Chinese dictionary. */
export const zh: Record<TaskBoardKey, string> = {
  'title': '任务看板',
  'open': '打开任务看板',
  'close': '关闭任务看板',
  'search': '搜索任务',
  'kind.all': '全部类型',
  'kind.agent': 'Agent 任务',
  'kind.manual': '手动任务',
  'kind.agent.short': 'agent',
  'kind.manual.short': '手动',
  'column.initialized': '初始化',
  'column.running': '执行中',
  'column.review': '待审核',
  'column.completed': '已完成',
  'column.failed': '失败',
  'column.empty': '暂无任务',
  'card.attempts': '{count} 次尝试',
  'create': '新建任务',
  'create.heading': '创建任务',
  'create.startNow': '创建后立即启动',
  'create.submit': '创建',
  'create.cancel': '取消',
  'field.title': '标题',
  'field.requirements': '任务要求',
  'field.acceptanceCriteria': '验收标准（可选）',
  'field.workspace': '工作目录（可选）',
  'field.agentPreset': 'Agent 预设（可选）',
  'field.referenceImages': '参考图片，每行一个（可选）',
  'detail.heading': '任务详情',
  'detail.attempts': '尝试次数',
  'detail.revision': '修订版本',
  'detail.created': '创建时间',
  'detail.updated': '更新时间',
  'detail.activity': '活动记录',
  'detail.activity.empty': '暂无活动',
  'action.start': '启动',
  'action.stop': '停止',
  'action.submit': '提交审核',
  'action.approve': '审核通过',
  'action.reject': '驳回，继续修订',
  'action.fail': '标记失败',
  'action.retry': '重试',
  'action.reopen': '重新打开',
  'action.remove': '删除',
  'action.remove.confirm': '删除该任务及其活动记录？',
  'event.created': '已创建',
  'event.edited': '已编辑',
  'event.moved': '已排序',
  'event.start': '已启动',
  'event.stop': '已停止',
  'event.submit': '已提交审核',
  'event.approve': '审核通过',
  'event.reject': '已驳回，继续修订',
  'event.fail': '执行失败',
  'event.retry': '已重试',
  'event.reopen': '已重新打开',
  'error.generic': '操作失败',
  'error.revision-conflict': '任务已在别处修改，已显示当前卡片',
  'error.task-not-found': '任务已不存在',
  'error.invalid-transition': '当前状态不能执行该操作',
  'error.board-full': '看板已满',
  'error.text-blank': '必填字段为空',
  'error.field-too-long': '字段过长',
  'error.reference-images-too-many': '参考图片过多',
  'error.move-target-invalid': '放置目标在另一列',
  'error.disposed': '任务看板正在关闭',
  'error.transport': '连接失败',
  'load.failed': '看板加载失败',
}
