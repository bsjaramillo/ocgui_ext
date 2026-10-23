// @ts-check
(function () {
  const vscode = acquireVsCodeApi()
  const persisted = vscode.getState() || {}

  const state = {
    sessionId: null,
    sessions: [],
    agents: [],
    models: [],
    messages: [],
    diffs: [],
    forms: [],
    context: undefined,
    includeContext: true,
    busy: false,
    status: "starting",
    permissions: [],
    model: "",
    attachments: [],
    showThinking: persisted.showThinking === true,
  }

  const els = {
    sessionSelect: document.getElementById("session-select"),
    agentSelect: document.getElementById("agent-select"),
    modelSelect: document.getElementById("model-select"),
    newSession: document.getElementById("new-session"),
    renameSession: document.getElementById("rename-session"),
    deleteSession: document.getElementById("delete-session"),
    restart: document.getElementById("restart"),
    usage: document.getElementById("usage"),
    thinking: document.getElementById("thinking"),
    thinkingLabel: document.getElementById("thinking-label"),
    thinkingToggle: document.getElementById("thinking-toggle"),
    changesToggle: document.getElementById("changes-toggle"),
    changesCount: document.getElementById("changes-count"),
    changes: document.getElementById("changes"),
    changesList: document.getElementById("changes-list"),
    changesRefresh: document.getElementById("changes-refresh"),
    unrevert: document.getElementById("unrevert"),
    contextBar: document.getElementById("context-bar"),
    contextLabel: document.getElementById("context-label"),
    includeContext: document.getElementById("include-context"),
    messages: document.getElementById("messages"),
    status: document.getElementById("status"),
    input: document.getElementById("input"),
    attach: document.getElementById("attach"),
    attachments: document.getElementById("attachments"),
    send: document.getElementById("send"),
    stop: document.getElementById("stop"),
  }

  window.addEventListener("message", (e) => handle(e.data))
  vscode.postMessage({ type: "ready" })

  function handle(msg) {
    switch (msg.type) {
      case "status":
        state.status = msg.status
        renderStatus(msg.message)
        break
      case "init":
        state.sessionId = msg.sessionId
        state.sessions = msg.sessions || []
        state.agents = msg.agents || []
        state.models = msg.models || []
        state.context = msg.context
        state.model = msg.model || ""
        state.messages = (msg.messages || []).map(normalize)
        renderSessions()
        renderAgents()
        renderModels()
        restoreSelection(msg)
        renderContext()
        renderThinkingToggle()
        renderMessages(true)
        break
      case "session":
        state.sessionId = msg.sessionId
        state.sessions = msg.sessions || []
        state.messages = (msg.messages || []).map(normalize)
        state.attachments = []
        state.forms = []
        els.messages.querySelectorAll(".form-card").forEach((el) => el.remove())
        renderAttachments()
        renderSessions()
        renderMessages(true)
        break
      case "messages":
        state.messages = (msg.messages || []).map(normalize)
        renderMessages(false)
        break
      case "sessions":
        state.sessions = msg.sessions || []
        renderSessions()
        break
      case "diffs":
        state.diffs = msg.diffs || []
        renderDiffs()
        break
      case "forms":
        state.forms = msg.forms || []
        renderForms()
        break
      case "context":
        state.context = msg.context
        renderContext()
        break
      case "busy":
        state.busy = msg.busy
        renderBusy()
        break
      case "prefill":
        els.input.value = msg.text
        els.input.focus()
        autoGrow()
        break
      case "attachments":
        addAttachments(msg.files || [])
        break
      case "error":
        renderError(msg.message)
        break
      case "event":
        handleEvent(msg.event)
        break
    }
  }

  function normalize(m) {
    return { info: m.info, parts: (m.parts || []).slice() }
  }

  function handleEvent(event) {
    const props = event && event.properties ? event.properties : {}
    switch (event.type) {
      case "message.updated":
        if (props.info) upsertMessage(props.info)
        break
      case "message.part.updated":
        if (props.part) upsertPart(props.part)
        break
      case "message.part.removed":
        removePart(props.messageID, props.partID)
        break
      case "permission.updated":
        addPermission(props)
        break
      case "permission.replied":
        removePermission(props.permissionID)
        break
    }
  }

  function getMessage(id) {
    return state.messages.find((m) => m.info && m.info.id === id)
  }

  function upsertMessage(info) {
    const existing = getMessage(info.id)
    if (existing) {
      existing.info = info
    } else {
      state.messages.push({ info, parts: [] })
    }
    renderMessage(info.id)
  }

  function upsertPart(part) {
    let msg = getMessage(part.messageID)
    if (!msg) {
      upsertMessage({ id: part.messageID, role: part.type === "text" ? "assistant" : "assistant" })
      msg = getMessage(part.messageID)
    }
    if (!msg) return
    const idx = msg.parts.findIndex((p) => p.id === part.id)
    if (idx >= 0) msg.parts[idx] = part
    else msg.parts.push(part)
    renderMessage(msg.info.id)
  }

  function removePart(messageID, partID) {
    const msg = getMessage(messageID)
    if (!msg) return
    msg.parts = msg.parts.filter((p) => p.id !== partID)
    renderMessage(messageID)
  }

  // ---- rendering ----

  function renderMessages(force) {
    const ids = new Set()
    for (const msg of state.messages) {
      if (!msg.info) continue
      ids.add("msg-" + msg.info.id)
      renderMessage(msg.info.id)
    }
    els.messages.querySelectorAll(".msg").forEach((el) => {
      if (!ids.has(el.id)) el.remove()
    })
    for (const msg of state.messages) {
      if (!msg.info) continue
      const el = document.getElementById("msg-" + msg.info.id)
      if (el) els.messages.appendChild(el)
    }
    const empty = els.messages.querySelector(".empty")
    if (state.messages.length === 0) {
      if (!empty) {
        const e = document.createElement("div")
        e.className = "empty"
        e.textContent = "Start a conversation with OpenCode."
        els.messages.appendChild(e)
      }
    } else if (empty) {
      empty.remove()
    }
    for (const perm of state.permissions) {
      let el = document.getElementById("perm-" + perm.id)
      if (!el) {
        renderPermissionCard(perm)
        el = document.getElementById("perm-" + perm.id)
      }
      if (el) els.messages.appendChild(el)
    }
    for (const form of state.forms) {
      const el = document.getElementById("form-" + form.id)
      if (el) els.messages.appendChild(el)
    }
    scrollToBottom(!!force)
  }

  function renderMessage(id) {
    const msg = getMessage(id)
    if (!msg || !msg.info) return
    let el = document.getElementById("msg-" + id)
    if (!el) {
      el = document.createElement("div")
      el.id = "msg-" + id
      el.className = "msg " + (msg.info.role === "user" ? "user" : "assistant")
      const role = document.createElement("div")
      role.className = "msg-role"
      const roleText = document.createElement("span")
      roleText.textContent = msg.info.role === "user" ? "You" : "OpenCode"
      role.appendChild(roleText)
      if (msg.info.role === "user") {
        const rev = document.createElement("button")
        rev.className = "revert-btn"
        rev.title = "Revert to before this message"
        rev.textContent = "↶"
        rev.addEventListener("click", () => vscode.postMessage({ type: "revert", messageId: id }))
        role.appendChild(rev)
      }
      const bubble = document.createElement("div")
      bubble.className = "bubble"
      const meta = document.createElement("div")
      meta.className = "msg-meta"
      el.appendChild(role)
      el.appendChild(bubble)
      el.appendChild(meta)
      const empty = els.messages.querySelector(".empty")
      if (empty) empty.remove()
      els.messages.appendChild(el)
    }
    const bubble = el.querySelector(".bubble")
    bubble.innerHTML = renderParts(msg)
    attachCodeActions(bubble)
    const meta = el.querySelector(".msg-meta")
    if (meta) meta.textContent = msg.info.role === "assistant" ? messageMeta(msg.info) : ""
    renderUsage()
    scrollToBottom(false)
  }

  function messageMeta(info) {
    const bits = []
    if (typeof info.cost === "number" && info.cost > 0) bits.push("$" + info.cost.toFixed(4))
    const t = info.tokens
    if (t && (t.input || t.output)) {
      bits.push("↑" + fmt(t.input || 0) + " ↓" + fmt(t.output || 0))
    }
    if (info.modelID) bits.push(info.modelID)
    return bits.join(" · ")
  }

  function computeUsage() {
    const total = { cost: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }
    let last = null
    for (const m of state.messages) {
      if (m.info && m.info.role === "assistant") {
        total.cost += m.info.cost || 0
        const t = m.info.tokens || {}
        total.input += t.input || 0
        total.output += t.output || 0
        total.reasoning += t.reasoning || 0
        if (t.cache) {
          total.cacheRead += t.cache.read || 0
          total.cacheWrite += t.cache.write || 0
        }
        last = m.info
      }
    }
    let contextUsed = 0
    if (last && last.tokens) {
      const t = last.tokens
      contextUsed =
        (t.input || 0) + (t.output || 0) + (t.cache?.read || 0) + (t.cache?.write || 0)
    }
    return { total, contextUsed }
  }

  function renderUsage() {
    if (!els.usage) return
    const { total, contextUsed } = computeUsage()
    if (!total.input && !total.output && !total.cost) {
      els.usage.textContent = "No usage yet"
      els.usage.title = ""
      return
    }
    const parts = ["$" + total.cost.toFixed(4), "↑" + fmt(total.input), "↓" + fmt(total.output)]
    if (total.reasoning) parts.push("🧠" + fmt(total.reasoning))
    if (total.cacheRead) parts.push("⚡" + fmt(total.cacheRead))
    const limit = modelContextLimit()
    if (limit && contextUsed) parts.push(Math.round((contextUsed / limit) * 100) + "% ctx")
    els.usage.textContent = parts.join("  ")
    els.usage.title =
      "Session usage\ncost: $" +
      total.cost.toFixed(4) +
      "\ninput: " +
      total.input +
      "\noutput: " +
      total.output +
      "\nreasoning: " +
      total.reasoning +
      "\ncache read: " +
      total.cacheRead +
      "\ncache write: " +
      total.cacheWrite +
      (limit ? "\ncontext: " + contextUsed + " / " + limit : "")
  }

  function modelContextLimit() {
    const id = state.model || els.modelSelect.value
    const m = state.models.find((x) => x.id === id)
    return m && m.context ? m.context : 0
  }

  function renderDiffs() {
    const n = state.diffs.length
    els.changesCount.textContent = String(n)
    els.changesToggle.classList.toggle("has-changes", n > 0)
    if (els.changes.classList.contains("hidden")) return
    els.changesList.innerHTML = ""
    if (n === 0) {
      const empty = document.createElement("div")
      empty.className = "empty"
      empty.textContent = "No file changes in this session."
      els.changesList.appendChild(empty)
      return
    }
    for (const d of state.diffs) {
      const row = document.createElement("div")
      row.className = "change-row"
      row.title = d.file
      const name = document.createElement("span")
      name.className = "change-file"
      name.textContent = d.file
      const stats = document.createElement("span")
      stats.className = "change-stats"
      stats.innerHTML =
        '<span class="add">+' + d.additions + '</span><span class="del">-' + d.deletions + "</span>"
      row.appendChild(name)
      row.appendChild(stats)
      row.addEventListener("click", () => vscode.postMessage({ type: "openDiff", file: d.file }))
      els.changesList.appendChild(row)
    }
  }

  function fmt(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + "M"
    if (n >= 1000) return (n / 1000).toFixed(1) + "k"
    return String(n)
  }

  function renderParts(msg) {
    const out = []
    for (const part of msg.parts) {
      if (!part || !part.type) continue
      if (part.type === "text") {
        if (part.synthetic) continue
        out.push('<div class="part-text">' + renderMarkdown(part.text || "") + "</div>")
      } else if (part.type === "reasoning") {
        if (!state.showThinking) continue
        out.push('<div class="part-reasoning">' + escapeHtml(part.text || "") + "</div>")
      } else if (part.type === "tool") {
        out.push(renderTool(part))
      } else if (part.type === "file") {
        out.push('<div class="part-tool">📎 ' + escapeHtml(part.filename || part.url || "file") + "</div>")
      }
    }
    return out.join("")
  }

  function renderTool(part) {
    const st = part.state || {}
    const status = st.status || "pending"
    const title = st.title || part.tool || "tool"
    let html = '<div class="part-tool">'
    html +=
      '<div class="tool-head"><span class="tool-status ' +
      status +
      '">' +
      status +
      "</span><strong>" +
      escapeHtml(part.tool || "tool") +
      "</strong><span>" +
      escapeHtml(title) +
      "</span></div>"
    const output = st.output
    if (status === "completed" && output) {
      html += "<pre>" + escapeHtml(truncate(output, 4000)) + "</pre>"
    } else if (status === "error" && st.error) {
      html += "<pre>" + escapeHtml(truncate(String(st.error), 2000)) + "</pre>"
    }
    html += "</div>"
    return html
  }

  function addPermission(perm) {
    if (!perm || !perm.id) return
    if (state.permissions.some((p) => p.id === perm.id)) return
    state.permissions.push(perm)
    renderPermissionCard(perm)
    scrollToBottom(true)
  }

  function removePermission(id) {
    state.permissions = state.permissions.filter((p) => p.id !== id)
    const el = document.getElementById("perm-" + id)
    if (el) el.remove()
  }

  function renderPermissionCard(perm) {
    if (document.getElementById("perm-" + perm.id)) return
    const card = document.createElement("div")
    card.className = "permission"
    card.id = "perm-" + perm.id
    const title = document.createElement("div")
    title.className = "perm-title"
    title.textContent = perm.title || "Permission requested"
    const actions = document.createElement("div")
    actions.className = "perm-actions"
    actions.appendChild(permButton("Allow once", "once", perm.id))
    actions.appendChild(permButton("Always", "always", perm.id))
    actions.appendChild(permButton("Reject", "reject", perm.id, true))
    card.appendChild(title)
    card.appendChild(actions)
    els.messages.appendChild(card)
  }

  function permButton(label, response, id, secondary) {
    const b = document.createElement("button")
    b.textContent = label
    if (secondary) b.className = "secondary"
    b.addEventListener("click", () => {
      vscode.postMessage({ type: "permission", permissionId: id, response })
      removePermission(id)
    })
    return b
  }

  // ---- forms (interactive questions) ----

  function cssEsc(s) {
    return String(s).replace(/["\\]/g, "\\$&")
  }

  function renderForms() {
    const ids = new Set()
    for (const form of state.forms) {
      ids.add("form-" + form.id)
      renderFormCard(form)
    }
    els.messages.querySelectorAll(".form-card").forEach((el) => {
      if (!ids.has(el.id)) el.remove()
    })
    for (const form of state.forms) {
      const el = document.getElementById("form-" + form.id)
      if (el) els.messages.appendChild(el)
    }
    scrollToBottom(false)
  }

  function renderFormCard(form) {
    if (document.getElementById("form-" + form.id)) return
    const card = document.createElement("div")
    card.className = "form-card"
    card.id = "form-" + form.id

    const title = document.createElement("div")
    title.className = "form-title"
    title.textContent = form.title || "Question"
    card.appendChild(title)

    for (const f of form.fields || []) {
      if (f.hidden) continue
      card.appendChild(formField(f))
    }

    const err = document.createElement("div")
    err.className = "form-error hidden"
    card.appendChild(err)

    const actions = document.createElement("div")
    actions.className = "form-actions"
    const submit = document.createElement("button")
    submit.textContent = "Submit"
    submit.addEventListener("click", () => submitForm(form, card, err))
    const cancel = document.createElement("button")
    cancel.className = "secondary"
    cancel.textContent = "Cancel"
    cancel.addEventListener("click", () => vscode.postMessage({ type: "cancelForm", formId: form.id }))
    actions.appendChild(submit)
    actions.appendChild(cancel)
    card.appendChild(actions)

    els.messages.appendChild(card)
  }

  function formField(f) {
    const row = document.createElement("div")
    row.className = "form-field"

    if (f.type === "external") {
      const label = document.createElement("div")
      label.className = "form-label"
      label.textContent = f.title || f.key
      const btn = document.createElement("button")
      btn.className = "secondary"
      btn.textContent = "Open"
      btn.addEventListener("click", () => vscode.postMessage({ type: "openExternal", url: f.url }))
      row.appendChild(label)
      if (f.description) row.appendChild(formDesc(f.description))
      row.appendChild(btn)
      return row
    }

    const label = document.createElement("label")
    label.className = "form-label"
    label.textContent = (f.title || f.key) + (f.required ? " *" : "")
    row.appendChild(label)
    if (f.description) row.appendChild(formDesc(f.description))

    if (f.type === "boolean") {
      const cb = document.createElement("input")
      cb.type = "checkbox"
      cb.dataset.key = f.key
      cb.checked = f.default === true
      label.htmlFor = "fld-" + f.key
      cb.id = "fld-" + f.key
      cb.style.marginLeft = "6px"
      label.appendChild(cb)
      return row
    }

    if (f.type === "multiselect") {
      const wrap = document.createElement("div")
      wrap.className = "form-options"
      wrap.dataset.key = f.key
      for (const opt of f.options || []) {
        const l = document.createElement("label")
        l.className = "form-option"
        const cb = document.createElement("input")
        cb.type = "checkbox"
        cb.value = opt.value
        if (Array.isArray(f.default) && f.default.includes(opt.value)) cb.checked = true
        l.appendChild(cb)
        const t = document.createElement("span")
        t.textContent = opt.label + (opt.description ? " — " + opt.description : "")
        l.appendChild(t)
        wrap.appendChild(l)
      }
      row.appendChild(wrap)
      return row
    }

    if (f.type === "number" || f.type === "integer") {
      const input = document.createElement("input")
      input.type = "number"
      input.dataset.key = f.key
      if (f.minimum !== undefined) input.min = f.minimum
      if (f.maximum !== undefined) input.max = f.maximum
      if (f.default !== undefined) input.value = String(f.default)
      row.appendChild(input)
      return row
    }

    if (f.options && f.options.length) {
      const sel = document.createElement("select")
      sel.dataset.key = f.key
      const empty = document.createElement("option")
      empty.value = ""
      empty.textContent = "Select…"
      sel.appendChild(empty)
      for (const opt of f.options) {
        const o = document.createElement("option")
        o.value = opt.value
        o.textContent = opt.label + (opt.description ? " — " + opt.description : "")
        sel.appendChild(o)
      }
      if (f.default !== undefined) sel.value = String(f.default)
      row.appendChild(sel)
      return row
    }

    const input = document.createElement("input")
    input.type = "text"
    input.dataset.key = f.key
    if (f.placeholder) input.placeholder = f.placeholder
    if (f.default !== undefined) input.value = String(f.default)
    row.appendChild(input)
    return row
  }

  function formDesc(text) {
    const d = document.createElement("div")
    d.className = "form-desc"
    d.textContent = text
    return d
  }

  function submitForm(form, card, err) {
    const answer = {}
    const missing = []
    for (const f of form.fields || []) {
      if (f.hidden || f.type === "external") continue
      const el = card.querySelector('[data-key="' + cssEsc(f.key) + '"]')
      if (!el) continue
      if (f.type === "boolean") {
        answer[f.key] = el.checked
      } else if (f.type === "multiselect") {
        const vals = Array.from(el.querySelectorAll("input:checked")).map((i) => i.value)
        if (vals.length) answer[f.key] = vals
        else if (f.required) missing.push(f.title || f.key)
      } else if (f.type === "number" || f.type === "integer") {
        if (el.value === "") {
          if (f.required) missing.push(f.title || f.key)
        } else {
          answer[f.key] = f.type === "integer" ? parseInt(el.value, 10) : Number(el.value)
        }
      } else {
        const v = el.value.trim()
        if (!v) {
          if (f.required) missing.push(f.title || f.key)
        } else {
          answer[f.key] = v
        }
      }
    }
    if (missing.length) {
      err.textContent = "Required: " + missing.join(", ")
      err.classList.remove("hidden")
      return
    }
    err.classList.add("hidden")
    vscode.postMessage({ type: "replyForm", formId: form.id, answer })
  }

  function renderStatus(message) {
    if (state.status === "ready") {
      els.status.classList.add("hidden")
      return
    }
    els.status.classList.remove("hidden")
    els.status.classList.toggle("error", state.status === "error")
    els.status.textContent =
      message || (state.status === "starting" ? "Starting OpenCode server…" : state.status)
  }

  function renderError(message) {
    els.status.classList.remove("hidden")
    els.status.classList.add("error")
    els.status.textContent = message
  }

  function renderBusy() {
    els.send.classList.toggle("hidden", state.busy)
    els.stop.classList.toggle("hidden", !state.busy)
    els.thinking.classList.toggle("hidden", !state.busy)
  }

  function renderThinkingToggle() {
    els.thinkingToggle.classList.toggle("active", state.showThinking)
    els.thinkingToggle.title = state.showThinking
      ? "Hide the model's thinking"
      : "Show the model's thinking"
  }

  function renderContext() {
    const ctx = state.context
    if (!ctx) {
      els.contextBar.classList.add("hidden")
      return
    }
    els.contextBar.classList.remove("hidden")
    let label = ctx.relativePath + " : L" + ctx.startLine
    if (ctx.endLine !== ctx.startLine) label += "-" + ctx.endLine
    if (ctx.hasSelection) label = "✂ " + label
    els.contextLabel.textContent = label
    els.contextLabel.title = label
  }

  function addAttachments(files) {
    for (const f of files) {
      if (!f || !f.url) continue
      if (state.attachments.some((a) => a.url === f.url)) continue
      state.attachments.push(f)
    }
    renderAttachments()
  }

  function renderAttachments() {
    els.attachments.innerHTML = ""
    els.attachments.classList.toggle("hidden", state.attachments.length === 0)
    state.attachments.forEach((a, i) => {
      const chip = document.createElement("span")
      chip.className = "attachment"
      chip.title = a.filename
      const name = document.createElement("span")
      name.className = "attachment-name"
      name.textContent = a.filename
      const rm = document.createElement("button")
      rm.className = "attachment-remove"
      rm.textContent = "×"
      rm.title = "Remove attachment"
      rm.addEventListener("click", () => {
        state.attachments.splice(i, 1)
        renderAttachments()
      })
      chip.appendChild(name)
      chip.appendChild(rm)
      els.attachments.appendChild(chip)
    })
  }

  function renderSessions() {
    els.sessionSelect.innerHTML = ""
    for (const s of state.sessions) {
      const opt = document.createElement("option")
      opt.value = s.id
      opt.textContent = s.title || "Untitled"
      if (s.id === state.sessionId) opt.selected = true
      els.sessionSelect.appendChild(opt)
    }
    if (!state.sessions.length && state.sessionId) {
      const opt = document.createElement("option")
      opt.value = state.sessionId
      opt.textContent = "Current session"
      opt.selected = true
      els.sessionSelect.appendChild(opt)
    }
  }

  function renderAgents() {
    els.agentSelect.innerHTML = ""
    const def = document.createElement("option")
    def.value = ""
    def.textContent = "Default agent"
    els.agentSelect.appendChild(def)
    for (const a of state.agents) {
      const opt = document.createElement("option")
      opt.value = a
      opt.textContent = a
      els.agentSelect.appendChild(opt)
    }
  }

  function renderModels() {
    els.modelSelect.innerHTML = ""
    const def = document.createElement("option")
    def.value = ""
    def.textContent = "Default model"
    els.modelSelect.appendChild(def)
    const groups = new Map()
    for (const m of state.models) {
      if (!groups.has(m.providerID)) groups.set(m.providerID, [])
      groups.get(m.providerID).push(m)
    }
    for (const [provider, models] of groups) {
      const og = document.createElement("optgroup")
      og.label = provider
      for (const m of models) {
        const opt = document.createElement("option")
        opt.value = m.id
        opt.textContent = m.id.endsWith("-free") ? m.id + " (free)" : m.id
        og.appendChild(opt)
      }
      els.modelSelect.appendChild(og)
    }
  }

  function restoreSelection(msg) {
    const model = persisted.model || msg.model
    const agent = persisted.agent || msg.agent
    if (model && selectValue(els.modelSelect, model) && persisted.model) {
      vscode.postMessage({ type: "setModel", model })
    }
    if (agent && selectValue(els.agentSelect, agent) && persisted.agent) {
      vscode.postMessage({ type: "setAgent", agent })
    }
  }

  function selectValue(select, value) {
    if (!value) return false
    for (const opt of select.options) {
      if (opt.value === value) {
        select.value = value
        return true
      }
    }
    return false
  }

  function persistState(patch) {
    vscode.setState(Object.assign({}, vscode.getState() || {}, patch))
  }

  function scrollToBottom(force) {
    const near =
      els.messages.scrollHeight - els.messages.scrollTop - els.messages.clientHeight < 80
    if (force || near) els.messages.scrollTop = els.messages.scrollHeight
  }

  // ---- code actions ----

  function attachCodeActions(root) {
    root.querySelectorAll(".code-block").forEach((block) => {
      const code = block.querySelector("pre code")
      if (!code) return
      const text = code.textContent || ""
      const copy = block.querySelector(".copy-btn")
      const insert = block.querySelector(".insert-btn")
      if (copy) copy.addEventListener("click", () => navigator.clipboard.writeText(text))
      if (insert) insert.addEventListener("click", () => vscode.postMessage({ type: "insertCode", text }))
    })
    root.querySelectorAll(".file-link").forEach((link) => {
      link.addEventListener("click", () =>
        vscode.postMessage({
          type: "openFile",
          path: link.getAttribute("data-path"),
          line: parseInt(link.getAttribute("data-line") || "1", 10),
        }),
      )
    })
  }

  // ---- markdown ----

  function renderMarkdown(src) {
    const blocks = []
    let text = String(src || "")
    text = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (m, lang, code) => {
      const id = blocks.length
      blocks.push({ lang, code })
      return "\u0000CODE" + id + "\u0000"
    })

    let html = escapeHtml(text)
    html = html.replace(/`([^`\n]+)`/g, '<code class="inline">$1</code>')
    html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    html = html.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    html = html.replace(/^######\s+(.*)$/gm, "<h6>$1</h6>")
    html = html.replace(/^#####\s+(.*)$/gm, "<h5>$1</h5>")
    html = html.replace(/^####\s+(.*)$/gm, "<h4>$1</h4>")
    html = html.replace(/^###\s+(.*)$/gm, "<h3>$1</h3>")
    html = html.replace(/^##\s+(.*)$/gm, "<h2>$1</h2>")
    html = html.replace(/^#\s+(.*)$/gm, "<h1>$1</h1>")
    html = html.replace(
      /\[([^\]]+)\]\((https?:[^)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener">$1</a>',
    )
    html = html.replace(
      /@([\w./\\-]+)#L(\d+)(?:-(\d+))?/g,
      (m, p, a) => '<span class="file-link" data-path="' + p + '" data-line="' + a + '">' + m + "</span>",
    )
    html = html.replace(/\n/g, "<br/>")
    html = html.replace(/\u0000CODE(\d+)\u0000/g, (m, i) => renderCodeBlock(blocks[Number(i)]))
    return html
  }

  function renderCodeBlock(block) {
    if (!block) return ""
    const code = escapeHtml(String(block.code || "").replace(/\n$/, ""))
    return (
      '<div class="code-block"><div class="code-actions">' +
      '<button class="copy-btn">Copy</button><button class="insert-btn">Insert</button>' +
      '</div><pre class="code"><code>' +
      code +
      "</code></pre></div>"
    )
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
  }

  function truncate(s, n) {
    return s.length > n ? s.slice(0, n) + "\n… (truncated)" : s
  }

  // ---- composer ----

  function send() {
    const text = els.input.value.trim()
    if ((!text && state.attachments.length === 0) || state.busy) return
    vscode.postMessage({
      type: "send",
      text,
      includeContext: state.includeContext,
      files: state.attachments,
    })
    els.input.value = ""
    state.attachments = []
    renderAttachments()
    autoGrow()
  }

  function autoGrow() {
    els.input.style.height = "auto"
    els.input.style.height = Math.min(els.input.scrollHeight, 240) + "px"
  }

  els.send.addEventListener("click", send)
  els.attach.addEventListener("click", () => vscode.postMessage({ type: "pickFiles" }))
  els.stop.addEventListener("click", () => vscode.postMessage({ type: "abort" }))
  els.input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  })
  els.input.addEventListener("input", autoGrow)
  els.newSession.addEventListener("click", () => vscode.postMessage({ type: "newSession" }))
  els.renameSession.addEventListener("click", () => {
    if (!state.sessionId) return
    const current = state.sessions.find((s) => s.id === state.sessionId)
    vscode.postMessage({
      type: "renameSession",
      sessionId: state.sessionId,
      currentTitle: current ? current.title : "",
    })
  })
  els.thinkingToggle.addEventListener("click", () => {
    state.showThinking = !state.showThinking
    persistState({ showThinking: state.showThinking })
    renderThinkingToggle()
    renderMessages(false)
  })
  els.deleteSession.addEventListener("click", () => {
    if (state.sessionId) vscode.postMessage({ type: "deleteSession", sessionId: state.sessionId })
  })
  els.restart.addEventListener("click", () => vscode.postMessage({ type: "restart" }))
  els.changesToggle.addEventListener("click", () => {
    els.changes.classList.toggle("hidden")
    renderDiffs()
  })
  els.changesRefresh.addEventListener("click", () => vscode.postMessage({ type: "refreshDiffs" }))
  els.unrevert.addEventListener("click", () => vscode.postMessage({ type: "unrevert" }))
  els.includeContext.addEventListener("change", () => {
    state.includeContext = els.includeContext.checked
  })
  els.sessionSelect.addEventListener("change", () =>
    vscode.postMessage({ type: "switchSession", sessionId: els.sessionSelect.value }),
  )
  els.agentSelect.addEventListener("change", () => {
    persistState({ agent: els.agentSelect.value })
    vscode.postMessage({ type: "setAgent", agent: els.agentSelect.value })
  })
  els.modelSelect.addEventListener("change", () => {
    state.model = els.modelSelect.value
    persistState({ model: els.modelSelect.value })
    vscode.postMessage({ type: "setModel", model: els.modelSelect.value })
    renderUsage()
  })
})()
