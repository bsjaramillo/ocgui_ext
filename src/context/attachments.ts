import * as path from "path"
import { pathToFileURL } from "url"
import * as vscode from "vscode"
import type { Attachment } from "../protocol"

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".json": "application/json",
  ".jsonc": "application/json",
  ".xml": "application/xml",
  ".html": "text/html",
  ".htm": "text/html",
  ".css": "text/css",
  ".csv": "text/csv",
  ".md": "text/markdown",
  ".yaml": "text/yaml",
  ".yml": "text/yaml",
  ".toml": "text/plain",
  ".txt": "text/plain",
  ".log": "text/plain",
}

export function mimeForPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  return MIME_BY_EXT[ext] ?? "text/plain"
}

export function toAttachment(uri: vscode.Uri): Attachment {
  const fsPath = uri.fsPath
  const relative = vscode.workspace.asRelativePath(uri, false)
  return {
    url: pathToFileURL(fsPath).toString(),
    filename: relative || path.basename(fsPath),
    mime: mimeForPath(fsPath),
  }
}
