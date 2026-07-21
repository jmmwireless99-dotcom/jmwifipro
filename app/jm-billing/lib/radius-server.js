// Minimal RADIUS auth/accounting for central hotspot (Node built-ins only).

import dgram from "node:dgram";
import crypto from "node:crypto";

const MIKROTIK_VENDOR = 14988;
const ATTR_USER_NAME = 1;
const ATTR_USER_PASSWORD = 2;
const ATTR_CHAP_PASSWORD = 3;
const ATTR_REPLY_MESSAGE = 18;
const ATTR_SESSION_TIMEOUT = 27;
const ATTR_ACCT_STATUS = 40;
const ATTR_ACCT_SESSION_TIME = 46;
const ATTR_VENDOR_SPECIFIC = 26;
const ATTR_CHAP_CHALLENGE = 60;

const CODE_ACCESS_REQUEST = 1;
const CODE_ACCESS_ACCEPT = 2;
const CODE_ACCESS_REJECT = 3;
const CODE_ACCOUNTING_REQUEST = 4;
const CODE_ACCOUNTING_RESPONSE = 5;

function md5(buf) {
  return crypto.createHash("md5").update(buf).digest();
}

function readAttrs(buf, off, end) {
  const attrs = [];
  let o = off;
  while (o < end) {
    const type = buf[o];
    const len = buf[o + 1];
    if (len < 2 || o + len > end) break;
    attrs.push({ type, data: buf.subarray(o + 2, o + len) });
    o += len;
  }
  return attrs;
}

function buildAttrs(pairs) {
  const parts = [];
  for (const [type, val] of pairs) {
    let data;
    if (type === ATTR_SESSION_TIMEOUT) {
      data = Buffer.alloc(4);
      data.writeUInt32BE(Math.max(0, Math.round(Number(val) || 0)), 0);
    } else if (type === ATTR_VENDOR_SPECIFIC) {
      data = val;
    } else {
      data = Buffer.from(String(val), "utf8");
    }
    const b = Buffer.alloc(2 + data.length);
    b[0] = type;
    b[1] = 2 + data.length;
    data.copy(b, 2);
    parts.push(b);
  }
  return Buffer.concat(parts);
}

function mikrotikGroup(profile) {
  const v = Buffer.from(String(profile), "utf8");
  const inner = Buffer.alloc(2 + v.length);
  inner[0] = 3; // Mikrotik-Group
  inner[1] = 2 + v.length;
  v.copy(inner, 2);
  const outer = Buffer.alloc(6 + inner.length);
  outer.writeUInt32BE(MIKROTIK_VENDOR, 0);
  outer[4] = 0;
  outer[5] = inner.length + 2;
  inner.copy(outer, 6);
  return outer;
}

function buildResponse({ code, id, requestAuth, secret, attrs }) {
  const attrBuf = buildAttrs(attrs);
  const len = 20 + attrBuf.length;
  const respAuth = md5(Buffer.concat([
    Buffer.from([code, id, (len >> 8) & 0xff, len & 0xff]),
    requestAuth,
    attrBuf,
    Buffer.from(secret, "utf8"),
  ]));
  const head = Buffer.alloc(20);
  head[0] = code;
  head[1] = id;
  head.writeUInt16BE(len, 2);
  respAuth.copy(head, 4);
  return Buffer.concat([head, attrBuf]);
}

function decryptPap(encrypted, requestAuth, secret) {
  let last = Buffer.from(requestAuth);
  const out = Buffer.alloc(encrypted.length);
  for (let i = 0; i < encrypted.length; i += 16) {
    const hash = md5(Buffer.concat([Buffer.from(secret, "utf8"), last]));
    for (let j = 0; j < 16 && i + j < encrypted.length; j++) out[i + j] = encrypted[i + j] ^ hash[j];
    last = encrypted.subarray(i, Math.min(i + 16, encrypted.length));
  }
  return out.toString("utf8").replace(/\0/g, "");
}

function verifyChap(chapPass, chapChallenge, password) {
  if (chapPass.length < 17 || !chapChallenge.length) return false;
  const id = chapPass[0];
  const hash = md5(Buffer.concat([Buffer.from([id]), Buffer.from(password, "utf8"), chapChallenge]));
  return hash.equals(chapPass.subarray(1, 17));
}

export function startRadiusServer({ secret, authPort = 1812, acctPort = 1813, onAuth, onAccounting }) {
  const sec = String(secret || "").trim();
  if (!sec) throw new Error("RADIUS secret is required.");

  const bindPort = (port, label) => {
    const sock = dgram.createSocket("udp4");
    sock.on("message", (msg, rinfo) => {
    try {
      if (msg.length < 20) return;
      const code = msg[0];
      const id = msg[1];
      const reqAuth = msg.subarray(4, 20);
      const attrs = readAttrs(msg, 20, msg.length);
      let username = "";
      let password = "";
      let chapPass = null;
      let chapChallenge = null;
      let sessionTime = 0;
      let acctStatus = 0;

      for (const a of attrs) {
        if (a.type === ATTR_USER_NAME) username = a.data.toString("utf8").replace(/\0/g, "");
        else if (a.type === ATTR_USER_PASSWORD) password = decryptPap(a.data, reqAuth, sec);
        else if (a.type === ATTR_CHAP_PASSWORD) chapPass = a.data;
        else if (a.type === ATTR_CHAP_CHALLENGE) chapChallenge = a.data;
        else if (a.type === ATTR_ACCT_SESSION_TIME && a.data.length >= 4) sessionTime = a.data.readUInt32BE(0);
        else if (a.type === ATTR_ACCT_STATUS && a.data.length >= 4) acctStatus = a.data.readUInt32BE(0);
      }

      const nas = rinfo.address || "";

      if (code === CODE_ACCESS_REQUEST) {
        let auth = onAuth({ username, password, nas });
        if (!auth.ok && chapPass && chapChallenge && auth.storedPassword != null) {
          if (verifyChap(chapPass, chapChallenge, auth.storedPassword)) auth = onAuth({ username, password: auth.storedPassword, nas, chapOk: true });
        }
        const pkt = auth.ok
          ? buildResponse({
            code: CODE_ACCESS_ACCEPT, id, requestAuth: reqAuth, secret: sec,
            attrs: [
              [ATTR_SESSION_TIMEOUT, auth.remainingSecs || 3600],
              ...(auth.profile ? [[ATTR_VENDOR_SPECIFIC, mikrotikGroup(auth.profile)]] : []),
            ],
          })
          : buildResponse({
            code: CODE_ACCESS_REJECT, id, requestAuth: reqAuth, secret: sec,
            attrs: [[ATTR_REPLY_MESSAGE, auth.message || "Access denied"]],
          });
        sock.send(pkt, rinfo.port, rinfo.address);
      } else if (code === CODE_ACCOUNTING_REQUEST) {
        if (username && (acctStatus === 1 || acctStatus === 2 || acctStatus === 3)) {
          onAccounting({ username, sessionSecs: sessionTime, nas, acctStatus });
        }
        const pkt = buildResponse({ code: CODE_ACCOUNTING_RESPONSE, id, requestAuth: reqAuth, secret: sec, attrs: [] });
        sock.send(pkt, rinfo.port, rinfo.address);
      }
    } catch (e) {
      console.log("  !! RADIUS error:", e.message);
    }
    });

    sock.on("error", (e) => {
      console.log(`  !! RADIUS ${label} socket error:`, e.message);
    });

    sock.bind(port, () => {
      console.log(`  >> Central hotspot RADIUS listening UDP :${port} (${label})`);
    });
    return sock;
  };

  const authSock = bindPort(authPort, "auth");
  const acctSock = acctPort && Number(acctPort) !== Number(authPort)
    ? bindPort(acctPort, "accounting")
    : null;

  return {
    socket: authSock,
    close: () => {
      try { authSock.close(); } catch {}
      if (acctSock) try { acctSock.close(); } catch {}
    },
  };
}
