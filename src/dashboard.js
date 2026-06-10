// Analytics dashboard / big screen (§5). Hand-rolled lightweight SVG charts —
// no chart library, so it stays fully offline and adds nothing to the bundle.
// Panels: totals, check-in heatmap + streak, daily volume, level progress rings,
// accuracy-over-rounds, wrong-answer distribution, time-of-day ("when you learn best").

import { getAllStudyLog, getAllWrong, getAllFavoriteIds, deleteStudyLog, markKnown, getCourseRound, setCourseRound } from "./db.js";
import { orderedCourses, findList, cardListId, loadCardsByIds } from "./deck.js";
import { statsByList, courseProgress, logListId, logAcc } from "./progress.js";
import { getSettings } from "./settings.js";

// Chart palette — overwritten from the active theme's CSS variables on render.
let ACCENT = "#6b8e6b";
let WARN = "#c98b85";
let HEAT = ["#ece7df", "#cfe0cf", "#a9c8a9", "#83ad83", "#5e8c5e"];
let TEXT = "#2b2b2b";
let MUTED = "#8a8278";

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
}

function pad(n) {
  return String(n).padStart(2, "0");
}
function ymd(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function fmtDateTime(ts) {
  const d = new Date(ts);
  return `${ymd(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function cardLabel(c) {
  return c ? c.front + (c.reading ? ` (${c.reading})` : "") : "";
}
function cardMeaning(c) {
  return c ? c.meaning_en || c.meaning_zh || c.meaning_ja || "" : "";
}

// --- interactive chart tooltip (a floating div that follows the cursor) ---
let _tip = null;
function tipEl() {
  if (!_tip) {
    _tip = document.createElement("div");
    _tip.className = "chart-tip";
    _tip.style.display = "none";
    document.body.appendChild(_tip);
  }
  return _tip;
}
// Delegate hover over any [data-tip] element inside `container`.
function bindTips(container) {
  const tip = tipEl();
  container.addEventListener("mousemove", (e) => {
    const t = e.target.closest ? e.target.closest("[data-tip]") : null;
    if (!t) {
      tip.style.display = "none";
      return;
    }
    tip.textContent = t.getAttribute("data-tip");
    tip.style.display = "block";
    const pad = 14;
    const r = tip.getBoundingClientRect();
    let x = e.clientX + pad;
    let y = e.clientY + pad;
    if (x + r.width > window.innerWidth) x = e.clientX - r.width - pad;
    if (y + r.height > window.innerHeight) y = e.clientY - r.height - pad;
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  });
  container.addEventListener("mouseleave", () => {
    tip.style.display = "none";
  });
}
function acc(known, unknown) {
  const t = known + unknown;
  return t ? known / t : 0;
}

function svg(w, h, inner, cls) {
  const wrap = el("div", cls || "chart");
  wrap.innerHTML = `<svg viewBox="0 0 ${w} ${h}" width="100%" style="max-width:${w}px;height:auto">${inner}</svg>`;
  return wrap;
}

function panel(title, ...content) {
  const p = el("section", "dash-panel");
  p.appendChild(el("h3", "dash-panel__title", title));
  content.forEach((c) => c && p.appendChild(c));
  return p;
}

// --- individual charts ---------------------------------------------------

function totals(stats) {
  const grid = el("div", "totals");
  const items = [
    ["Lists studied", stats.listsStudied],
    ["Mastered", stats.mastered],
    ["Total tests", stats.totalTests],
    ["Cards seen", stats.cardsSeen],
    ["Favorites", stats.favorites],
    ["Wrong book", stats.wrongCount],
    ["Day streak", stats.streak],
  ];
  items.forEach(([label, value]) => {
    const box = el("div", "totals__item");
    box.appendChild(el("div", "totals__value", String(value)));
    box.appendChild(el("div", "totals__label", label));
    grid.appendChild(box);
  });
  return grid;
}

function stat(label, value, cls) {
  const box = el("div", `stat ${cls || ""}`);
  box.appendChild(el("div", "stat__value", String(value)));
  box.appendChild(el("div", "stat__label", label));
  return box;
}

const TRASH = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m19 6-1 14H6L5 6"/></svg>';

// "Now studying": the most recently tested list + its accuracy curve over tests.
function focusPanel(logs, statMap, manifest) {
  if (!logs.length) return null;
  const recent = logs.slice().sort((a, b) => (a.timestamp || "").localeCompare(b.timestamp || "")).pop();
  const lid = logListId(recent);
  const meta = findList(manifest, lid);
  const e = statMap.get(lid);
  const accs = e ? e.tests.map((t) => t.acc) : [logAcc(recent)];
  const labels = e ? e.tests.map((t) => t.date) : [recent.date || ""];
  const latest = Math.round((accs[accs.length - 1] || 0) * 100);
  const box = el("div");
  box.appendChild(el("div", "focus__name", meta ? `${meta.course} · ${meta.list_name}` : lid));
  box.appendChild(el("div", "focus__meta", `${e ? e.count : 1} test(s) · latest ${latest}%`));
  box.appendChild(lineChart(accs, labels));
  return box;
}

async function showResultModal(rec) {
  const total = rec.cards_seen ?? (rec.known || 0) + (rec.unknown || 0);
  const a = total ? Math.round((rec.known || 0) / total * 100) : 0;
  const secs = rec.total_ms ? ` · ${Math.round(rec.total_ms / 1000)}s` : "";
  const overlay = el("div", "modal");
  const card = el("div", "modal__card modal__card--wide");
  card.appendChild(el("div", "modal__title", rec.title || "Test result"));
  card.appendChild(el("p", "modal__text", `${fmtDateTime(rec.timestamp)}${secs}`));
  const stats = el("div", "quiz-summary__stats");
  stats.append(
    stat("Total", total),
    stat("Known", rec.known || 0, "stat--known"),
    stat("Unknown", rec.unknown || 0, "stat--unknown"),
    stat("Accuracy", `${a}%`),
  );
  card.appendChild(stats);

  const missedHost = el("div");
  const ids = rec.wrong_ids || [];
  if (ids.length) {
    missedHost.appendChild(el("h3", "quiz-missed__title", `Missed (${ids.length})`));
    missedHost.appendChild(el("p", "modal__text", "Loading words…"));
  }
  card.appendChild(missedHost);

  const btns = el("div", "modal__btns");
  const close = el("button", "btn", "Close");
  close.addEventListener("click", () => overlay.remove());
  btns.appendChild(close);
  card.appendChild(btns);
  overlay.appendChild(card);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
  document.body.appendChild(overlay);

  if (ids.length) {
    const cards = await loadCardsByIds(ids).catch(() => []);
    missedHost.replaceChildren(el("h3", "quiz-missed__title", `Missed (${cards.length})`));
    const listEl = el("div", "quiz-missed");
    cards.forEach((c) => {
      const row = el("div", "quiz-missed__row");
      const text = el("div", "quiz-missed__text");
      text.appendChild(el("span", "quiz-missed__jp", c.front));
      if (c.reading) text.appendChild(el("span", "quiz-missed__reading", c.reading));
      text.appendChild(el("span", "quiz-missed__mean", cardMeaning(c)));
      row.appendChild(text);
      listEl.appendChild(row);
    });
    missedHost.appendChild(listEl);
  }
}

function historyPanel(logs, manifest) {
  const box = el("div", "history");
  const recent = logs.slice().sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 40);
  if (!recent.length) {
    box.appendChild(el("p", "muted", "No tests yet."));
    return box;
  }
  recent.forEach((l) => {
    const total = l.cards_seen ?? (l.known || 0) + (l.unknown || 0);
    const a = total ? Math.round((l.known || 0) / total * 100) : 0;
    const titleText =
      l.title ||
      (l.lists_studied && l.lists_studied[0]
        ? findList(manifest, l.lists_studied[0])?.list_name || l.lists_studied[0]
        : "Session");
    const row = el("div", "hist-row");
    const info = el("div", "hist-row__info");
    info.appendChild(el("div", "hist-row__title", titleText));
    info.appendChild(el("div", "hist-row__meta", `${fmtDateTime(l.timestamp)} · ✓${l.known || 0} ✗${l.unknown || 0} · ${a}%`));
    info.addEventListener("click", () => showResultModal(l));
    const del = el("button", "icon-btn");
    del.title = "Delete record";
    del.innerHTML = TRASH;
    del.addEventListener("click", async (e) => {
      e.stopPropagation();
      const n = (l.wrong_ids || []).length;
      const msg = n
        ? `Delete this test record? Its ${n} wrong word(s) will be decremented in the wrong book.`
        : "Delete this test record?";
      if (!confirm(msg)) return;
      // Reverse the wrong-book additions this test made (−1 each, removed at 0).
      for (const id of l.wrong_ids || []) await markKnown(id);
      await deleteStudyLog(l.timestamp);
      row.remove();
    });
    row.append(info, del);
    box.appendChild(row);
  });
  return box;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAY = { 1: "Mon", 3: "Wed", 5: "Fri" };

// GitHub-contribution-graph style: weeks as columns, days as rows (Sun→Sat),
// month labels on top, weekday labels on the left, per-day count on hover.
function heatmap(dateCounts) {
  const weeks = 26;
  const cell = 12;
  const gap = 3;
  const step = cell + gap;
  const padL = 26; // room for weekday labels
  const padT = 16; // room for month labels
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setDate(start.getDate() - ((weeks - 1) * 7 + today.getDay())); // a Sunday
  let max = 1;
  Object.values(dateCounts).forEach((v) => (max = Math.max(max, v)));

  let cells = "";
  let monthLabels = "";
  let lastMonth = -1;
  for (let w = 0; w < weeks; w++) {
    const colDate = new Date(start);
    colDate.setDate(start.getDate() + w * 7);
    if (colDate.getMonth() !== lastMonth) {
      lastMonth = colDate.getMonth();
      monthLabels += `<text x="${padL + w * step}" y="${padT - 5}" font-size="9" fill="${MUTED}">${MONTHS[lastMonth]}</text>`;
    }
    for (let d = 0; d < 7; d++) {
      const dt = new Date(start);
      dt.setDate(start.getDate() + w * 7 + d);
      if (dt > today) continue;
      const key = ymd(dt);
      const v = dateCounts[key] || 0;
      const lvl = v === 0 ? 0 : v < max * 0.25 ? 1 : v < max * 0.5 ? 2 : v < max * 0.75 ? 3 : 4;
      const x = padL + w * step;
      const y = padT + d * step;
      cells += `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="2.5" fill="${HEAT[lvl]}" data-tip="${escapeXml(`${key} · ${v} card${v === 1 ? "" : "s"}`)}"/>`;
    }
  }
  let weekdayLabels = "";
  for (const [d, name] of Object.entries(WEEKDAY)) {
    weekdayLabels += `<text x="0" y="${padT + (+d) * step + cell - 2}" font-size="9" fill="${MUTED}">${name}</text>`;
  }
  // legend: less → more
  const legY = padT + 7 * step + 6;
  let legend = `<text x="${padL}" y="${legY + 9}" font-size="9" fill="${MUTED}">Less</text>`;
  for (let i = 0; i < 5; i++) {
    legend += `<rect x="${padL + 30 + i * (cell + 2)}" y="${legY}" width="${cell}" height="${cell}" rx="2.5" fill="${HEAT[i]}"/>`;
  }
  legend += `<text x="${padL + 30 + 5 * (cell + 2) + 4}" y="${legY + 9}" font-size="9" fill="${MUTED}">More</text>`;
  return svg(padL + weeks * step, padT + 7 * step + 20, monthLabels + weekdayLabels + cells + legend);
}

function dailyVolume(dateCounts, n = 14) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const w = 340;
  const h = 110;
  const padL = 22;
  const padT = 8;
  const padB = 16;
  const bw = (w - padL) / n;
  let max = 1;
  const vals = [];
  for (let i = n - 1; i >= 0; i--) {
    const dt = new Date(today);
    dt.setDate(today.getDate() - i);
    const v = dateCounts[ymd(dt)] || 0;
    vals.push([ymd(dt), v]);
    max = Math.max(max, v);
  }
  const plotH = h - padT - padB;
  // axes: baseline + y max/0 labels (cards), x first/last date
  let axis =
    `<line x1="${padL}" y1="${h - padB}" x2="${w}" y2="${h - padB}" stroke="${HEAT[0]}"/>` +
    `<text x="${padL - 4}" y="${padT + 8}" font-size="9" text-anchor="end" fill="${MUTED}">${max}</text>` +
    `<text x="${padL - 4}" y="${h - padB}" font-size="9" text-anchor="end" fill="${MUTED}">0</text>` +
    `<text x="${padL}" y="${h - 3}" font-size="9" fill="${MUTED}">${vals[0][0].slice(5)}</text>` +
    `<text x="${w}" y="${h - 3}" font-size="9" text-anchor="end" fill="${MUTED}">${vals[n - 1][0].slice(5)}</text>`;
  let bars = "";
  vals.forEach(([key, v], i) => {
    const bh = (v / max) * plotH;
    const x = padL + i * bw + 1.5;
    bars += `<rect x="${x.toFixed(1)}" y="${(h - padB - bh).toFixed(1)}" width="${(bw - 3).toFixed(1)}" height="${bh.toFixed(1)}" rx="2" fill="${ACCENT}" opacity="${v ? 0.9 : 0.15}" data-tip="${escapeXml(`${key} · ${v} cards`)}"/>`;
  });
  return svg(w, h, axis + bars);
}

function progressRing(studied, total, label) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const frac = total ? studied / total : 0;
  const cx = 34;
  const cy = 34;
  const inner =
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${HEAT[0]}" stroke-width="7"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${ACCENT}" stroke-width="7" stroke-linecap="round" stroke-dasharray="${(c * frac).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 ${cx} ${cy})"/>` +
    `<text x="${cx}" y="${cy + 4}" text-anchor="middle" font-size="13" font-weight="700" fill="${TEXT}">${Math.round(frac * 100)}%</text>` +
    `<circle cx="${cx}" cy="${cy}" r="${r + 4}" fill="transparent" data-tip="${escapeXml(`${label}: ${studied}/${total} · ${Math.round(frac * 100)}%`)}"/>`;
  const box = el("div", "ring");
  box.appendChild(svg(68, 68, inner));
  box.appendChild(el("div", "ring__label", label));
  box.appendChild(el("div", "ring__sub", `${studied}/${total}`));
  return box;
}

// values: accuracies 0..1. labels[i]: optional string (e.g. a date) for tooltips.
function lineChart(values, labels, w = 320, h = 112) {
  if (!values.length) return el("p", "muted", "Not enough data yet.");
  const padL = 26;
  const padR = 8;
  const padT = 8;
  const padB = 18;
  const n = values.length;
  const x = (i) => (n > 1 ? padL + (i * (w - padL - padR)) / (n - 1) : (padL + w - padR) / 2);
  const y = (v) => padT + (1 - v) * (h - padT - padB);
  // y gridlines + labels at 0 / 50 / 100 %
  let axis = "";
  [0, 0.5, 1].forEach((g) => {
    axis +=
      `<line x1="${padL}" y1="${y(g).toFixed(1)}" x2="${w - padR}" y2="${y(g).toFixed(1)}" stroke="${HEAT[0]}"${g === 0 ? "" : ' stroke-dasharray="3 3"'}/>` +
      `<text x="${padL - 4}" y="${(y(g) + 3).toFixed(1)}" font-size="9" text-anchor="end" fill="${MUTED}">${Math.round(g * 100)}%</text>`;
  });
  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const dots = values
    .map((v, i) => {
      const lab = labels && labels[i] ? `${labels[i]} · ` : `#${i + 1} · `;
      return `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="3" fill="${ACCENT}" data-tip="${escapeXml(lab + Math.round(v * 100) + "% accuracy")}"/>`;
    })
    .join("");
  // x labels: first & last (e.g. dates)
  let xlab = "";
  if (labels && labels.length) {
    xlab += `<text x="${padL}" y="${h - 5}" font-size="9" fill="${MUTED}">${escapeXml(labels[0] || "")}</text>`;
    if (n > 1) xlab += `<text x="${w - padR}" y="${h - 5}" font-size="9" text-anchor="end" fill="${MUTED}">${escapeXml(labels[n - 1] || "")}</text>`;
  } else {
    xlab = `<text x="${(padL + w - padR) / 2}" y="${h - 5}" font-size="9" text-anchor="middle" fill="${MUTED}">tests →</text>`;
  }
  return svg(w, h, `${axis}<polyline fill="none" stroke="${ACCENT}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" points="${pts}"/>${dots}${xlab}`);
}

function hbars(rows, w = 340) {
  if (!rows.length) return el("p", "muted", "No wrong answers — nothing here.");
  const rowH = 24;
  const h = rows.length * rowH;
  const max = Math.max(...rows.map((r) => r.value), 1);
  const labelW = 120;
  let inner = "";
  rows.forEach((r, i) => {
    const bw = (r.value / max) * (w - labelW - 30);
    const y = i * rowH;
    inner +=
      `<text x="0" y="${y + 15}" font-size="11" fill="${MUTED}">${escapeXml(r.label)}</text>` +
      `<rect x="${labelW}" y="${y + 4}" width="${bw}" height="14" rx="3" fill="${WARN}" data-tip="${escapeXml(`${r.label} · ${r.value} wrong`)}"/>` +
      `<text x="${labelW + bw + 5}" y="${y + 15}" font-size="11" fill="${MUTED}">${r.value}</text>`;
  });
  return svg(w, h, inner);
}

function timeOfDay(byHour) {
  const w = 360;
  const h = 120;
  const bw = w / 24;
  let maxVol = 1;
  for (let i = 0; i < 24; i++) maxVol = Math.max(maxVol, byHour[i].cards);
  let bars = "";
  let line = [];
  for (let i = 0; i < 24; i++) {
    const v = byHour[i].cards;
    const a = acc(byHour[i].known, byHour[i].unknown);
    const bh = (v / maxVol) * (h - 24);
    const tip = v ? `${i}:00–${i + 1}:00 · ${v} cards · ${Math.round(a * 100)}% accuracy` : `${i}:00–${i + 1}:00 · no study`;
    bars += `<rect x="${i * bw + 1}" y="${h - 16 - bh}" width="${bw - 2}" height="${bh}" rx="1.5" fill="${ACCENT}" opacity="${v ? 0.8 : 0.12}" data-tip="${escapeXml(tip)}"/>`;
    if (v) line.push(`${(i * bw + bw / 2).toFixed(1)},${(16 + (1 - a) * (h - 40)).toFixed(1)}`);
    if (i % 6 === 0) bars += `<text x="${i * bw}" y="${h - 3}" font-size="9" fill="${MUTED}">${i}h</text>`;
  }
  const accLine = line.length > 1 ? `<polyline fill="none" stroke="${WARN}" stroke-width="1.4" points="${line.join(" ")}"/>` : "";
  return svg(w, h, bars + accLine);
}

function escapeXml(s) {
  return String(s).replace(/[<&>"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" })[c]);
}

// --- main render ---------------------------------------------------------

function applyPalette() {
  const cs = getComputedStyle(document.documentElement);
  ACCENT = cs.getPropertyValue("--chart-accent").trim() || ACCENT;
  WARN = cs.getPropertyValue("--chart-warn").trim() || WARN;
  TEXT = cs.getPropertyValue("--text").trim() || TEXT;
  MUTED = cs.getPropertyValue("--muted").trim() || MUTED;
  HEAT = [0, 1, 2, 3, 4].map((i) => cs.getPropertyValue("--heat" + i).trim() || HEAT[i]);
}

export async function renderDashboard(app, manifest) {
  applyPalette();
  app.replaceChildren();
  const back = el("a", "btn btn--ghost", "← Home");
  back.href = "#/";
  app.appendChild(back);
  app.appendChild(el("h1", "dash-title", "Dashboard"));
  app.appendChild(el("p", "loading", "Loading…"));

  const [logs, wrong, favIds] = await Promise.all([
    getAllStudyLog().catch(() => []),
    getAllWrong().catch(() => []),
    getAllFavoriteIds().catch(() => []),
  ]);
  const statMap = statsByList(logs);
  const threshold = getSettings().roundThreshold || 0.9;

  app.replaceChildren();
  app.appendChild(back);
  app.appendChild(el("h1", "dash-title", "Dashboard"));

  if (!logs.length) {
    app.appendChild(el("p", "hint", "No study data yet — run a self-test to start tracking your progress."));
    return;
  }

  // aggregates
  const dateCounts = {};
  const byHour = Array.from({ length: 24 }, () => ({ cards: 0, known: 0, unknown: 0 }));
  let cardsSeen = 0;
  logs.forEach((l) => {
    dateCounts[l.date] = (dateCounts[l.date] || 0) + (l.cards_seen || 0);
    cardsSeen += l.cards_seen || 0;
    const hr = l.hour ?? new Date(l.timestamp).getHours();
    byHour[hr].cards += l.cards_seen || 0;
    byHour[hr].known += l.known || 0;
    byHour[hr].unknown += l.unknown || 0;
  });

  // streak (consecutive days up to today/yesterday with study)
  let streak = 0;
  {
    const day = new Date();
    day.setHours(0, 0, 0, 0);
    if (!dateCounts[ymd(day)]) day.setDate(day.getDate() - 1);
    while (dateCounts[ymd(day)]) {
      streak++;
      day.setDate(day.getDate() - 1);
    }
  }

  const totalTests = logs.length;
  const wrongCount = wrong.reduce((n, r) => n + (r.wrong_count || 0), 0);
  let mastered = 0;
  for (const e of statMap.values()) if (e.bestAcc >= threshold) mastered++;
  const stats = {
    listsStudied: statMap.size,
    mastered,
    totalTests,
    cardsSeen,
    favorites: favIds.length,
    wrongCount,
    streak,
  };

  const grid = el("div", "dash-grid");

  grid.appendChild(panel("Totals", totals(stats)));
  const focus = focusPanel(logs, statMap, manifest);
  if (focus) grid.appendChild(panel("Now studying", focus));
  grid.appendChild(panel(`Check-in · ${streak}-day streak`, heatmap(dateCounts)));
  grid.appendChild(panel("Daily volume (last 14 days)", dailyVolume(dateCounts)));

  // level progress rings
  const courses = orderedCourses(manifest);
  const studiedSet = new Set(statMap.keys());
  const rings = el("div", "rings");
  courses.forEach((c) => {
    const studied = c.lists.filter((l) => studiedSet.has(l.list_id)).length;
    rings.appendChild(progressRing(studied, c.lists.length, c.name));
  });
  grid.appendChild(panel("Level progress", rings));

  // accuracy over sessions (last 30)
  const recentSessions = logs
    .slice()
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    .slice(-30);
  const sessionAcc = recentSessions.map((l) => acc(l.known, l.unknown));
  const sessionLabels = recentSessions.map((l) => l.date || "");
  grid.appendChild(panel("Accuracy over sessions", lineChart(sessionAcc, sessionLabels)));

  // wrong distribution by list (top 8)
  const wrongByList = {};
  wrong.forEach((rec) => {
    const lid = cardListId(rec.word_id);
    if (!lid) return;
    wrongByList[lid] = (wrongByList[lid] || 0) + (rec.wrong_count || 0);
  });
  const wrongRows = Object.entries(wrongByList)
    .map(([lid, value]) => {
      const meta = findList(manifest, lid);
      return { label: meta ? `${meta.course} ${meta.list_name}` : lid, value };
    })
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);
  grid.appendChild(panel("Wrong-answer distribution", hbars(wrongRows)));

  // most-missed individual words (load the actual cards)
  const topWrong = wrong
    .slice()
    .sort((x, y) => (y.wrong_count || 0) - (x.wrong_count || 0))
    .slice(0, 12);
  if (topWrong.length) {
    const cards = await loadCardsByIds(topWrong.map((w) => w.word_id)).catch(() => []);
    const cmap = new Map(cards.map((c) => [c.id, c]));
    const box = el("div", "wordstat");
    topWrong.forEach((w) => {
      const c = cmap.get(w.word_id);
      const row = el("div", "wordstat__row");
      const text = el("div", "wordstat__text");
      text.appendChild(el("span", "wordstat__jp", cardLabel(c) || w.word_id));
      text.appendChild(el("span", "wordstat__mean", cardMeaning(c)));
      row.appendChild(text);
      row.appendChild(el("span", "wordstat__count", `×${w.wrong_count || 0}`));
      box.appendChild(row);
    });
    const wp = panel("Most-missed words", box);
    grid.appendChild(wp);
  }

  // time of day
  let bestHour = -1;
  let bestAcc = -1;
  let bestVol = 0;
  byHour.forEach((b, i) => {
    if (b.cards >= 5) {
      const a = acc(b.known, b.unknown);
      if (a > bestAcc || (a === bestAcc && b.cards > bestVol)) {
        bestAcc = a;
        bestHour = i;
        bestVol = b.cards;
      }
    }
  });
  const todPanel = panel("When you learn best", timeOfDay(byHour));
  todPanel.appendChild(
    el(
      "p",
      "dash-note",
      bestHour >= 0
        ? `Best hour: ${bestHour}:00–${bestHour + 1}:00 · ${Math.round(bestAcc * 100)}% accuracy. Bars = volume, red line = accuracy.`
        : "Study more to reveal your best hours. Bars = volume, red line = accuracy.",
    ),
  );
  grid.appendChild(todPanel);

  // Test history (full width): open each result, or delete it.
  const hp = panel("Test history", historyPanel(logs, manifest));
  hp.classList.add("dash-panel--wide");
  grid.appendChild(hp);

  bindTips(grid);
  app.appendChild(grid);
}

// --- per-course page (dashboard + wrong book scoped to one course) -------

function courseTiles(items) {
  const grid = el("div", "totals");
  items.forEach(([label, value]) => {
    const box = el("div", "totals__item");
    box.appendChild(el("div", "totals__value", String(value)));
    box.appendChild(el("div", "totals__label", label));
    grid.appendChild(box);
  });
  return grid;
}

export async function renderCourse(app, manifest, courseName) {
  applyPalette();
  const back = el("a", "btn btn--ghost", "← Home");
  back.href = "#/";
  app.replaceChildren(el("p", "loading", "Loading…"));

  const course = orderedCourses(manifest).find((c) => c.name === courseName);
  if (!course) {
    app.replaceChildren(back, el("p", "error", `Course not found: ${courseName}`));
    return;
  }
  const listIds = new Set(course.lists.map((l) => l.list_id));
  const threshold = getSettings().roundThreshold || 0.9;

  const [allWrong, allLogs, round] = await Promise.all([
    getAllWrong().catch(() => []),
    getAllStudyLog().catch(() => []),
    getCourseRound(courseName).catch(() => 1),
  ]);
  const wrong = allWrong.filter((w) => (cardListId(w.word_id) || "").replace(/-list\d+$/, "") === courseName);
  const logs = allLogs.filter((l) => listIds.has(logListId(l)));
  const statMap = statsByList(logs);
  const gate = courseProgress(course.lists, logs, round, threshold);
  const testedThisRound = gate.perList.filter((p) => p.tested).length;
  const passedThisRound = gate.perList.filter((p) => p.passed).length;

  // Header: back (left) · course name (center) · wrong book (right).
  const wb = el("a", "btn course-head__wb", `✗ Wrong book (${wrong.length})`);
  wb.href = `#/wrong/${encodeURIComponent(courseName)}`;
  const header = el("div", "course-head");
  header.append(back, el("h1", "dash-title course-head__title", `${courseName} · Round ${round}`), wb);
  app.replaceChildren(header);

  // Round panel: progress toward advancing + the manual Next-round button.
  const roundBox = el("div");
  roundBox.appendChild(
    el(
      "p",
      "round-status",
      `${passedThisRound}/${course.lists.length} lists pass (≥${Math.round(threshold * 100)}% last test) · ${testedThisRound}/${course.lists.length} tested.`,
    ),
  );
  const nextBtn = el("button", "btn", `Advance to Round ${round + 1} →`);
  nextBtn.disabled = !gate.canAdvance;
  if (!gate.canAdvance) {
    nextBtn.title = "Test every list and reach the threshold on each to unlock.";
  }
  nextBtn.addEventListener("click", async () => {
    if (!confirm(`Finish Round ${round} and start Round ${round + 1}? Per-list test counts reset; history is kept.`)) return;
    await setCourseRound(courseName, round + 1);
    renderCourse(app, manifest, courseName);
  });
  roundBox.appendChild(nextBtn);
  if (!gate.canAdvance) {
    roundBox.appendChild(el("p", "round-hint", "Each list must be tested this round with its last test at or above the threshold."));
  }

  const grid = el("div", "dash-grid");
  grid.appendChild(panel(`Round ${round}`, roundBox));

  const cardsSeen = logs.reduce((n, l) => n + (l.cards_seen || 0), 0);
  let mastered = 0;
  for (const e of statMap.values()) if (e.bestAcc >= threshold) mastered++;
  grid.appendChild(
    panel(
      "Totals",
      courseTiles([
        ["Tested this round", `${testedThisRound}/${course.lists.length}`],
        ["Passing", `${passedThisRound}/${course.lists.length}`],
        ["Mastered (best)", mastered],
        ["Tests logged", logs.length],
        ["Wrong words", wrong.length],
      ]),
    ),
  );

  const rings = el("div", "rings");
  rings.appendChild(progressRing(testedThisRound, course.lists.length, "Tested"));
  rings.appendChild(progressRing(passedThisRound, course.lists.length, "Passing"));
  grid.appendChild(panel("This round", rings));

  // accuracy over this course's tests (chronological)
  const sorted = logs.slice().sort((a, b) => (a.timestamp || "").localeCompare(b.timestamp || "")).slice(-40);
  const accs = sorted.map((l) => logAcc(l));
  const accLabels = sorted.map((l) => l.date || "");
  grid.appendChild(panel("Accuracy over tests", lineChart(accs, accLabels)));

  // wrong distribution by list (all-time, course)
  const byList = {};
  wrong.forEach((w) => {
    const lid = cardListId(w.word_id);
    if (lid) byList[lid] = (byList[lid] || 0) + (w.wrong_count || 0);
  });
  const rows = Object.entries(byList)
    .map(([lid, value]) => {
      const meta = findList(manifest, lid);
      return { label: meta ? meta.list_name : lid, value };
    })
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);
  grid.appendChild(panel("Wrong-answer distribution", hbars(rows)));

  // wrong book by round: All + each past/current round
  const wbBox = el("div", "round-links");
  const allLink = el("a", "btn btn--ghost", "All rounds");
  allLink.href = `#/wrong/${encodeURIComponent(courseName)}`;
  wbBox.appendChild(allLink);
  for (let r = 1; r <= round; r++) {
    const a = el("a", "btn btn--ghost", `Round ${r}`);
    a.href = `#/wrong/${encodeURIComponent(courseName)}/${r}`;
    wbBox.appendChild(a);
  }
  grid.appendChild(panel("Wrong book by round", wbBox));

  // per-list rows for this course (full width)
  const lst = el("div", "history");
  gate.perList.forEach((p) => {
    const e = statMap.get(p.list_id);
    const row = el("a", "hist-row hist-row--link");
    row.href = `#/list/${encodeURIComponent(p.list_id)}`;
    const info = el("div", "hist-row__info");
    const titleRow = el("div", "hist-row__title");
    titleRow.textContent = p.list_name;
    if (p.passed) titleRow.appendChild(el("span", "round-tick", " ✓"));
    info.appendChild(titleRow);
    const lastPct = Math.round(p.lastAcc * 100);
    const bestPct = e ? Math.round(e.bestAcc * 100) : 0;
    info.appendChild(
      el(
        "div",
        "hist-row__meta",
        p.tested
          ? `this round: ${p.count}× · last ${lastPct}%${p.passed ? " (pass)" : ` (need ≥${Math.round(threshold * 100)}%)`} · best ${bestPct}%`
          : "not tested this round",
      ),
    );
    row.appendChild(info);
    lst.appendChild(row);
  });
  const lp = panel("Lists", lst);
  lp.classList.add("dash-panel--wide");
  grid.appendChild(lp);

  bindTips(grid);
  app.appendChild(grid);
}
