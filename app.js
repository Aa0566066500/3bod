async function publish() {
  const name = document.getElementById("f-name").value.trim();
  const code = document.getElementById("f-code").value;
  if (!name || !code) {
    alert("اكتب اسم وكود");
    return;
  }
  const r = await fetch("/api/scripts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, code }),
  });
  const data = await r.json();
  if (!r.ok) {
    alert("خطأ: " + (data.error || ""));
    return;
  }
  document.getElementById("f-code").value = "";
  loadMine();
}

async function loadMine() {
  const r = await fetch("/api/my-scripts");
  const data = await r.json();
  const el = document.getElementById("list");
  if (!data.scripts || !data.scripts.length) {
    el.innerHTML = '<p class="muted">ماعندك سورسات لسى</p>';
    return;
  }
  el.innerHTML = data.scripts
    .map(
      (s) => `
    <div class="row">
      <div>
        <div class="name">${s.name} <span class="badge ${s.kill_switch ? "on" : "off"}">${s.kill_switch ? "مفعّل" : "موقّف"}</span></div>
        <div class="link">loadstring(game:HttpGet("${location.origin}/${s.name}/raw"))()</div>
        <div class="muted">عدد السحب: ${s.pull_count}</div>
      </div>
      <div class="actions">
        <button class="mini ghost" onclick="copyLink('${s.name}')">نسخ</button>
        <button class="mini ghost" onclick="toggleKill('${s.name}')">${s.kill_switch ? "إيقاف" : "تفعيل"}</button>
      </div>
    </div>`
    )
    .join("");
}

function copyLink(name) {
  navigator.clipboard.writeText(
    'loadstring(game:HttpGet("' + location.origin + "/" + name + '/raw"))()'
  );
}

async function toggleKill(name) {
  await fetch("/api/scripts/" + name + "/kill", { method: "POST" });
  loadMine();
}

loadMine();
