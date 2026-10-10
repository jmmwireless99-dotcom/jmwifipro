const tests = ["good morning", "paano magbayad", "wala internet"];
for (const message of tests) {
  const r = await fetch("http://127.0.0.1:3000/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message, history: [] }),
  });
  const j = await r.json();
  console.log("\n>", message);
  console.log(j.ok ? j.reply : j.error, j.mode ? `[${j.mode}]` : "");
}
