import { randomBytes } from "node:crypto"
import { spawn, type ChildProcess } from "node:child_process"
import { OpenCodeApi } from "./api"

export interface ServerStartOptions {
  hostname: string
  port: number
  reuse: boolean
  opencodePath: string
  cwd?: string
}

export interface CliInfo {
  installed: boolean
  version?: string
  major?: number
  raw?: string
  error?: string
}

function randomPort(): number {
  return Math.floor(Math.random() * (65535 - 16384 + 1)) + 16384
}

function randomPassword(): string {
  return randomBytes(32).toString("base64url")
}

export function detectOpenCodeCli(command: string, cwd?: string): Promise<CliInfo> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (info: CliInfo): void => {
      if (settled) return
      settled = true
      resolve(info)
    }

    let proc: ChildProcess
    try {
      proc = spawn(command, ["--version"], { cwd, shell: true, windowsHide: true })
    } catch (err: any) {
      finish({ installed: false, error: String(err?.message ?? err) })
      return
    }

    let out = ""
    proc.stdout?.on("data", (d) => (out += String(d)))
    proc.stderr?.on("data", (d) => (out += String(d)))
    proc.on("error", (err) => finish({ installed: false, error: err.message }))
    proc.on("exit", (code) => {
      const raw = out.trim()
      if (code !== 0) {
        finish({ installed: false, raw, error: raw || `exited with code ${code}` })
        return
      }
      const match = raw.match(/(\d+)\.(\d+)\.(\d+)/)
      finish({
        installed: true,
        raw,
        version: match ? match[0] : undefined,
        major: match ? Number(match[1]) : undefined,
      })
    })

    setTimeout(() => {
      try {
        proc.kill()
      } catch {
        // ignore
      }
      finish({ installed: false, error: "timed out while checking the CLI" })
    }, 8000)
  })
}

export class ServerManager {
  private proc?: ChildProcess
  private _api?: OpenCodeApi
  private _url = ""
  private _password = ""
  private logs: string[] = []
  private listening = false

  get url(): string {
    return this._url
  }

  get api(): OpenCodeApi {
    if (!this._api) throw new Error("OpenCode server is not started")
    return this._api
  }

  async start(opts: ServerStartOptions): Promise<void> {
    if (opts.reuse) {
      const candidates = opts.port ? [opts.port] : [4096]
      for (const p of candidates) {
        const url = `http://${opts.hostname}:${p}`
        const api = new OpenCodeApi({ baseUrl: url })
        if (await api.ready()) {
          this._url = url
          this._password = ""
          this._api = api
          return
        }
      }
    }

    const port = opts.port || randomPort()
    const url = `http://${opts.hostname}:${port}`
    const password = randomPassword()
    this.logs = []
    this.listening = false
    this.spawnServer(opts.opencodePath, opts.hostname, port, password, opts.cwd)

    const api = new OpenCodeApi({ baseUrl: url, password })
    const ready = await this.waitForReady(api, 30000)
    if (!ready.ok) {
      this.stop()
      throw new Error(
        `OpenCode server did not start on ${url}.\nProbe: ${ready.detail}\n${this.logTail()}`,
      )
    }

    this._url = url
    this._password = password
    this._api = api
  }

  stop(): void {
    if (this.proc && this.proc.exitCode === null) {
      try {
        this.proc.kill()
      } catch {
        // ignore
      }
    }
    this.proc = undefined
    this._api = undefined
    this._url = ""
    this._password = ""
  }

  private spawnServer(
    command: string,
    hostname: string,
    port: number,
    password: string,
    cwd?: string,
  ): void {
    this.proc = spawn(command, ["serve", "--hostname", hostname, "--port", String(port)], {
      cwd,
      shell: true,
      windowsHide: true,
      env: { ...process.env, OPENCODE_SERVER_PASSWORD: password },
    })
    this.proc.stdout?.on("data", (d) => this.pushLog(String(d)))
    this.proc.stderr?.on("data", (d) => this.pushLog(String(d)))
    this.proc.on("error", (err) => this.pushLog(`[spawn error] ${err.message}`))
    this.proc.on("exit", (code) => this.pushLog(`[server exited with code ${code}]`))
  }

  private async waitForReady(
    api: OpenCodeApi,
    timeoutMs: number,
  ): Promise<{ ok: boolean; detail: string }> {
    const start = Date.now()
    let detail = "no response"
    while (Date.now() - start < timeoutMs) {
      const probe = await api.probe()
      if (probe.ok) return { ok: true, detail: "ok" }
      detail = probe.detail
      if (this.proc && this.proc.exitCode !== null) return { ok: false, detail }
      // Safety net: the server announced it is listening but the HTTP probe
      // keeps failing (e.g. extension-host networking quirks). Proceed anyway.
      if (this.listening && Date.now() - start > 5000) {
        return { ok: true, detail: `listening (probe: ${detail})` }
      }
      await new Promise((r) => setTimeout(r, 300))
    }
    return { ok: false, detail }
  }

  private pushLog(line: string): void {
    if (/server listening on/i.test(line)) this.listening = true
    this.logs.push(line)
    if (this.logs.length > 200) this.logs.shift()
  }

  private logTail(): string {
    return this.logs.slice(-20).join("").trim()
  }
}
