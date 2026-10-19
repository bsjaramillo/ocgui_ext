import * as vscode from "vscode"
import type { EditorContext } from "../protocol"

export function getEditorContext(): EditorContext | undefined {
  const editor = vscode.window.activeTextEditor
  if (!editor) return undefined
  const doc = editor.document
  if (doc.uri.scheme !== "file") return undefined

  const folder = vscode.workspace.getWorkspaceFolder(doc.uri)
  if (!folder) return undefined

  const relativePath = vscode.workspace.asRelativePath(doc.uri, false)
  const sel = editor.selection
  const hasSelection = !sel.isEmpty
  const startLine = (hasSelection ? sel.start.line : sel.active.line) + 1
  const endLine = (hasSelection ? sel.end.line : sel.active.line) + 1
  const selectedText = hasSelection ? doc.getText(sel) : ""

  return {
    filePath: doc.uri.fsPath,
    relativePath,
    languageId: doc.languageId,
    line: sel.active.line + 1,
    startLine,
    endLine,
    hasSelection,
    selectedText,
  }
}

export function formatReference(ctx: EditorContext): string {
  if (ctx.startLine === ctx.endLine) return `@${ctx.relativePath}#L${ctx.startLine}`
  return `@${ctx.relativePath}#L${ctx.startLine}-${ctx.endLine}`
}
