import net from "node:net";

export default {
  id: "ocvm-openlive-sessions-v2",
  async setup(ctx) {
    const registration = await ctx.tool.transform(editor => editor.add({
      name: "voice_sessions",
      description: "List, inspect, read, attach or create project sessions through the OpenLive manager. Available only to the OpenLive manager session.",
      options: { codemode: false },
      input: { type: "object", properties: { action: { type: "string", enum: ["list", "status", "read", "attach", "create"] }, sessionId: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 12 }, title: { type: "string", maxLength: 80 } }, required: ["action"], additionalProperties: false },
      async execute(args, context) {
        const path = process.env.OCVM_OPENLIVE_CONTROL_SOCKET;
        if (!path) throw new Error("OpenLive control socket is not configured.");
        const content = await new Promise((resolve, reject) => {
          const socket = net.createConnection(path); let data = "";
          socket.setEncoding("utf8"); socket.setTimeout(2000);
          socket.on("connect", () => socket.write(`${JSON.stringify({ ...args, callerSessionId: context.sessionID, callerMessageId: context.messageID, expiresAt: Date.now() + 1750 })}\n`));
          socket.on("data", chunk => {
            data += chunk;
            if (data.length > 1024 * 1024) { socket.destroy(new Error("OpenLive control response too large.")); return; }
            if (!data.includes("\n")) return;
            try { const reply = JSON.parse(data); if (!reply.ok) reject(new Error(reply.error)); else resolve(reply.output); } catch (error) { reject(error); } finally { socket.end(); }
          });
          socket.on("timeout", () => socket.destroy(new Error("OpenLive control request timed out.")));
          socket.on("error", reject);
        });
        return { content };
      },
    }));
    return () => registration.dispose();
  },
};
