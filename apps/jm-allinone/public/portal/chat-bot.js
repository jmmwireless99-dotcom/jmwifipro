(function () {
  if (window.__jmChatBoot) return;
  window.__jmChatBoot = true;

  const style = document.createElement("style");
  style.textContent = `
    #jm-chat-launch{position:fixed;bottom:18px;right:18px;z-index:1300;width:56px;height:56px;border-radius:50%;border:none;background:linear-gradient(135deg,#e8195f,#7c3aed);color:#fff;font-size:24px;cursor:pointer;box-shadow:0 8px 28px rgba(232,25,95,.45)}
    #jm-chat-panel{position:fixed;bottom:84px;right:18px;z-index:1300;width:min(360px,calc(100vw - 24px));height:min(480px,calc(100vh - 120px));background:#14101f;border:1px solid rgba(255,255,255,.12);border-radius:18px;display:none;flex-direction:column;overflow:hidden;box-shadow:0 18px 50px rgba(0,0,0,.45)}
    #jm-chat-panel.open{display:flex}
    #jm-chat-head{padding:14px 16px;background:linear-gradient(135deg,#3a1d63,#241140);color:#fff;font-weight:800;font-size:15px;display:flex;justify-content:space-between;align-items:center}
    #jm-chat-close{background:none;border:none;color:#fff;font-size:20px;cursor:pointer;line-height:1}
    #jm-chat-msgs{flex:1;overflow:auto;padding:14px;display:flex;flex-direction:column;gap:10px;background:#0f0a18}
    .jm-msg{max-width:88%;padding:10px 12px;border-radius:14px;font-size:14px;line-height:1.45;white-space:pre-wrap}
    .jm-msg.user{align-self:flex-end;background:linear-gradient(135deg,#e8195f,#7c3aed);color:#fff;border-bottom-right-radius:4px}
    .jm-msg.bot{align-self:flex-start;background:#1e1630;border:1px solid rgba(255,255,255,.08);color:#ece6f5;border-bottom-left-radius:4px}
    .jm-msg.typing{opacity:.7;font-style:italic}
    #jm-chat-foot{display:flex;gap:8px;padding:10px;border-top:1px solid rgba(255,255,255,.08);background:#14101f}
    #jm-chat-input{flex:1;border:1px solid rgba(255,255,255,.12);background:#0f0a18;color:#fff;border-radius:12px;padding:10px 12px;font-size:14px;font-family:inherit}
    #jm-chat-send{border:none;background:linear-gradient(135deg,#e8195f,#7c3aed);color:#fff;border-radius:12px;padding:0 14px;font-weight:700;cursor:pointer}
  `;
  document.head.appendChild(style);

  const panel = document.createElement("div");
  panel.id = "jm-chat-panel";
  panel.innerHTML = `
    <div id="jm-chat-head"><span>💬 Chat support</span><button id="jm-chat-close" aria-label="Close">×</button></div>
    <div id="jm-chat-msgs"></div>
    <div id="jm-chat-foot">
      <input id="jm-chat-input" placeholder="Ask about billing, payment, no internet…" maxlength="500">
      <button id="jm-chat-send">Send</button>
    </div>`;

  const launch = document.createElement("button");
  launch.id = "jm-chat-launch";
  launch.type = "button";
  launch.title = "Chat support";
  launch.textContent = "💬";
  launch.style.display = "none";

  document.body.appendChild(panel);
  document.body.appendChild(launch);

  const msgs = panel.querySelector("#jm-chat-msgs");
  const input = panel.querySelector("#jm-chat-input");
  const history = [];

  function addMsg(text, role) {
    const el = document.createElement("div");
    el.className = "jm-msg " + (role === "user" ? "user" : "bot");
    el.textContent = text;
    msgs.appendChild(el);
    msgs.scrollTop = msgs.scrollHeight;
    return el;
  }

  async function send() {
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    input.disabled = true;
    panel.querySelector("#jm-chat-send").disabled = true;
    addMsg(text, "user");
    history.push({ role: "user", content: text });
    const typing = addMsg("Typing…", "bot");
    typing.classList.add("typing");
    try {
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history: history.slice(0, -1) }),
      });
      const d = await r.json();
      typing.remove();
      if (!d.ok) {
        addMsg(d.error || "Sorry, chat is unavailable right now.", "bot");
        return;
      }
      addMsg(d.reply, "bot");
      history.push({ role: "assistant", content: d.reply });
    } catch {
      typing.remove();
      addMsg("Network error. Please try again or use the Help page.", "bot");
    } finally {
      input.disabled = false;
      panel.querySelector("#jm-chat-send").disabled = false;
      input.focus();
    }
  }

  launch.onclick = () => {
    panel.classList.toggle("open");
    if (panel.classList.contains("open")) {
      input.focus();
      if (!history.length) {
        addMsg("Hi! I can help with billing, payments, account access, and common connection issues. What do you need?", "bot");
      }
    }
  };
  panel.querySelector("#jm-chat-close").onclick = () => panel.classList.remove("open");
  panel.querySelector("#jm-chat-send").onclick = send;
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") send(); });

  fetch("/api/chat/status")
    .then((r) => r.json())
    .then((d) => { if (d.ok && d.enabled) launch.style.display = "block"; })
    .catch(() => { launch.style.display = "block"; });
})();
