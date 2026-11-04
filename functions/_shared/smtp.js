// Minimal SMTP submission client for Cloudflare Workers TCP sockets (cloudflare:sockets).
// Supports implicit TLS (port 465) and STARTTLS (port 587) with AUTH LOGIN/PLAIN.
// Works with Amazon SES SMTP endpoints (email-smtp.<region>.amazonaws.com) and most providers.
// Note: Cloudflare blocks outbound port 25; use 465 or 587.

const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = s => btoa(String.fromCharCode(...enc.encode(s)));

class SmtpConnection {
  constructor(socket, timeoutMs) {
    this.timeoutMs = timeoutMs;
    this.attach(socket);
  }
  attach(socket) {
    this.socket = socket;
    this.reader = socket.readable.getReader();
    this.writer = socket.writable.getWriter();
    this.buffer = "";
  }
  async readResponse() {
    const deadline = Date.now() + this.timeoutMs;
    for (;;) {
      const lines = this.buffer.split("\r\n");
      // A complete reply ends with a line "NNN text" (space, not hyphen).
      for (let i = 0; i < lines.length - 1; i++) {
        if (/^\d{3} /.test(lines[i]) || /^\d{3}$/.test(lines[i])) {
          const reply = lines.slice(0, i + 1);
          this.buffer = lines.slice(i + 1).join("\r\n");
          return { code: Number(reply[i].slice(0, 3)), text: reply.join("\n") };
        }
      }
      if (Date.now() > deadline) throw new Error("SMTP timeout waiting for server reply");
      const timer = new Promise((_, reject) => setTimeout(() => reject(new Error("SMTP timeout")), Math.max(1, deadline - Date.now())));
      const { value, done } = await Promise.race([this.reader.read(), timer]);
      if (done) throw new Error("SMTP connection closed by server");
      this.buffer += dec.decode(value, { stream: true });
    }
  }
  async command(line, expect) {
    await this.writer.write(enc.encode(line + "\r\n"));
    const reply = await this.readResponse();
    const ok = Array.isArray(expect) ? expect.includes(reply.code) : reply.code === expect;
    if (!ok) throw new Error(`SMTP ${line.split(" ")[0]} rejected: ${reply.text.slice(0, 200)}`);
    return reply;
  }
  async expect(code) {
    const reply = await this.readResponse();
    if (reply.code !== code) throw new Error(`SMTP unexpected reply: ${reply.text.slice(0, 200)}`);
    return reply;
  }
  release() {
    try { this.reader.releaseLock(); } catch {}
    try { this.writer.releaseLock(); } catch {}
  }
}

const clean = s => String(s ?? "").replace(/[\r\n]+/g, " ").trim();
function encodeWord(s) {
  s = clean(s);
  return /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`;
}
export function formatAddress(name, email) {
  const e = clean(email);
  if (!name) return `<${e}>`;
  const n = clean(name);
  return /^[\x20-\x7e]*$/.test(n) ? `"${n.replace(/["\\]/g, "")}" <${e}>` : `${encodeWord(n)} <${e}>`;
}
const wrap76 = s => s.replace(/.{1,76}/g, m => m + "\r\n");

/** Build an RFC 5322 multipart/alternative message with base64 parts. */
export function buildMime({ from, fromName, to, toName, replyTo, subject, text, html, messageId, date = new Date() }) {
  const boundary = "jelhr-" + crypto.randomUUID();
  const headers = [
    `From: ${formatAddress(fromName, from)}`,
    `To: ${formatAddress(toName, to)}`,
    replyTo ? `Reply-To: ${formatAddress("", replyTo)}` : null,
    `Subject: ${encodeWord(subject)}`,
    `Date: ${date.toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${messageId}>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`
  ].filter(Boolean);
  const part = (type, content) => [`--${boundary}`, `Content-Type: ${type}; charset=utf-8`, "Content-Transfer-Encoding: base64", "", wrap76(b64(content))].join("\r\n");
  return headers.join("\r\n") + "\r\n\r\n" + part("text/plain", text) + "\r\n" + (html ? part("text/html", html) + "\r\n" : "") + `--${boundary}--\r\n`;
}

export async function smtpSend(config, message, connectImpl) {
  const connect = connectImpl || (await import("cloudflare:sockets")).connect;
  const port = Number(config.port || 465);
  const mode = config.secure || (port === 465 ? "tls" : "starttls");
  const timeoutMs = config.timeoutMs || 15000;
  let socket = connect({ hostname: config.host, port }, { secureTransport: mode === "tls" ? "on" : "starttls", allowHalfOpen: false });
  const conn = new SmtpConnection(socket, timeoutMs);
  const heloName = config.heloName || "jelhr.pages.dev";
  try {
    await conn.expect(220);
    let ehlo = await conn.command(`EHLO ${heloName}`, 250);
    if (mode === "starttls") {
      if (!/STARTTLS/i.test(ehlo.text)) throw new Error("SMTP server does not offer STARTTLS");
      await conn.command("STARTTLS", 220);
      conn.release();
      socket = socket.startTls();
      conn.attach(socket);
      ehlo = await conn.command(`EHLO ${heloName}`, 250);
    }
    if (config.username) {
      if (/AUTH[^\n]*\bPLAIN\b/i.test(ehlo.text)) {
        await conn.command(`AUTH PLAIN ${b64(`\u0000${config.username}\u0000${config.password}`)}`, 235);
      } else {
        await conn.command("AUTH LOGIN", 334);
        await conn.command(b64(config.username), 334);
        await conn.command(b64(config.password), 235);
      }
    }
    await conn.command(`MAIL FROM:<${clean(message.from)}>`, 250);
    await conn.command(`RCPT TO:<${clean(message.to)}>`, [250, 251]);
    await conn.command("DATA", 354);
    const body = buildMime(message).replace(/\r\n\./g, "\r\n.."); // dot-stuffing
    const reply = await conn.command(body + "\r\n.", 250);
    try { await conn.command("QUIT", 221); } catch {}
    const id = /queued as ([^\s]+)/i.exec(reply.text)?.[1] || /\b250 Ok ([^\s]+)/i.exec(reply.text)?.[1] || message.messageId;
    return { id };
  } finally {
    conn.release();
    try { await socket.close(); } catch {}
  }
}
