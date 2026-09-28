// Round C155 — Player Editor client. Plain vanilla JS (no framework — this repo's own
// dependencies are React/Vite for the actual game bundle; a standalone admin tool has no need to
// pull those in, and this is simple enough not to warrant a new dependency).

const ATTRIBUTE_GROUPS = [
  {
    title: "Marking / contested",
    attrs: ["manMarking", "verticalLeap", "strengthOverhead", "strengthGroundLevel", "strengthManOnMan"],
  },
  {
    title: "Midfield / ball use",
    attrs: ["skill", "readPlay", "tenacity", "positioning", "kickMaxDistance"],
  },
  {
    title: "Athletic / physical",
    attrs: ["speed", "acceleration", "agility", "endurance"],
  },
  {
    title: "Mental / pressure / mongrel",
    attrs: ["courage", "aggression", "xFactor", "confidence", "consistancy", "copeWithPressure"],
  },
];

let currentPlayer = null; // full detail from /api/players/:id
let pendingChanges = {}; // attr -> new value
let debounceTimer = null;

const resultsEl = document.getElementById("results");
const editorEl = document.getElementById("editor");
const searchEl = document.getElementById("search");

async function api(path, opts) {
  const res = await fetch(path, opts);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

async function doSearch(q) {
  const results = await api(`/api/players?q=${encodeURIComponent(q)}`);
  resultsEl.innerHTML = "";
  for (const p of results) {
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = `<div class="name">${p.name}${p.attributeOverride ? '<span class="flag">override</span>' : ""}</div>
      <div class="meta">${p.club} · ${p.archetype} · Age ${p.age} · OVR ${p.OVR} / POT ${p.POT}</div>`;
    row.addEventListener("click", () => selectPlayer(p.id, row));
    resultsEl.appendChild(row);
  }
}

async function selectPlayer(id, rowEl) {
  document.querySelectorAll("#results .row").forEach((r) => r.classList.remove("active"));
  if (rowEl) rowEl.classList.add("active");
  currentPlayer = await api(`/api/players/${id}`);
  pendingChanges = {};
  renderEditor();
}

function renderEditor() {
  if (!currentPlayer) {
    editorEl.innerHTML = `<div class="empty">Search for a player to begin.</div>`;
    return;
  }
  const p = currentPlayer;
  editorEl.innerHTML = `
    <div class="readout">
      <div class="stat"><span class="label">${p.name}</span><span class="value" style="font-size:16px;font-weight:500;">${p.archetype} · ${p.club} · Age ${p.age}</span></div>
      <div class="stat"><span class="label">OVR</span><span class="value" id="ovrVal">${p.OVR}</span></div>
      <div class="stat"><span class="label">POT</span><span class="value" id="potVal">${p.POT}</span></div>
      <div class="stat"><span class="label">Career games</span><span class="value" style="font-size:16px;">${p.careerGames}</span></div>
      ${p.attributeOverride ? '<span class="flag">attributeOverride set — protected from future real-stat refreshes</span>' : ""}
    </div>
    <div id="groups"></div>
    <div class="actions">
      <button id="saveBtn" class="primary">Save</button>
      <button id="resetBtn">Reset changes</button>
      <span id="saveStatus"></span>
    </div>
  `;
  const groupsEl = document.getElementById("groups");
  for (const group of ATTRIBUTE_GROUPS) {
    const groupEl = document.createElement("div");
    groupEl.className = "group";
    groupEl.innerHTML = `<h3>${group.title}</h3>`;
    for (const attr of group.attrs) {
      const val = pendingChanges[attr] ?? p.attributes[attr];
      const row = document.createElement("div");
      row.className = "attr-row";
      row.innerHTML = `
        <label for="attr-${attr}">${attr}</label>
        <input type="range" id="attr-${attr}" min="40" max="110" step="1" value="${val}" />
        <span class="val" id="attr-${attr}-val">${val}</span>
      `;
      const input = row.querySelector("input");
      const valSpan = row.querySelector(".val");
      input.addEventListener("input", () => {
        valSpan.textContent = input.value;
        pendingChanges[attr] = Number(input.value);
        schedulePreview();
      });
      groupEl.appendChild(row);
    }
    groupsEl.appendChild(groupEl);
  }
  document.getElementById("saveBtn").addEventListener("click", doSave);
  document.getElementById("resetBtn").addEventListener("click", () => {
    pendingChanges = {};
    renderEditor();
  });
}

function schedulePreview() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(runPreview, 200);
}

async function runPreview() {
  if (!currentPlayer || Object.keys(pendingChanges).length === 0) return;
  try {
    const result = await api("/api/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: currentPlayer.id, changes: pendingChanges }),
    });
    updateReadout(result);
  } catch (err) {
    document.getElementById("saveStatus").textContent = `Preview error: ${err.message}`;
  }
}

function deltaSpan(before, after) {
  const d = after - before;
  const cls = d > 0 ? "up" : d < 0 ? "down" : "zero";
  const sign = d > 0 ? "+" : "";
  return `<span class="delta ${cls}">(${sign}${d})</span>`;
}

function updateReadout(result) {
  const ovrEl = document.getElementById("ovrVal");
  const potEl = document.getElementById("potVal");
  ovrEl.innerHTML = `${result.after.OVR} ${deltaSpan(currentPlayer.OVR, result.after.OVR)}`;
  potEl.innerHTML = `${result.after.POT} ${deltaSpan(currentPlayer.POT, result.after.POT)}`;
  if (result.shrinkageApplied) {
    document.getElementById("saveStatus").textContent = "Note: career-games shrinkage is pulling some of your edits back toward the archetype mean (see attribute values below vs. sliders).";
  } else {
    document.getElementById("saveStatus").textContent = "";
  }
}

async function doSave() {
  if (!currentPlayer) return;
  const statusEl = document.getElementById("saveStatus");
  statusEl.textContent = "Saving...";
  try {
    const { result, player } = await api("/api/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: currentPlayer.id, changes: pendingChanges }),
    });
    statusEl.textContent = `Saved. OVR ${currentPlayer.OVR} -> ${result.after.OVR}, POT ${currentPlayer.POT} -> ${result.after.POT}. attributeOverride set.`;
    currentPlayer = player;
    pendingChanges = {};
    renderEditor();
    document.getElementById("saveStatus").textContent = `Saved OK. OVR now ${player.OVR}, POT now ${player.POT}.`;
  } catch (err) {
    statusEl.textContent = `Save failed: ${err.message}`;
  }
}

let searchDebounce = null;
searchEl.addEventListener("input", () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => doSearch(searchEl.value), 150);
});

doSearch("");
