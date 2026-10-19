import legacyPolicy from "./managed-policy.mjs";
import { V2Contract, events } from "./v2-contract.mjs";
import { protocol, questionInResponse, responseUsage, terminalResponse, permissionBlocker } from "./managed-core.mjs";
import { relative, sep } from "node:path";
import { Schema } from "effect";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";

// Product V2 plugin lifecycle. The established policy owner and Unix socket
// stay shared by MCP, OpenLive and A2A; hooks use native V2 session identity.
export default {
  id: "ocvm-managed-policy-v2",
  async setup(ctx) {
    if (!process.env.OCVM_MANAGED_POLICY_SOCKET) return;
    const password = process.env.OPENCODE_SERVER_PASSWORD;
    const api = new V2Contract(process.env.OCVM_V2_NATIVE_URL, password ? { authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}` } : {});
    const fetchState = { turns: new Map() };
    let policy;
    const readPattern = file => {
      const worktree = ctx.location.project.directory;
      return file === worktree || file.startsWith(worktree + sep) ? relative(ctx.location.directory, file) : file;
    };
    const tools = async () => (await ctx.tool.list()).map(tool => {
      let parameters = tool.input;
      if (Schema.isSchema(parameters)) { const document = Schema.toJsonSchemaDocument(parameters); parameters = { ...document.schema, $defs: document.definitions }; }
      return { id: tool.id, description: tool.description, parameters };
    });
    const hooks = await legacyPolicy({ directory: ctx.location.directory, worktree: ctx.location.project.directory, v2: { fetchState, readPattern, tools, bind(value) { policy = value; } }, client: {
      _client: { request: async ({ method, url, body, query }) => ({ data: await api.request(method, url, body, query) }) },
      event: { subscribe: async (_, { signal }) => ({ stream: (async function* () {
        for await (const event of events(await api.raw("GET", "/api/event", undefined, signal))) {
          if (event.type === "permission.asked") yield { type: "permission.asked", properties: { ...event.data, permission: event.data.action, patterns: event.data.resources } };
        }
      })() }) },
    } });
    // V2's HTTP hook can replace the Request, but cannot return a Response.
    // Route an already-blocked primary step to an in-process one-use response
    // endpoint, so a permission handback never sends another provider request.
    const tickets = new Map();
    const gate = createServer(async (req, res) => {
      try {
      const ticket = tickets.get(req.headers["x-ocvm-completion-ticket"]);
      tickets.delete(req.headers["x-ocvm-completion-ticket"]);
      if (!ticket || ticket.expires < Date.now() || req.method !== "POST") { res.writeHead(403); res.end(); return; }
      const response = terminalResponse(ticket.report, ticket.protocol, ticket.streaming);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      for await (const chunk of response.body) res.write(chunk);
      res.end();
      } catch { res.destroy(); }
    });
    try { await new Promise((yes, no) => { gate.once("error", no); gate.listen(0, "127.0.0.1", yes); }); }
    catch (error) { await hooks.dispose(); throw error; }
    const gateURL = `http://127.0.0.1:${gate.address().port}/completion`;
    const disposers = [];
    const on = (domain, name, run) => disposers.push(domain.hook(name, run));
    const turn = id => [...fetchState.turns.values()].findLast(t => t.sessionID === id);
    const arm = (id, report) => { const state = turn(id); if (state) state.report ??= report; };
    on(ctx.session, "prompt", async event => {
      await hooks["chat.message"]({ sessionID: event.sessionID }, { message: { tools: event.metadata?.["ocvm.tools"] } });
    });
    on(ctx.session, "context", async event => {
      const history = await api.api("GET", `/api/session/${encodeURIComponent(event.sessionID)}/message?limit=100&order=desc`);
      const user = history.data.find(item => item.type === "user");
      const system = user?.metadata?.["ocvm.system"];
      if (typeof system === "string") event.system.push({ type: "text", text: system });
      if (!await policy.isManaged(event.sessionID)) return;
      const strings = event.system.map(part => typeof part === "string" ? part : part.text ?? "");
      const output = { system: strings };
      await hooks["experimental.chat.system.transform"]({ sessionID: event.sessionID }, output);
      event.system = output.system.map(text => ({ type: "text", text }));
    });
    on(ctx.session, "model.request", async event => {
      if (event.kind !== "primary" || !await policy.isManaged(event.sessionID)) return;
      // This is a local completion-gate key, not an inferred message parent.
      const provider = (await api.api("GET", `/api/provider?directory=${encodeURIComponent(ctx.location.directory)}`)).data.find(p => p.id === event.model.providerID);
      const output = { headers: {} };
      const history = await api.api("GET", `/api/session/${encodeURIComponent(event.sessionID)}/message?limit=100&order=desc`);
      const user = history.data.find(item => item.type === "user");
      if (!user) throw new Error("MANAGED_COMPLETION_USER_UNAVAILABLE");
      await hooks["chat.headers"]({ sessionID: event.sessionID, message: { id: user.id }, model: { api: { npm: provider?.package ?? "" } }, agent: event.agent }, output);
      const state = turn(event.sessionID);
      if (state) state.family = provider.package;
      // Correlation stays in-process: never add a private header to a provider.
    });
    on(ctx.session, "http.request", async event => {
      if (event.kind !== "primary" || !await policy.isManaged(event.sessionID)) return;
      const state = turn(event.sessionID);
      if (!state) throw new Error("MANAGED_COMPLETION_TURN_UNKNOWN");
      const body = JSON.parse(await event.request.clone().text());
      state.protocol = protocol(body, event.request.url, state.family);
      state.streaming = body.stream !== false && !event.request.url.includes(":generateContent");
      if (!state.protocol) throw new Error("MANAGED_COMPLETION_PROTOCOL_UNSUPPORTED");
      if (state.report) {
        for (const [key, ticket] of tickets) if (ticket.expires < Date.now()) tickets.delete(key);
        if (tickets.size >= 128) throw new Error("MANAGED_COMPLETION_TICKET_LIMIT");
        const key = randomBytes(32).toString("base64url");
        tickets.set(key, { report: state.report, protocol: state.protocol, streaming: state.streaming, expires: Date.now() + 10000 });
        event.request = new Request(gateURL, { method: "POST", headers: { "x-ocvm-completion-ticket": key }, body: "{}" });
      }
    });
    on(ctx.session, "http.response", async event => {
      if (event.kind !== "primary" || !await policy.isManaged(event.sessionID)) return;
      const state = turn(event.sessionID);
      if (!state?.protocol) throw new Error("MANAGED_COMPLETION_TURN_UNKNOWN");
      if (state.report) { await event.response.body?.cancel(); event.response = terminalResponse(state.report, state.protocol, state.streaming); return; }
      if (!event.response.ok || !event.response.body) return;
      let bytes = 0; const chunks = [];
      for await (const chunk of event.response.body) { bytes += chunk.byteLength; if (bytes > 8 * 1024 * 1024) throw new Error("MANAGED_COMPLETION_STEP_LIMIT"); chunks.push(Buffer.from(chunk)); }
      const raw = Buffer.concat(chunks), blocked = questionInResponse(raw.toString("utf8"), state.protocol);
      if (blocked) { state.report = blocked.report; event.response = terminalResponse(state.report, state.protocol, state.streaming, responseUsage(raw.toString("utf8"), state.protocol)); }
      else event.response = new Response(raw, { status: event.response.status, headers: event.response.headers });
    });
    on(ctx.session, "experimental.ws.handshake", async event => {
      if (event.kind === "primary" && await policy.isManaged(event.sessionID)) throw new Error("MANAGED_COMPLETION_WEBSOCKET_UNSUPPORTED: configure HTTP transport");
    });
    on(ctx.permission, "evaluate", async event => {
      if (event.effect !== "ask" || !await policy.isManaged(event.sessionID)) return;
      arm(event.sessionID, permissionBlocker({ permission: event.action, patterns: event.resources }));
      event.effect = "deny";
      event.message = "INPUT_REQUIRED: managed permission requires operator authorization; no approval was granted.";
    });
    on(ctx.tool, "execute.before", async event => {
      const tool = { shell: "bash", subagent: "task" }[event.tool] ?? event.tool;
      await hooks["tool.execute.before"]({ tool, sessionID: event.sessionID }, { args: { ...event.input, ...(tool === "read" ? { filePath: event.input.path } : {}), ...(tool === "task" ? { task_id: event.input.sessionID } : {}) } });
    });
    // Native direct-shell creation has no session identity. Enforce the guest
    // origin boundary for all shell invocations instead of inventing one.
    on(ctx.shell, "create.before", async event => {
      if (await policy.deniedWrite(event.command, event.cwd)) throw new Error("REMOTE_WRITE_DENIED: publishing is operator-only");
    });
    let registrations;
    try { registrations = await Promise.all(disposers); }
    catch (error) { gate.closeAllConnections(); await new Promise(resolve => gate.close(resolve)); await hooks.dispose(); throw error; }
    return async () => { for (const registration of registrations.reverse()) await registration.dispose(); gate.closeAllConnections(); await new Promise(resolve => gate.close(resolve)); await hooks.dispose(); };
  },
};
