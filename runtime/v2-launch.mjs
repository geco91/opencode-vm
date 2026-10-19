#!/usr/bin/env node
import { createServer, request as httpRequest } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile, rename, lstat, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { timingSafeEqual, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { PRODUCT_VERSION, V2Contract, events } from "./v2-contract.mjs";

const native = process.env.OCVM_V2_BINARY ?? join(dirname(fileURLToPath(import.meta.url)), "node_modules/.bin/opencode");
const args = process.argv.slice(2);
const connectionFile = `/tmp/ocvm-v2-server-${process.getuid()}.json`;
if (["upgrade", "update", "uninstall", "service"].includes(args[0])) {
  throw new Error("OCVM owns the pinned V2 runtime; use opencode-vm init to rebuild it.");
} else if (args.includes("--version") || args.includes("-v")) {
  const version = spawnSync(native, ["--version"], { encoding: "utf8", timeout: 5000, maxBuffer: 4096 });
  if (version.status !== 0 || ![PRODUCT_VERSION, `opencode v${PRODUCT_VERSION}`].includes(version.stdout.trim())) throw new Error("V2_VERSION_MISMATCH: rebuild the pinned OCVM base");
  process.stdout.write(`${PRODUCT_VERSION}\n`);
} else if (args[0] === "web") {
  await serve();
} else if (args[0] === "attach" || args.includes("--help") || args.includes("--version") || args.includes("-h") || args.includes("-v")) {
  const mapped = args[0] === "attach" ? ["--server", ...args.slice(1)] : args;
  const child = spawn(native, mapped, { stdio: "inherit" });
  child.on("error", () => { process.exitCode = 1; });
  child.on("exit", code => { process.exitCode = code ?? 1; });
} else {
  let connection;
  try {
    const stat = await lstat(connectionFile);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid() || stat.mode & 0o077 || stat.size > 4096) throw new Error("V2_CONNECTION_UNSAFE");
    const saved = JSON.parse(await readFile(connectionFile, "utf8"));
    if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(saved.url)) throw new Error("V2_CONNECTION_INVALID");
    const api = new V2Contract(saved.url, { authorization: `Basic ${Buffer.from(`opencode:${saved.password}`).toString("base64")}` });
    if ((await api.api("GET", "/api/info")).pid === saved.pid) connection = saved;
  } catch (error) { if (!["ENOENT", "ECONNREFUSED"].includes(error.code) && error.message.startsWith("V2_CONNECTION_")) throw error; }
  if (connection) {
    const child = spawn(native, [...args, "--server", connection.url], { stdio: "inherit", env: { ...process.env, OPENCODE_SERVER_PASSWORD: connection.password } });
    child.on("error", () => { process.exitCode = 1; }); child.on("exit", code => { process.exitCode = code ?? 1; });
  } else await serve(args);
}

async function serve(clientArgs) {
  const dataDirectory = join(process.env.XDG_DATA_HOME ?? join(process.env.HOME, ".local/share"), "opencode");
  let hadDatabase = true;
  try { await lstat(join(dataDirectory, "opencode.db")); }
  catch (error) { if (error.code !== "ENOENT") throw error; hadDatabase = false; }
  const portIndex = args.indexOf("--port"), port = clientArgs ? 0 : portIndex < 0 ? 4096 : Number(args[portIndex + 1]);
  if (!Number.isInteger(port) || port < (clientArgs ? 0 : 1) || port > 65535) throw new Error("V2_PORT_INVALID");
  const reservation = createServer();
  await new Promise((yes, no) => { reservation.once("error", no); reservation.listen(0, "127.0.0.1", yes); });
  const nativePort = reservation.address().port;
  await new Promise(yes => reservation.close(yes));
  const baseUrl = `http://127.0.0.1:${nativePort}`;
  const password = process.env.OPENCODE_SERVER_PASSWORD ?? "";
  const auth = password ? `Basic ${Buffer.from(`${process.env.OPENCODE_SERVER_USERNAME || "opencode"}:${password}`).toString("base64")}` : "";
  const nativePassword = password || randomBytes(32).toString("base64url");
  const nativeAuth = `Basic ${Buffer.from(`opencode:${nativePassword}`).toString("base64")}`;
  const contract = new V2Contract(baseUrl, { authorization: nativeAuth });
  // All OCVM guests are Linux. The parent-death signal also closes the native
  // daemon if a host connection kills this supervisor without an exit trap.
  const child = spawn("setpriv", ["--pdeathsig", "TERM", native, "serve", "--hostname", "127.0.0.1", "--port", String(nativePort)], { stdio: clientArgs ? ["ignore", "ignore", "inherit"] : "inherit", env: { ...process.env, OPENCODE_SERVER_PASSWORD: nativePassword, OCVM_V2_NATIVE_URL: baseUrl } });
  let stopping = false;
  child.on("error", () => { process.exitCode = 1; });
  const exited = new Promise(resolve => child.on("exit", (code, signal) => resolve({ code, signal })));
  // No successful health response until the actual native contract is ready.
  let ready = false;
  for (let attempt = 0; attempt < 150; attempt++) {
    try { await contract.request("GET", "/global/health"); ready = true; break; } catch { /* bounded startup */ }
    if (child.exitCode !== null) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if (!ready) { child.kill("SIGTERM"); throw new Error("V2_STARTUP_FAILED"); }
  try { const stat = await lstat(connectionFile); if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid() || stat.mode & 0o077) throw new Error("V2_CONNECTION_UNSAFE"); } catch (error) { if (error.code !== "ENOENT") throw error; }
  const connection = { url: baseUrl, pid: child.pid, password: nativePassword, project: process.cwd() };
  const writeConnection = async () => {
    const temporary = `${connectionFile}.${process.pid}.${randomBytes(8).toString("hex")}`;
    try { await writeFile(temporary, JSON.stringify(connection), { mode: 0o600, flag: "wx" }); await rename(temporary, connectionFile); }
    finally { await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; }); }
  };
  await writeConnection();
  const credentials = join(dataDirectory, "credentials-v2.json");
  const snapshot = async () => {
    const value = await contract.api("GET", "/api/credential");
    const encoded = JSON.stringify({ version: PRODUCT_VERSION, data: value.data });
    // Publish credential events to the durable project share immediately;
    // VM-local /tmp does not survive a stopped/rebooted Lima guest.
    for (const target of new Set([credentials, process.env.OCVM_V2_CREDENTIAL_SNAPSHOT].filter(Boolean))) {
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      const temporary = `${target}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
      try { await writeFile(temporary, encoded, { mode: 0o600, flag: "wx" }); await rename(temporary, target); }
      finally { await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; }); }
    }
  };
  for (const source of new Set([process.env.OCVM_V2_CREDENTIAL_SNAPSHOT, credentials].filter(Boolean))) {
  try {
    const stat = await lstat(source);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024 || stat.mode & 0o077) throw new Error("V2_CREDENTIAL_SNAPSHOT_UNSAFE");
    const saved = JSON.parse(await readFile(source, "utf8"));
    if (saved.version !== PRODUCT_VERSION || !Array.isArray(saved.data)) throw new Error("V2_CREDENTIAL_SNAPSHOT_INVALID");
    const present = await contract.api("GET", "/api/credential");
    // An existing empty DB may record an explicit logout whose checkpoint
    // was interrupted. Restore only when starting a genuinely fresh DB.
    if (!hadDatabase && present.data.length === 0) for (const credential of saved.data) await contract.api("POST", "/api/credential", { ...credential, activate: credential.active });
    break;
  } catch (error) { if (error.code !== "ENOENT") { child.kill("SIGTERM"); throw new Error("V2_CREDENTIAL_RESTORE_FAILED"); } }
  }
  let snapshotQueue = Promise.resolve();
  const save = () => { snapshotQueue = snapshotQueue.then(snapshot); return snapshotQueue; };
  await save();
  const watching = new AbortController();
  // Subscribe before exposing the bridge. Keep the exact native delivery/step
  // evidence across restarts because the CLI does not retain its event log.
  let firstSubscription;
  const subscribed = new Promise(resolve => { firstSubscription = resolve; });
  const journal = (async () => {
    while (!watching.signal.aborted) {
      try {
        const response = await contract.raw("GET", "/api/event", undefined, watching.signal);
        if (!response.ok) throw new Error("V2_EVENTS_UNAVAILABLE");
        firstSubscription();
        for await (const event of events(response)) {
          await contract.observe(event);
          if (event.type.startsWith("credential.")) await save();
        }
      } catch { if (watching.signal.aborted) break; await new Promise(resolve => setTimeout(resolve, 1000)); }
    }
  })();
  await Promise.race([subscribed, new Promise((_, reject) => setTimeout(() => reject(new Error("V2_EVENTS_STARTUP_FAILED")), 15000).unref())]);
  const authorized = req => {
    if (!auth) return true;
    const supplied = Buffer.from(req.headers.authorization ?? "");
    // Native V2 clients use the fixed username opencode. The outer OCVM
    // proxy can retain its configured username with the same password.
    return [auth, nativeAuth].some(value => { const expected = Buffer.from(value); return supplied.length === expected.length && timingSafeEqual(supplied, expected); });
  };
  const server = createServer(async (req, res) => {
    const abort = new AbortController(); res.once("close", () => abort.abort());
    try {
      if (!authorized(req)) { res.writeHead(401, { "www-authenticate": 'Basic realm="OpenCode"' }); res.end(); return; }
      if (!req.url.startsWith("/") || req.url.startsWith("//")) throw new Error("V2_PATH_INVALID");
      const url = new URL(req.url, "http://localhost"), marked = req.headers["x-ocvm-adapter"] === "1";
      if (url.pathname === "/event" || url.pathname === "/global/event") {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" }); res.flushHeaders();
        const response = await contract.raw("GET", "/api/event", undefined, abort.signal);
        const emit = event => { if (!res.destroyed) res.write(`data: ${JSON.stringify(event)}\n\n`); };
        if (!response.ok || !response.headers.get("content-type")?.includes("text/event-stream")) throw new Error("V2_EVENT_STREAM_INVALID");
        emit({ type: "server.connected", properties: {} });
        for await (const event of events(response)) {
          const data = event.data ?? {}, id = data.sessionID;
          if (event.type.startsWith("credential.")) await save();
          if (event.type === "permission.asked") emit({ type: "permission.asked", properties: { ...data, permission: data.action, patterns: data.resources } });
          if (event.type === "form.created") emit({ type: "question.asked", properties: data.form ?? data });
          if (event.type === "session.inbox.delivered") {
            const message = await contract.request("GET", `/session/${id}/message/${data.inboxID}`);
            if (message.info.role === "user") emit({ type: "message.updated", properties: { info: message.info } });
          }
          if (event.type === "session.execution.started") emit({ type: "session.status", properties: { sessionID: id, status: { type: "busy" } } });
          if (["session.execution.succeeded", "session.execution.failed", "session.execution.interrupted", "session.idle"].includes(event.type)) {
            emit({ type: "session.status", properties: { sessionID: id, status: { type: "idle" } } });
            emit({ type: "session.idle", properties: { sessionID: id } });
          }
          if (id && data.assistantMessageID && !event.type.endsWith(".delta")) {
            const message = await contract.request("GET", `/session/${id}/message/${data.assistantMessageID}`);
            emit({ type: "message.updated", properties: { info: message.info } });
            for (const part of message.parts) emit({ type: "message.part.updated", properties: { part } });
          }
        }
        res.end(); return;
      }
      let body;
      if (!["GET", "HEAD"].includes(req.method)) {
        const chunks = []; let bytes = 0;
        for await (const chunk of req) { bytes += chunk.length; if (bytes > 16 * 1024 * 1024) throw new Error("V2_REQUEST_LIMIT"); chunks.push(chunk); }
        if (bytes) body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      }
      if (url.pathname.startsWith("/api/") || url.pathname === "/" || !/^\/(global|session|project|provider|path|config|agent|permission|question|mcp|experimental)(\/|$)/.test(url.pathname)) {
        if (marked && url.pathname === "/api/session" && url.searchParams.has("cursor")) url.searchParams.delete("order");
        let path = url.pathname + url.search;
        if (marked) path = path.replace(/(\/api\/session\/[^/]+)\/question(?=\?|$)/, "$1/form").replace(/^\/api\/question\/request/, "/api/form");
        const response = await contract.raw(req.method, path, body, abort.signal);
        if (marked && req.method === "GET" && /^\/api\/session(?:\/ses_[\w-]+)?$/.test(url.pathname)) {
          const value = await response.json();
          if (!response.ok) { res.writeHead(response.status); res.end(JSON.stringify(value)); return; }
          value.data = Array.isArray(value.data) ? value.data.map(s => contract.session(s)) : contract.session(value.data);
          res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(value)); return;
        }
        res.writeHead(response.status, Object.fromEntries([...response.headers].filter(([key]) => !["content-length", "transfer-encoding", "content-encoding"].includes(key))));
        if (response.body) for await (const chunk of response.body) { if (!res.write(chunk)) await new Promise(resolve => res.once("drain", resolve)); }
        res.end(); return;
      }
      const query = Object.fromEntries(url.searchParams);
      query.directory ??= req.headers["x-opencode-directory"] ? decodeURIComponent(req.headers["x-opencode-directory"]) : process.cwd();
      const value = await contract.request(req.method, url.pathname, body, query, abort.signal);
      if (/^\/session\/[^/]+\/message$/.test(url.pathname) && req.method === "GET") {
        res.writeHead(200, { "content-type": "application/json", ...(value.next ? { "x-next-cursor": value.next } : {}) }); res.end(JSON.stringify(value.items));
      } else { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(value ?? true)); }
    } catch (error) {
      if (!res.headersSent) { res.writeHead(error.status ?? 502, { "content-type": "application/json" }); res.end(JSON.stringify({ error: /^[A-Z0-9_]+$/.test(error.message) ? error.message : "V2_BRIDGE_FAILED" })); }
      else res.destroy();
    }
  });
  server.on("upgrade", (req, socket, head) => {
    if (!authorized(req)) { socket.end("HTTP/1.1 401 Unauthorized\r\n\r\n"); return; }
    if (!req.url.startsWith("/") || req.url.startsWith("//")) { socket.end("HTTP/1.1 400 Bad Request\r\n\r\n"); return; }
    const proxy = httpRequest(new URL(req.url, baseUrl), { headers: { ...req.headers, authorization: nativeAuth, host: `127.0.0.1:${nativePort}` } });
    proxy.on("upgrade", (response, upstream, initial) => {
      socket.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(response.headers).map(([k, v]) => `${k}: ${v}`).join("\r\n")}\r\n\r\n`);
      if (initial.length) socket.write(initial); if (head.length) upstream.write(head);
      upstream.pipe(socket); socket.pipe(upstream);
      socket.on("error", () => upstream.destroy()); upstream.on("error", () => socket.destroy());
    });
    proxy.on("error", () => socket.destroy()); proxy.end();
  });
  await new Promise((yes, no) => { server.once("error", no); server.listen(port, "127.0.0.1", yes); });
  connection.bridgeUrl = `http://127.0.0.1:${server.address().port}`;
  await writeConnection();
  const shutdown = async () => {
    if (stopping) return; stopping = true;
    try { await save(); } catch { process.stderr.write("[v2] Credential checkpoint failed; retain the session data for recovery.\n"); process.exitCode = 1; }
    watching.abort(); server.closeAllConnections(); server.close(); child.kill("SIGTERM");
  };
  process.on("SIGTERM", shutdown); process.on("SIGINT", shutdown);
  if (clientArgs) {
    const client = spawn(native, [...clientArgs, "--server", baseUrl], { stdio: "inherit", env: { ...process.env, OPENCODE_SERVER_PASSWORD: nativePassword } });
    client.on("error", () => { process.exitCode = 1; void shutdown(); });
    client.on("exit", code => { process.exitCode = code ?? 1; void shutdown(); });
  }
  const result = await exited;
  watching.abort(); await journal;
  server.closeAllConnections(); server.close();
  process.exitCode = process.exitCode || result.code || (stopping ? 0 : 1);
}
