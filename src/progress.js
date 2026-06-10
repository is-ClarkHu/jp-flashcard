// Round/progress logic, derived entirely from study_log (one entry per finished
// self-test). A "round" belongs to a COURSE: every list must be tested at least
// once and each list's *last* test accuracy must reach the threshold before the
// user can advance to the next round. Past rounds stay in study_log for history.

export function courseOfList(listId) {
  const m = (listId || "").match(/^(.+)-list\d+$/);
  return m ? m[1] : "";
}

// The list a study_log entry belongs to (new entries carry list_id; old ones
// only have lists_studied).
export function logListId(l) {
  return l.list_id || (l.lists_studied && l.lists_studied[0]) || "";
}

export function logAcc(l) {
  const t = (l.known || 0) + (l.unknown || 0);
  return t ? (l.known || 0) / t : 0;
}

export function logRound(l) {
  return l.round || 1;
}

// Group every test by list. Returns Map(list_id -> { tests[], count, lastAcc,
// bestAcc, lastDate }), tests sorted oldest→newest.
export function statsByList(logs) {
  const map = new Map();
  logs.forEach((l) => {
    const lid = logListId(l);
    if (!lid) return;
    const e = map.get(lid) || { tests: [] };
    e.tests.push({ round: logRound(l), acc: logAcc(l), ts: l.timestamp, date: l.date || "", known: l.known || 0, unknown: l.unknown || 0 });
    map.set(lid, e);
  });
  for (const e of map.values()) {
    e.tests.sort((a, b) => (a.ts || "").localeCompare(b.ts || ""));
    e.count = e.tests.length;
    e.lastAcc = e.count ? e.tests[e.count - 1].acc : 0;
    e.bestAcc = e.tests.reduce((m, t) => Math.max(m, t.acc), 0);
    e.lastDate = e.count ? e.tests[e.count - 1].date : "";
  }
  return map;
}

// This-round status for one course. courseLists = [{list_id, list_name}].
export function courseProgress(courseLists, logs, round, threshold) {
  const byList = new Map();
  logs.forEach((l) => {
    if (logRound(l) !== round) return;
    const lid = logListId(l);
    if (!lid) return;
    const arr = byList.get(lid) || [];
    arr.push(l);
    byList.set(lid, arr);
  });
  const perList = courseLists.map((l) => {
    const arr = (byList.get(l.list_id) || []).slice().sort((a, b) => (a.timestamp || "").localeCompare(b.timestamp || ""));
    const lastAcc = arr.length ? logAcc(arr[arr.length - 1]) : 0;
    const tested = arr.length > 0;
    return { list_id: l.list_id, list_name: l.list_name, count: arr.length, lastAcc, tested, passed: tested && lastAcc >= threshold };
  });
  const allTested = perList.every((p) => p.tested);
  const allPassed = perList.every((p) => p.passed);
  return { perList, allTested, allPassed, canAdvance: allTested && allPassed };
}
