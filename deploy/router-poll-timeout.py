#!/usr/bin/env python3
"""Stop one dead MikroTik from freezing the whole site list on jmestre.

pollAllRouters() walks every router on one cached API socket. RouterOSAPI.talk()
waited forever for !done, and the socket idle timer destroyed whichever socket
was current — so a reconnect left the old session established and the poll
loop never finished. After 2026-10-15 10:19 the panel kept showing sites down
even though their SSTP sessions and API ports were up.

Applied on jmvps (/opt/jm-allinone) 2026-10-15, then jm-allinone was restarted.
"""
from pathlib import Path

ROOT = Path("/opt/jm-allinone")
API = ROOT / "lib" / "routeros-api.js"
SERVER = ROOT / "server.js"

OLD_TIMEOUT = """      this.sock.setTimeout(this.timeout);
      this.sock.on("timeout", () => this.sock.destroy(new Error("connection timed out")));
"""
NEW_TIMEOUT = """      const sock = this.sock;
      sock.setTimeout(this.timeout);
      // Bind this socket. A later reconnect must not let the old timer destroy the new one
      // and leave the old connection established with a command that never settles.
      sock.on("timeout", () => sock.destroy(new Error("connection timed out")));
"""

OLD_TALK = """    return this.ensureConnected().then(
      () =>
        new Promise((resolve, reject) => {
          const tag = String(++this.tagSeq);
          this.pending.set(tag, { replies: [], resolve, reject, trap: null });
          this.sock.write(encodeSentence([...words, ".tag=" + tag]));
        })
    );
"""
NEW_TALK = """    return this.ensureConnected().then(
      () =>
        new Promise((resolve, reject) => {
          const tag = String(++this.tagSeq);
          const sock = this.sock;
          let settled = false;
          const finish = (fn, arg) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            fn(arg);
          };
          // Idle socket timeout does not cover a command that never returns !done.
          const timer = setTimeout(() => {
            this.pending.delete(tag);
            this.connected = false;
            this.connecting = null;
            try { sock && sock.destroy(); } catch {}
            finish(reject, new Error("connection timed out"));
          }, this.timeout);
          this.pending.set(tag, {
            replies: [],
            resolve: (v) => finish(resolve, v),
            reject: (e) => finish(reject, e),
            trap: null,
          });
          try {
            sock.write(encodeSentence([...words, ".tag=" + tag]));
          } catch (e) {
            this.pending.delete(tag);
            finish(reject, e);
          }
        })
    );
"""

OLD_CATCH = """      } catch (e) { up = false; error = e.message || String(e); }
"""
NEW_CATCH = """      } catch (e) {
        up = false; error = e.message || String(e);
        // Drop the cached socket. A half-open API session otherwise stays "connected"
        // and the next poll waits on it until the whole router sync loop is stuck.
        try { invalidateRouterConn(r.id); } catch {}
      }
"""


def patch(path: Path, old: str, new: str, label: str) -> None:
    text = path.read_text()
    if new in text:
        print("already patched", label)
        return
    n = text.count(old)
    if n != 1:
        raise SystemExit(f"{label}: expected 1 match, found {n}")
    path.write_text(text.replace(old, new, 1))
    print("patched", label)


def main() -> None:
    if not API.exists() or not SERVER.exists():
        raise SystemExit("run this on jmvps, where /opt/jm-allinone is installed")
    patch(API, OLD_TIMEOUT, NEW_TIMEOUT, "socket timeout")
    patch(API, OLD_TALK, NEW_TALK, "command timeout")
    patch(SERVER, OLD_CATCH, NEW_CATCH, "drop cached socket")


if __name__ == "__main__":
    main()
