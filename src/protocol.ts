export interface EditorContext {
  filePath: string
  relativePath: string
  languageId: string
  line: number
  startLine: number
  endLine: number
  hasSelection: boolean
  selectedText: string
}

export interface ModelOption {
  id: string
  name: string
  providerID: string
  modelID: string
  context?: number
}

export interface SessionSummary {
  id: string
  title: string
  updated: number
}

export interface ChatMessage {
  info: any
  parts: any[]
}

export interface FileDiffInfo {
  file: string
  before: string
  after: string
  additions: number
  deletions: number
}

export interface Attachment {
  url: string
  filename: string
  mime: string
}

export interface FormOption {
  value: string
  label: string
  description?: string
}

export interface FormField {
  key: string
  type: string
  title?: string
  description?: string
  required?: boolean
  hidden?: boolean
  placeholder?: string
  default?: unknown
  options?: FormOption[]
  custom?: boolean
  minimum?: number
  maximum?: number
  url?: string
}

export interface FormInfo {
  id: string
  sessionID: string
  title: string
  fields: FormField[]
}

export type ServerStatus = "starting" | "ready" | "error"

export type ServerMessage =
  | { type: "status"; status: ServerStatus; message?: string }
  | {
      type: "init"
      sessionId: string | null
      sessions: SessionSummary[]
      agents: string[]
      models: ModelOption[]
      messages: ChatMessage[]
      context?: EditorContext
      model?: string
      agent?: string
    }
  | { type: "session"; sessionId: string | null; messages: ChatMessage[]; sessions: SessionSummary[] }
  | { type: "messages"; messages: ChatMessage[] }
  | { type: "sessions"; sessions: SessionSummary[] }
  | { type: "diffs"; diffs: FileDiffInfo[] }
  | { type: "forms"; forms: FormInfo[] }
  | { type: "event"; event: any }
  | { type: "context"; context?: EditorContext }
  | { type: "busy"; busy: boolean }
  | { type: "prefill"; text: string }
  | { type: "attachments"; files: Attachment[] }
  | { type: "error"; message: string }

export type ClientMessage =
  | { type: "ready" }
  | { type: "send"; text: string; includeContext: boolean; files?: Attachment[] }
  | { type: "pickFiles" }
  | { type: "abort" }
  | { type: "newSession" }
  | { type: "switchSession"; sessionId: string }
  | { type: "deleteSession"; sessionId: string }
  | { type: "renameSession"; sessionId: string; currentTitle?: string }
  | { type: "refreshDiffs" }
  | { type: "openDiff"; file: string }
  | { type: "revert"; messageId: string }
  | { type: "unrevert" }
  | { type: "permission"; permissionId: string; response: "once" | "always" | "reject" }
  | { type: "replyForm"; formId: string; answer: Record<string, unknown> }
  | { type: "cancelForm"; formId: string }
  | { type: "openExternal"; url: string }
  | { type: "setModel"; model: string }
  | { type: "setAgent"; agent: string }
  | { type: "insertCode"; text: string }
  | { type: "openFile"; path: string; line?: number }
  | { type: "restart" }
