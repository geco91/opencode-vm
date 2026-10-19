// OCVM's internal adapter contract over the pinned OpenCode product V2 API.
// The browser and native TUI use /api directly; no V1 backend is involved.
import { mkdir, lstat, readFile, writeFile, rename } from "node:fs/promises";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";
export const PRODUCT_VERSION = "2.0.32";
const aliases = { bash: "shell", task: "subagent", write: "edit", patch: "edit" };
const oldNames = { shell: "bash", subagent: "task" };
export const nativeAction = name => aliases[name] ?? name;
export const legacyRules = rules => (rules ?? []).map(r => ({ permission: oldNames[r.action] ?? r.action, pattern: r.resource, action: r.effect }));
export const nativeRules = rules => (rules ?? []).map(r => ({ action: nativeAction(r.permission), resource: r.pattern, effect: r.action }));
const unwrap = value => value?.data ?? value;
const enc = encodeURIComponent;
function legacyError(error) {
  if (!error) return;
  const name = { aborted: "MessageAbortedError", "provider.auth": "ProviderAuthError", "provider.content-filter": "ContentFilterError" }[error.type] ?? (error.type?.startsWith("provider.") ? "APIError" : "UnknownError");
  return { name, data: { message: error.message, statusCode: error.status, responseBody: error.response?.body, metadata: { ocvmV2Type: error.type } } };
}
function nativeFile(part) {
  if (typeof part.url !== "string" || !part.url) throw new Error("V2_FILE_URI_INVALID");
  // The server accepts URI inputs and hydrates them into data/mime/source
  // records. Its read schema differs from its prompt-admission schema.
  return { uri: part.url, name: part.filename };
}

function advanceLineage(state, event) {
  const seq = event.durable.seq;
  state.inbox ??= {};
  if (seq !== state.seq + 1) { state.gap = true; state.current = null; state.delivered = []; state.inbox = {}; }
  if (event.type === "session.created" && seq === 0 || event.type === "session.execution.started") { state.gap = false; state.current = null; state.delivered = []; }
  if (event.type === "session.inbox.enqueued") {
    // Persist only the native item type, never its prompt/control payload.
    state.inbox[event.data.inboxID] = event.data.item.type;
    if (Object.keys(state.inbox).length > 10000) throw new Error("V2_CORRELATION_LIMIT");
  }
  if (event.type === "session.inbox.delivered") {
    const id = event.data.inboxID, type = state.inbox[id];
    if (type === "user") state.delivered.push(id);
    else if (!["synthetic", "compaction", "move"].includes(type)) state.delivered.push(null);
    delete state.inbox[id];
  }
  let parent;
  if (event.type === "session.step.started") {
    if (state.delivered.length) state.current = !state.gap && state.delivered.length === 1 ? state.delivered[0] : null;
    state.delivered = [];
    parent = [event.data.assistantMessageID, state.current];
  }
  state.seq = seq;
  return parent;
}

export async function* events(response, maxBytes = Infinity) {
  if (!response.ok || !response.headers.get("content-type")?.includes("text/event-stream")) throw new Error("V2_EVENT_STREAM_INVALID");
  let pending = "", bytes = 0;
  const decoder = new TextDecoder();
  for await (const chunk of response.body) {
    bytes += chunk.byteLength;
    if (bytes > maxBytes) throw new Error("V2_EVENT_READ_LIMIT");
    pending += decoder.decode(chunk, { stream: true }).replace(/\r\n/g, "\n");
    if (pending.length > 8 * 1024 * 1024) throw new Error("V2_EVENT_FRAME_LIMIT");
    let boundary;
    while ((boundary = pending.indexOf("\n\n")) !== -1) {
      const frame = pending.slice(0, boundary); pending = pending.slice(boundary + 2);
      const data = frame.split("\n").filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
      if (data) yield JSON.parse(data);
    }
  }
}

export class V2Contract {
  constructor(baseUrl, headers = {}) { this.baseUrl = baseUrl; this.headers = headers; this.lineage = new Map(); }
  async raw(method, path, body, signal) {
    if (!path.startsWith("/") || path.startsWith("//")) throw new Error("V2_PATH_INVALID");
    return fetch(new URL(path, this.baseUrl), { method, headers: { ...this.headers, ...(body === undefined ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: signal ?? AbortSignal.timeout(15000) });
  }
  async api(method, path, body) {
    const response = await this.raw(method, path, body);
    if (!response.ok) { const error = new Error(`V2_BACKEND_${response.status}`); error.status = response.status; throw error; }
    if (response.status === 204) return;
    if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("V2_BACKEND_CONTRACT_INVALID");
    return response.json();
  }
  async nativeConfig(directory) {
    const entries = unwrap(await this.api("GET", `/api/config?directory=${enc(directory)}`));
    if (!Array.isArray(entries)) throw new Error("V2_CONFIG_CONTRACT_INVALID");
    return Object.assign({}, ...entries.filter(e => e.type === "document").map(e => e.info));
  }
  async config(directory) {
    const config = await this.nativeConfig(directory);
    if (config.model && typeof config.model === "object") config.model = `${config.model.providerID}/${config.model.model ?? config.model.id}`;
    return config;
  }
  session(info) {
    return { ...info, directory: info.location?.directory, permission: legacyRules(info.permissions), time: { ...info.time, ...(info.metadata?.["ocvm.archived"] ? { archived: info.metadata["ocvm.archived"] } : {}) } };
  }
  lineageFile(id) {
    if (!/^ses_[A-Za-z0-9_-]{1,250}$/.test(id)) throw new Error("V2_SESSION_ID_INVALID");
    return join(process.env.XDG_DATA_HOME ?? join(process.env.HOME, ".local/share"), "opencode/ocvm-v2-lineage", `${id}.json`);
  }
  async loadLineage(id) {
    const file = this.lineageFile(id);
    try {
      const stat = await lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4 * 1024 * 1024 || stat.uid !== process.getuid() || stat.mode & 0o077) throw new Error("V2_LINEAGE_UNSAFE");
      const value = JSON.parse(await readFile(file, "utf8"));
      if (![1, 2].includes(value.schema) || value.sessionID !== id || !Number.isInteger(value.seq) || !Array.isArray(value.parents) || value.parents.length > 10000 || !Array.isArray(value.delivered)) throw new Error("V2_LINEAGE_INVALID");
      // Earlier experimental records did not distinguish control deliveries.
      // Resume with unknown lineage rather than trust an untyped parent.
      if (value.schema === 1) return { schema: 2, sessionID: id, seq: value.seq, parents: [], delivered: [], current: null, gap: true, inbox: {} };
      return value;
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    return { schema: 2, sessionID: id, seq: -1, parents: [], delivered: [], current: null, gap: true, inbox: {} };
  }
  async observe(event) {
    const id = event.data?.sessionID, seq = event.durable?.seq;
    if (!id || !Number.isInteger(seq)) return;
    const state = await this.loadLineage(id);
    if (seq <= state.seq) return;
    const parent = advanceLineage(state, event);
    if (parent) {
      state.parents.push(parent);
      if (state.parents.length > 10000) throw new Error("V2_CORRELATION_LIMIT");
    }
    const file = this.lineageFile(id);
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    const temp = `${file}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(state), { mode: 0o600 }); await rename(temp, file);
  }
  async parents(sessionID) {
    // Replay only native durable delivery/step events. Never infer parent IDs
    // from text, timestamps or nearby messages. Multiple deliveries at a step
    // are ambiguous: omit parentID and let the existing receipt logic hold.
    let cache = this.lineage.get(sessionID);
    if (!cache) { if (this.lineage.size >= 128) this.lineage.delete(this.lineage.keys().next().value); cache = { parents: new Map(), delivered: [], current: null, seq: -1, gap: true, after: undefined }; this.lineage.set(sessionID, cache); }
    // Native replay is optional in product V2. Explicit zero includes the
    // delivery events when the server retains them; otherwise use OCVM's
    // exact observed event records below.
    if (cache.reading) { await cache.reading; return new Map(cache.parents); }
    let release;
    cache.reading = new Promise(resolve => { release = resolve; });
    try {
    const suffix = `&after=${enc(cache.after ?? 0)}`;
    const response = await this.raw("GET", `/api/experimental/session/${enc(sessionID)}/log?follow=false${suffix}`);
    for await (const event of events(response, 32 * 1024 * 1024)) {
      if (!event.durable) continue;
      if (cache.after !== undefined && event.durable.seq <= cache.after) continue;
      const parent = advanceLineage(cache, event);
      if (parent) {
        cache.parents.set(...parent);
        if (cache.parents.size > 10000) throw new Error("V2_CORRELATION_LIMIT");
      }
      cache.after = event.durable.seq;
    }
    // The native CLI currently disables event-payload retention. OCVM records
    // only observed native sequence/IDs, never prompts or inferred parents.
    // Gaps stay unknown; an absent record never authorizes a resend.
    const observed = await this.loadLineage(sessionID);
    for (const [id, parent] of observed.parents) if (parent) cache.parents.set(id, parent);
    return new Map(cache.parents);
    } finally { release(); cache.reading = undefined; }
  }
  message(sessionID, item, parents) {
    const common = { id: item.id, sessionID, role: item.type, time: item.time };
    if (item.type === "user") return { info: { ...common, agent: item.agent, model: item.model }, parts: [{ type: "text", id: `${item.id}_text`, sessionID, messageID: item.id, text: item.text ?? "" }, ...(item.files ?? []).map((f, i) => ({ type: "file", id: `${item.id}_file${i}`, sessionID, messageID: item.id, url: typeof f.data === "string" ? `data:${f.mime};base64,${f.data}` : f.uri, filename: f.name, mime: f.mime }))] };
    const info = { ...common, parentID: parents.get(item.id), agent: item.agent, modelID: item.model?.id, providerID: item.model?.providerID, variant: item.model?.variant, finish: item.finish, error: legacyError(item.error), tokens: item.tokens, cost: item.cost };
    const parts = (item.content ?? []).map((p, index) => {
      const base = { ...p, id: p.id ?? `${item.id}_${index}`, sessionID, messageID: item.id };
      if (p.type !== "tool") return base;
      const state = p.state;
      return { ...base, tool: oldNames[p.name] ?? p.name, callID: p.id, state: { ...state, time: { start: p.time?.ran ?? p.time?.created, end: p.time?.completed }, output: state.content?.filter(c => c.type === "text").map(c => c.text).join("\n"), error: state.error?.message } };
    });
    return { info, parts };
  }
  async request(method, path, body, query = {}, signal) {
    const directory = query.directory ?? process.cwd();
    const q = `directory=${enc(directory)}`;
    if (path === "/global/health") { const info = await this.api("GET", "/api/info"); if (info.version !== PRODUCT_VERSION) throw new Error("V2_VERSION_MISMATCH"); return { healthy: true, version: info.version }; }
    if (path === "/config" && method === "GET") return this.config(directory);
    if (path === "/config" && method === "PATCH") return this.api(method, `/api/config?${q}`, body);
    if (path === "/agent") {
      await this.api("GET", `/api/model/default?${q}`);
      const [result, config] = await Promise.all([this.api("GET", `/api/agent?${q}`), this.nativeConfig(directory)]);
      return result.data.map(a => {
        const model = a.model ?? (config.model && typeof config.model === "object" ? { providerID: config.model.providerID, id: config.model.model, variant: config.model.variant } : undefined);
        return { ...a, name: a.id, permission: legacyRules(a.permissions), model: model ? { providerID: model.providerID, modelID: model.id } : undefined, variant: model?.variant };
      });
    }
    if (path === "/provider" || path === "/config/providers") {
      // model.default awaits plugin activation; provider.list alone can expose
      // the pre-configuration catalog during a cold location startup.
      const def = await this.api("GET", `/api/model/default?${q}`);
      const [providers, models] = await Promise.all([this.api("GET", `/api/provider?${q}`), this.api("GET", `/api/model?${q}`)]);
      const all = providers.data.map(p => ({ ...p, models: Object.fromEntries(models.data.filter(m => m.providerID === p.id && m.enabled).map(m => {
        const capabilities = m.capabilities ?? {}, modalities = kind => Object.fromEntries(["text", "image", "audio", "video", "pdf"].map(type => [type, capabilities[kind]?.includes(type) === true]));
        return [m.id, { ...m, capabilities: { temperature: capabilities.temperature === true, reasoning: capabilities.reasoning?.supported === true, attachment: capabilities.input?.some(type => type !== "text") === true, toolcall: capabilities.tools === true, input: modalities("input"), output: modalities("output") }, api: { npm: p.package }, variants: Object.fromEntries((m.variants ?? []).map(v => [v.id, v])) }];
      })) }));
      const model = unwrap(def);
      return { all, connected: all.filter(p => p.activation !== "disabled" && Object.keys(p.models).length).map(p => p.id), default: model?.providerID ? { [model.providerID]: model.id } : {} };
    }
    if (path === "/project/current" || path === "/path") {
      const location = unwrap(await this.api("GET", `/api/location?${q}`));
      return path === "/path" ? { directory: location.directory, worktree: location.project.directory, config: join(process.env.XDG_CONFIG_HOME ?? join(process.env.HOME, ".config"), "opencode") } : { ...location.project, worktree: location.project.directory };
    }
    if (/^\/project\/[^/]+\/directories$/.test(path)) return [{ directory }];
    if (path === "/session/status") {
      const active = unwrap(await this.api("GET", "/api/session/active"));
      return Object.fromEntries(Object.entries(active).map(([id]) => [id, { type: "busy" }]));
    }
    if (path === "/question") return unwrap(await this.api("GET", "/api/form"));
    if (path === "/experimental/tool" || path === "/experimental/tool/ids") {
      await this.api("GET", `/api/model/default?${q}`);
      const tools = await new Promise((resolve, reject) => {
        const req = httpRequest({ socketPath: process.env.OCVM_MANAGED_POLICY_SOCKET, path: "/tools", timeout: 5000 }, res => {
          let text = "";
          res.on("data", chunk => { text += chunk; if (text.length > 4 * 1024 * 1024) req.destroy(new Error("V2_TOOL_LIST_LIMIT")); });
          res.on("end", () => { try { if (res.statusCode !== 200) throw new Error("V2_TOOL_LIST_UNAVAILABLE"); resolve(JSON.parse(text)); } catch (error) { reject(error); } });
        });
        req.on("timeout", () => req.destroy(new Error("V2_TOOL_LIST_TIMEOUT"))); req.on("error", reject); req.end();
      });
      return path.endsWith("/ids") ? tools.map(t => t.id) : tools;
    }
    if (path === "/permission") return unwrap(await this.api("GET", "/api/permission/request")).map(p => ({ ...p, permission: oldNames[p.action] ?? p.action, patterns: p.resources }));
    if (/^\/permission\/[^/]+\/reply$/.test(path)) {
      const pending = unwrap(await this.api("GET", "/api/permission/request"));
      const item = pending.find(p => p.id === path.split("/")[2]);
      if (!item) throw new Error("V2_PERMISSION_NOT_PENDING");
      return this.api("POST", `/api/session/${enc(item.sessionID)}/permission/${enc(item.id)}/reply`, { decision: body.reply, message: body.message });
    }
    if (path === "/session" && method === "POST") {
      const model = body?.model;
      const result = unwrap(await this.api("POST", "/api/session", { title: body?.title, parentID: body?.parentID, agent: body?.agent, model: model ? { providerID: model.providerID, id: model.id ?? model.modelID, variant: model.variant } : undefined, location: { directory }, permissions: nativeRules(body?.permission) }));
      return this.session(result);
    }
    if (path === "/session" && method === "GET") {
      const requested = query.limit === undefined ? Infinity : Number(query.limit), items = [], seen = new Set();
      if (!(requested > 0) || requested !== Infinity && !Number.isInteger(requested)) throw new Error("V2_SESSION_LIMIT_INVALID");
      let cursor;
      for (let page = 0; page <= 20; page++) {
        const result = await this.api("GET", `/api/session?${q}&limit=${Math.min(requested, 100)}${cursor ? `&cursor=${enc(cursor)}` : "&order=desc"}`);
        if (!result.data.length) return items;
        items.push(...result.data.map(s => this.session(s)).filter(s => !s.time.archived && (!query.roots || !s.parentID)));
        if (items.length >= requested) return items.slice(0, requested);
        cursor = result.cursor?.next;
        if (!cursor) return items;
        if (seen.has(cursor)) throw new Error("V2_SESSION_CURSOR_REPEATED");
        seen.add(cursor);
      }
      throw new Error("V2_SESSION_INVENTORY_LIMIT");
    }
    const match = path.match(/^\/session\/(ses_[\w-]+)(?:\/(.*))?$/);
    if (match) {
      const [, id, tail] = match, route = `/api/session/${enc(id)}`;
      if (!tail && method === "GET") return this.session(unwrap(await this.api("GET", route)));
      if (!tail && method === "DELETE") return this.api("DELETE", route);
      if (!tail && method === "PATCH") {
        const before = unwrap(await this.api("GET", route));
        await this.api("PATCH", route, { title: body.title, ...(body.permission ? { permissions: [...(before.permissions ?? []), ...nativeRules(body.permission)] } : {}), ...(body.time?.archived ? { metadata: { ...before.metadata, "ocvm.archived": body.time.archived } } : {}) });
        return this.session(unwrap(await this.api("GET", route)));
      }
      if (tail === "abort") return this.api("POST", `${route}/interrupt`);
      if (tail === "prompt_async" || tail === "message" && method === "POST") {
        const parts = body.parts ?? [];
        if (parts.some(p => !["text", "file"].includes(p.type))) throw new Error("V2_PROMPT_PART_UNSUPPORTED");
        const files = parts.filter(p => p.type === "file").map(nativeFile);
        const current = unwrap(await this.api("GET", route));
        if (body.agent && body.agent !== current.agent) await this.api("POST", `${route}/agent`, { agent: body.agent });
        if (body.model) {
          const model = { providerID: body.model.providerID, id: body.model.modelID ?? body.model.id, variant: body.variant };
          if (model.providerID !== current.model?.providerID || model.id !== current.model?.id || (model.variant ?? "default") !== (current.model?.variant ?? "default")) await this.api("POST", `${route}/model`, { model });
        }
        const messageID = body.messageID ?? `msg_${randomUUID().replaceAll("-", "")}`;
        const admitted = await this.api("POST", `${route}/prompt`, { id: messageID, text: parts.filter(p => p.type === "text").map(p => p.text).join("\n"), files, metadata: { ...(body.system ? { "ocvm.system": body.system } : {}), ...(body.tools ? { "ocvm.tools": body.tools } : {}) }, delivery: "queue" });
        if (tail === "prompt_async") return admitted;
        // V1's synchronous prompt is used by OpenLive and A2A. Admission is
        // performed exactly once; disconnects never abort or resend the turn.
        const deadline = Date.now() + 15 * 60 * 1000;
        while (Date.now() < deadline && !signal?.aborted) {
          const page = await this.api("GET", `${route}/message?limit=100&order=desc`);
          const parents = await this.parents(id);
          const answer = page.data.find(m => m.type === "assistant" && m.time?.completed && parents.get(m.id) === messageID);
          const active = unwrap(await this.api("GET", "/api/session/active"));
          if (answer && !active[id]) return this.message(id, answer, parents);
          await new Promise(resolve => setTimeout(resolve, 200));
        }
        throw new Error("V2_PROMPT_RESULT_UNCERTAIN");
      }
      if (tail === "message" && method === "GET") {
        const limit = Math.min(Number(query.limit) || 100, 100);
        const items = [], seen = new Set(); let cursor = query.before, next;
        for (let page = 0; page < 50; page++) {
          const result = await this.api("GET", `${route}/message?limit=${limit - items.length}${cursor ? `&cursor=${enc(cursor)}` : "&order=desc"}`);
          items.push(...result.data.filter(m => ["user", "assistant"].includes(m.type)));
          next = result.cursor?.next ?? undefined;
          if (items.length >= limit || !result.data.length || !next) break;
          if (seen.has(next)) throw new Error("V2_MESSAGE_CURSOR_REPEATED");
          seen.add(next); cursor = next;
          if (page === 49) throw new Error("V2_HISTORY_CONTROL_LIMIT");
        }
        const parents = await this.parents(id);
        return { items: items.map(m => this.message(id, m, parents)).reverse(), next };
      }
      if (tail?.startsWith("message/")) {
        try { return this.message(id, unwrap(await this.api("GET", `${route}/${tail}`)), await this.parents(id)); }
        catch (error) {
          if (error.status !== 404) throw error;
          const pending = unwrap(await this.api("GET", `${route}/inbox`)).find(item => item.id === tail.split("/")[1] && item.type === "user");
          if (!pending) throw error;
          return this.message(id, { ...pending.payload, id: pending.id, time: pending.time, type: "user" }, new Map());
        }
      }
    }
    if (/^\/mcp\/[^/]+\/connect$/.test(path)) return this.api(method, path.replace("/mcp/", "/api/experimental/mcp/"), body);
    if (path === "/mcp") return this.api(method, "/api/experimental/mcp", body);
    throw Object.assign(new Error("V2_COMPAT_OPERATION_UNSUPPORTED"), { status: 501 });
  }
}
