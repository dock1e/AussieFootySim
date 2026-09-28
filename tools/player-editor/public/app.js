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

// ---------------------------------------------------------------------------------------------
// Round C156 — Grid view: an Excel-style spreadsheet of ALL players, sortable/filterable/ranked/
// heatmapped entirely client-side once loaded (one /api/players/all fetch, no server round-trip
// per sort/filter click — see this round's Schema.md note for why).
// ---------------------------------------------------------------------------------------------

const ALL_ATTRS = ATTRIBUTE_GROUPS.flatMap((g) => g.attrs); // reuses the same 20-attribute list/order as the single-player editor

const BASE_COLS = [
  { key: "name", label: "Name", kind: "text" },
  { key: "club", label: "Club", kind: "text" },
  { key: "archetype", label: "Archetype", kind: "text" },
  { key: "age", label: "Age", kind: "num" },
  { key: "OVR", label: "OVR", kind: "num" },
  { key: "POT", label: "POT", kind: "num" },
  { key: "realStatus", label: "Status", kind: "text" },
];
const ATTR_COLS = ALL_ATTRS.map((a) => ({ key: a, label: a, kind: "num", attr: true }));
const ALL_COLS = [...BASE_COLS, ...ATTR_COLS];

let gridData = null; // full unfiltered array from /api/players/all, loaded once
let gridLoaded = false;
let gridSort = { key: "OVR", dir: "desc" };
let gridFilters = { text: "", archetypes: new Set(), activeOnly: true };
let hiddenCols = new Set(); // column keys hidden via the column picker

function colValue(row, col) {
  return col.attr ? row.attributes[col.key] : row[col.key];
}

function ensureGridLoaded() {
  if (gridLoaded) return Promise.resolve();
  return api("/api/players/all").then((data) => {
    gridData = data;
    gridLoaded = true;
    buildArchetypeMenu();
    buildColumnPickerMenu();
    renderGrid();
  });
}

function buildArchetypeMenu() {
  const archetypes = [...new Set(gridData.map((r) => r.archetype))].sort();
  const menu = document.getElementById("archetypePickerMenu");
  menu.innerHTML = `
    <div class="picker-actions">
      <button type="button" id="archAll">All</button>
      <button type="button" id="archNone">None</button>
    </div>
    ${archetypes
      .map(
        (a) =>
          `<label><input type="checkbox" class="arch-cb" value="${a}" checked /> ${a}</label>`
      )
      .join("")}
  `;
  menu.querySelectorAll(".arch-cb").forEach((cb) => {
    cb.addEventListener("change", () => {
      updateArchetypeFilterFromMenu();
      renderGrid();
    });
  });
  document.getElementById("archAll").addEventListener("click", () => {
    menu.querySelectorAll(".arch-cb").forEach((cb) => (cb.checked = true));
    updateArchetypeFilterFromMenu();
    renderGrid();
  });
  document.getElementById("archNone").addEventListener("click", () => {
    menu.querySelectorAll(".arch-cb").forEach((cb) => (cb.checked = false));
    updateArchetypeFilterFromMenu();
    renderGrid();
  });
  updateArchetypeFilterFromMenu();
}

function updateArchetypeFilterFromMenu() {
  const menu = document.getElementById("archetypePickerMenu");
  const checked = [...menu.querySelectorAll(".arch-cb:checked")].map((cb) => cb.value);
  const total = menu.querySelectorAll(".arch-cb").length;
  // Empty selection or "all checked" both mean "no archetype filter applied" (league-wide).
  gridFilters.archetypes = checked.length === total ? new Set() : new Set(checked);
  const btn = document.getElementById("archetypePickerBtn");
  btn.textContent = gridFilters.archetypes.size === 0 ? "Archetypes ▾" : `Archetypes (${gridFilters.archetypes.size}) ▾`;
}

function buildColumnPickerMenu() {
  const menu = document.getElementById("columnPickerMenu");
  menu.innerHTML = `
    <div class="picker-actions">
      <button type="button" id="colAll">Show all</button>
    </div>
    ${ALL_COLS.map(
      (c) =>
        `<label><input type="checkbox" class="col-cb" value="${c.key}" ${hiddenCols.has(c.key) ? "" : "checked"} /> ${c.label}</label>`
    ).join("")}
  `;
  menu.querySelectorAll(".col-cb").forEach((cb) => {
    cb.addEventListener("change", () => {
      if (cb.checked) hiddenCols.delete(cb.value);
      else hiddenCols.add(cb.value);
      renderGrid();
    });
  });
  document.getElementById("colAll").addEventListener("click", () => {
    hiddenCols.clear();
    menu.querySelectorAll(".col-cb").forEach((cb) => (cb.checked = true));
    renderGrid();
  });
}

function visibleRows() {
  const q = gridFilters.text.trim().toLowerCase();
  return gridData.filter((r) => {
    if (gridFilters.activeOnly && !r.active) return false;
    if (gridFilters.archetypes.size > 0 && !gridFilters.archetypes.has(r.archetype)) return false;
    if (q && !(r.name.toLowerCase().includes(q) || r.club.toLowerCase().includes(q))) return false;
    return true;
  });
}

function sortedRows(rows) {
  const col = ALL_COLS.find((c) => c.key === gridSort.key) ?? ALL_COLS[0];
  const dir = gridSort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = colValue(a, col);
    const bv = colValue(b, col);
    if (col.kind === "num") return (av - bv) * dir;
    return String(av).localeCompare(String(bv)) * dir;
  });
}

/** Min/max per numeric column within the CURRENTLY FILTERED rows — the basis for both the
 * heatmap shading and (implicitly, via row position after sort) the rank column. Recomputed on
 * every render so it always reflects the active filter set, per the round brief. */
function computeRanges(rows) {
  const ranges = {};
  for (const col of ALL_COLS) {
    if (col.kind !== "num") continue;
    let min = Infinity;
    let max = -Infinity;
    for (const r of rows) {
      const v = colValue(r, col);
      if (v < min) min = v;
      if (v > max) max = v;
    }
    ranges[col.key] = { min, max };
  }
  return ranges;
}

function heatColor(v, range) {
  if (!isFinite(range.min) || !isFinite(range.max) || range.max === range.min) return "";
  const t = (v - range.min) / (range.max - range.min);
  const hue = t * 120; // 0 = red (low), 120 = green (high)
  return `background-color: hsl(${hue.toFixed(0)}, 55%, 20%);`;
}

function renderGrid() {
  if (!gridData) return;
  const filtered = visibleRows();
  const sorted = sortedRows(filtered);
  const ranges = computeRanges(filtered);
  const cols = ALL_COLS.filter((c) => !hiddenCols.has(c.key));

  document.getElementById("gridCount").textContent = `${filtered.length} / ${gridData.length} players shown, sorted by ${gridSort.key} (${gridSort.dir})`;

  const thead = document.querySelector("#gridTable thead");
  thead.innerHTML = `<tr><th>#</th>${cols
    .map(
      (c) =>
        `<th data-key="${c.key}" class="${c.key === gridSort.key ? "sorted" : ""}">${c.label}${
          c.key === gridSort.key ? (gridSort.dir === "asc" ? " ▲" : " ▼") : ""
        }</th>`
    )
    .join("")}</tr>`;
  thead.querySelectorAll("th[data-key]").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.key;
      if (gridSort.key === key) {
        gridSort.dir = gridSort.dir === "asc" ? "desc" : "asc";
      } else {
        const col = ALL_COLS.find((c) => c.key === key);
        gridSort = { key, dir: col.kind === "num" ? "desc" : "asc" };
      }
      renderGrid();
    });
  });

  const tbody = document.querySelector("#gridTable tbody");
  const rowsHtml = sorted.map((r, i) => {
    const cells = cols
      .map((c) => {
        const v = colValue(r, c);
        const style = c.kind === "num" ? heatColor(v, ranges[c.key]) : "";
        const cls = c.key === "name" ? ' class="name-cell"' : "";
        return `<td style="${style}"${cls}>${v}${c.key === "name" && r.attributeOverride ? ' <span class="flag">ovr</span>' : ""}</td>`;
      })
      .join("");
    return `<tr data-id="${r.id}"><td class="rank">${i + 1}</td>${cells}</tr>`;
  });
  tbody.innerHTML = rowsHtml.join("");
  tbody.querySelectorAll("tr").forEach((tr) => {
    tr.addEventListener("click", () => {
      const id = Number(tr.dataset.id);
      switchTab("editor");
      selectPlayer(id, null);
    });
  });
}

// --- Tabs ---
function switchTab(name) {
  const isGrid = name === "grid";
  document.getElementById("tabEditorBtn").classList.toggle("active", !isGrid);
  document.getElementById("tabGridBtn").classList.toggle("active", isGrid);
  document.getElementById("editorView").classList.toggle("active", !isGrid);
  document.getElementById("gridView").classList.toggle("active", isGrid);
  searchEl.style.display = isGrid ? "none" : "";
  if (isGrid) ensureGridLoaded();
}

document.getElementById("tabEditorBtn").addEventListener("click", () => switchTab("editor"));
document.getElementById("tabGridBtn").addEventListener("click", () => switchTab("grid"));

document.getElementById("gridSearch").addEventListener("input", (e) => {
  gridFilters.text = e.target.value;
  renderGrid();
});
document.getElementById("activeOnly").addEventListener("change", (e) => {
  gridFilters.activeOnly = e.target.checked;
  renderGrid();
});

document.getElementById("archetypePickerBtn").addEventListener("click", () => {
  document.getElementById("archetypePickerMenu").classList.toggle("open");
  document.getElementById("columnPickerMenu").classList.remove("open");
});
document.getElementById("columnPickerBtn").addEventListener("click", () => {
  document.getElementById("columnPickerMenu").classList.toggle("open");
  document.getElementById("archetypePickerMenu").classList.remove("open");
});
document.addEventListener("click", (e) => {
  if (!e.target.closest("#archetypePicker")) document.getElementById("archetypePickerMenu").classList.remove("open");
  if (!e.target.closest("#columnPicker")) document.getElementById("columnPickerMenu").classList.remove("open");
});
