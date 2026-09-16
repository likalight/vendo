const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const cfg = () => chrome.storage.sync.get({ server: "http://localhost:3000", token: "" });
const base = async () => (await cfg()).server.replace(/\/$/, "");
const post = async (path, body) => fetch((await base()) + path, { method: "POST", headers: { "content-type": "application/json", "x-vendo-assist": (await cfg()).token }, body: JSON.stringify(body) }).then((r) => r.json());

(async () => {
  const { pendingText } = await chrome.storage.session.get("pendingText");
  if (pendingText) { $("#q").value = pendingText.slice(0, 200); await chrome.storage.session.remove("pendingText"); search(); }
})();

$("#sel").onclick = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => String(window.getSelection() || "") });
  if (r?.result) { $("#q").value = r.result.slice(0, 200); search(); }
};
$("#go").onclick = search;
$("#q").addEventListener("keydown", (e) => e.key === "Enter" && search());

async function search() {
  const q = $("#q").value.trim(); if (!q) return;
  $("#out").innerHTML = '<p class="m">Searching…</p>';
  try {
    // 1) suggestions with inputs already filled from the text, 2) broader search results
    const [match, res] = await Promise.all([
      post("/vendo/assist/match", { text: q }).catch(() => ({ offers: [] })),
      fetch(`${await base()}/vendo/public/search?q=${encodeURIComponent(q)}&limit=6`).then((r) => r.json()),
    ]);
    const filled = new Map((match.offers || []).map((o) => [o.serviceKey.split(" ")[0] + " " + o.serviceKey.split(" ").slice(2).join(" "), o.url]));
    if (!res.items?.length) {
      $("#out").innerHTML = `<p class="m">No Vendo service fits. For a bigger or custom job, post it to OKX AI with your agent:</p><pre>${esc(match.okxTaskPrompt || "Post a job on OKX.AI using Onchain OS: " + q)}</pre>`;
      return;
    }
    $("#out").innerHTML = res.items.map((it, i) => `<div class="item" data-i="${i}">
      <div class="top"><b>${esc(it.summary)}</b><span class="price">${it.priceUsd} USDT0</span></div>
      <div class="m">${esc(it.storeTitle)}${it.uptime24h != null ? ` · ${it.uptime24h}% up` : ""}</div>
      <div class="form"></div><button data-i="${i}" class="prep" style="margin-top:6px">Set up</button></div>`).join("");
    document.querySelectorAll(".prep").forEach((b) => b.onclick = () => prepare(res.items[b.dataset.i], b.parentElement, filled));
  } catch { $("#out").innerHTML = `<p class="err">Can't reach Vendo at ${esc(await base())}. Check Settings.</p>`; }
}

function prepare(item, box, filled) {
  const pre = filled.get(`${item.store} ${item.url.replace(/^.*?\/[a-z0-9-]+(\/.*)$/, "$1")}`);
  const preVals = pre ? Object.fromEntries(new URL(pre).searchParams) : {};
  const form = box.querySelector(".form");
  form.innerHTML = item.params.map((p) => `<label>${esc(p.description)}${p.required ? " *" : ""}</label><input data-n="${esc(p.name)}" value="${esc(preVals[p.name] ?? "")}" placeholder="${esc(p.example ?? "")}">`).join("") +
    `<button class="p run" style="margin-top:8px">Pay ${item.priceUsd} USDT0 and run</button><div class="res"></div>`;
  box.querySelector(".prep").remove();
  form.querySelector(".run").onclick = async (e) => {
    const values = Object.fromEntries([...form.querySelectorAll("input")].map((i) => [i.dataset.n, i.value.trim()]));
    const built = await post("/vendo/assist/prepare", { item, values });
    const out = form.querySelector(".res");
    if (built.errors) { out.innerHTML = `<p class="err">${esc(built.errors.join("; "))}</p>`; return; }
    if (built.missing?.length) { out.innerHTML = `<p class="err">Fill in: ${esc(built.missing.join(", "))}</p>`; return; }
    if (!confirm(`Pay ${item.priceUsd} USDT0 on X Layer for "${item.summary}"?`)) return;
    e.target.disabled = true; e.target.textContent = "Paying…";
    const x = await post("/vendo/assist/run", { url: built.url, serviceKey: `${item.store} ${item.method} ${item.url.replace(/^.*?\/[a-z0-9-]+(\/.*)$/, "$1")}`, priceUsd: item.priceUsd });
    e.target.remove();
    if (x.paid) out.innerHTML = `<p class="ok">Paid ${x.priceUsdt0} USDT0${x.offline ? " (demo)" : ""}</p><pre>${esc(JSON.stringify(x.body, null, 2)).slice(0, 2500)}</pre>`;
    else if (x.fundingPlan) out.innerHTML = `<p class="err">${esc(x.error)}</p><p class="m">Your funds are on another chain? Ask your agent:</p><pre>${esc(x.fundingPlan.steps.map((s) => s.prompt || s.step).join("\n\n"))}</pre>`;
    else out.innerHTML = `<p class="err">${esc(x.error || x.errors?.join("; ") || "Status " + x.status)}</p>`;
  };
}
