// AI explanation (§4.5), two layers + ZH/EN/JP switch + multi-provider.
//   Layer 1 — static brief from the vocab JSON (explain_zh/en/ja): offline, no key.
//   Layer 2 — on-demand deep-dive via the user's chosen provider, answered in the
//             current language, cached forever in IndexedDB ({id}:{lang}).
//
// Providers (browser direct calls; the key is the user's own, stored locally):
//   claude (Anthropic), openai (ChatGPT), gemini (Google), and three
//   OpenAI-compatible ones — deepseek, moonshot, mistral.
// Note: some providers may block direct browser CORS; if so, use the offline
// brief, or run the bulk `convert.py --explain` path (Python) instead.

import { getSettings, setSetting } from "./settings.js";
import { getExplainCache, putExplainCache } from "./db.js";

// Runtime "Explain deeper" defaults — chosen for explanation quality (occasional,
// you-want-it-good calls). All editable per provider in Settings.
export const EXPLAIN_PROVIDERS = [
  { id: "claude", label: "Claude", defaultModel: "claude-opus-4-8" },
  { id: "openai", label: "ChatGPT", defaultModel: "gpt-4o" },
  { id: "gemini", label: "Gemini", defaultModel: "gemini-2.5-pro" },
  { id: "deepseek", label: "DeepSeek", defaultModel: "deepseek-chat" },
  { id: "moonshot", label: "Moonshot", defaultModel: "moonshot-v1-32k" },
  { id: "mistral", label: "Mistral", defaultModel: "mistral-large-latest" },
];

const OPENAI_COMPAT = {
  openai: "https://api.openai.com/v1/chat/completions",
  deepseek: "https://api.deepseek.com/v1/chat/completions",
  moonshot: "https://api.moonshot.cn/v1/chat/completions",
  mistral: "https://api.mistral.ai/v1/chat/completions",
};

const LANGS = [
  ["zh", "中文"],
  ["en", "EN"],
  ["ja", "日本語"],
];
const LANG_NAME = { zh: "Chinese", en: "English", ja: "Japanese" };

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
}

export function providerMeta(id) {
  return EXPLAIN_PROVIDERS.find((p) => p.id === id) || EXPLAIN_PROVIDERS[0];
}

function escapeHtml(s) {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
}
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Inline markdown on already-HTML-escaped text: **bold**, *italic*, `code`.
function mdInline(s) {
  return s
    .replace(/\*\*([^*]+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+?)\*/g, "$1<em>$2</em>")
    .replace(/`([^`]+?)`/g, "<code>$1</code>");
}

// Minimal, safe Markdown -> HTML (escapes first; covers the shapes LLMs emit:
// headings, bullet/ordered lists, paragraphs, line breaks, inline emphasis/code).
function markdownToHtml(text) {
  const lines = escapeHtml(text).split("\n");
  const out = [];
  let para = [];
  let list = null;
  const flushPara = () => {
    if (para.length) out.push("<p>" + mdInline(para.join("<br>")) + "</p>");
    para = [];
  };
  const flushList = () => {
    if (list) {
      out.push(`<${list.type}>` + list.items.map((it) => "<li>" + mdInline(it) + "</li>").join("") + `</${list.type}>`);
      list = null;
    }
  };
  const isSep = (s) => s.includes("-") && /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(s);
  const cells = (s) => s.trim().replace(/^\||\|$/g, "").split("|").map((x) => x.trim());

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\s+$/, "");

    // Markdown table: a "| … |" row followed by a "| --- | --- |" separator.
    if (line.includes("|") && i + 1 < lines.length && isSep(lines[i + 1])) {
      flushPara();
      flushList();
      const header = cells(line);
      const rows = [];
      i += 2;
      while (i < lines.length && lines[i].trim() && lines[i].includes("|")) {
        rows.push(cells(lines[i]));
        i++;
      }
      i--;
      let t = "<table><thead><tr>" + header.map((h) => "<th>" + mdInline(h) + "</th>").join("") + "</tr></thead><tbody>";
      t += rows.map((r) => "<tr>" + r.map((c) => "<td>" + mdInline(c) + "</td>").join("") + "</tr>").join("");
      out.push(t + "</tbody></table>");
      continue;
    }

    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }
    let m;
    if ((m = line.match(/^#{1,6}\s+(.*)$/))) {
      flushPara();
      flushList();
      out.push("<p class='explain__h'>" + mdInline(m[1]) + "</p>");
    } else if ((m = line.match(/^\s*[-*•]\s+(.*)$/))) {
      flushPara();
      if (!list || list.type !== "ul") {
        flushList();
        list = { type: "ul", items: [] };
      }
      list.items.push(m[1]);
    } else if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
      flushPara();
      if (!list || list.type !== "ol") {
        flushList();
        list = { type: "ol", items: [] };
      }
      list.items.push(m[1]);
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return out.join("");
}

// Bold the headword / meaning inside rendered HTML by walking text nodes only
// (never touches tags, so it can't corrupt the markup).
function highlightDom(root, terms) {
  const uniq = [...new Set(terms.filter(Boolean))].sort((a, b) => b.length - a.length);
  if (!uniq.length) return;
  const re = new RegExp(uniq.map(escapeRegex).join("|"), "g");
  const nodes = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) nodes.push(n);
  for (const node of nodes) {
    if (node.parentElement && (node.parentElement.tagName === "CODE" || node.parentElement.tagName === "STRONG")) continue;
    const text = node.nodeValue;
    re.lastIndex = 0;
    if (!re.test(text)) continue;
    re.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let last = 0;
    let mm;
    while ((mm = re.exec(text))) {
      if (mm.index > last) frag.appendChild(document.createTextNode(text.slice(last, mm.index)));
      const strong = document.createElement("strong");
      strong.textContent = mm[0];
      frag.appendChild(strong);
      last = mm.index + mm[0].length;
      if (mm.index === re.lastIndex) re.lastIndex++;
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    node.parentNode.replaceChild(frag, node);
  }
}

// Render an explanation as Markdown into `parent`: nuance body + a styled
// example block (split on the "例：" line). The headword and its meaning are
// bolded inside the example.
function renderExplainText(parent, text, card, lang) {
  parent.replaceChildren();
  parent.classList.remove("muted");
  const terms = card ? [card.front, card.reading, card[`meaning_${lang}`]] : [];
  const idx = text.search(/(^|\n)\s*例\s*[：:]/);
  if (idx === -1) {
    const body = el("div", "explain__body");
    body.innerHTML = markdownToHtml(text.trim());
    parent.appendChild(body);
    return;
  }
  const bodyText = text.slice(0, idx).trim();
  const exampleText = text.slice(idx).replace(/^\s*\n/, "").trim();
  if (bodyText) {
    const body = el("div", "explain__body");
    body.innerHTML = markdownToHtml(bodyText);
    parent.appendChild(body);
  }
  const ex = el("div", "explain__example");
  ex.innerHTML = markdownToHtml(exampleText);
  highlightDom(ex, terms);
  parent.appendChild(ex);
}

function buildPrompt(card, lang) {
  const meaning = [card.meaning_en, card.meaning_zh, card.meaning_ja].filter(Boolean).join("; ");
  return (
    `You are a patient Japanese tutor. Explain the word for a learner, answering entirely in ${LANG_NAME[lang]}.\n\n` +
    `Word: ${card.front}\nReading: ${card.reading || "(none)"}\nKnown meaning: ${meaning || "(unknown)"}\n\n` +
    `Cover: core meaning and nuance, typical usage/register, 1–2 natural example sentences ` +
    `(with a translation), and any common confusions with similar words. Keep it concise.`
  );
}

async function postJSON(url, headers, body) {
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || data?.error || data?.message || `HTTP ${res.status}`;
    throw new Error(typeof msg === "string" ? msg : `HTTP ${res.status}`);
  }
  return data;
}

async function callProvider(pid, key, model, prompt) {
  if (pid === "claude") {
    const data = await postJSON(
      "https://api.anthropic.com/v1/messages",
      {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      { model, max_tokens: 1024, messages: [{ role: "user", content: prompt }] },
    );
    return (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
  }

  if (pid === "gemini") {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
    const data = await postJSON(
      url,
      { "content-type": "application/json" },
      { contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 1024 } },
    );
    const parts = data?.candidates?.[0]?.content?.parts || [];
    return parts.map((p) => p.text || "").join("").trim();
  }

  // OpenAI-compatible: openai / deepseek / moonshot / mistral
  const url = OPENAI_COMPAT[pid];
  const data = await postJSON(
    url,
    { "content-type": "application/json", authorization: `Bearer ${key}` },
    { model, max_tokens: 1024, messages: [{ role: "user", content: prompt }] },
  );
  return (data?.choices?.[0]?.message?.content || "").trim();
}

async function fetchDeep(card, lang) {
  const s = getSettings();
  const pid = s.explainProvider || "claude";
  const key = (s.apiKeys && s.apiKeys[pid]) || "";
  if (!key) throw new Error("NO_KEY");
  const model = (s.models && s.models[pid]) || providerMeta(pid).defaultModel;

  const text = await callProvider(pid, key, model, buildPrompt(card, lang));
  if (!text) throw new Error("Empty response");
  await putExplainCache(`${card.id}:${lang}`, text);
  return text;
}

// Build the explanation panel for one card.
export function createExplainPanel(card) {
  const panel = el("div", "explain");

  function render() {
    const lang = getSettings().explainLang;
    panel.replaceChildren();

    // language toggle (applies to both layers)
    const langs = el("div", "explain__langs");
    LANGS.forEach(([key, label]) => {
      const b = el("button", "chip" + (key === lang ? " chip--active" : ""), label);
      b.addEventListener("click", () => {
        setSetting("explainLang", key);
        render();
      });
      langs.appendChild(b);
    });
    panel.appendChild(langs);

    // Layer 1 — static brief
    const l1 = el("div", "explain__block");
    l1.appendChild(el("div", "explain__label", "Brief (offline)"));
    const staticText = card[`explain_${lang}`] || "";
    const l1text = el("div", "explain__text");
    if (staticText) {
      renderExplainText(l1text, staticText, card, lang);
    } else {
      l1text.classList.add("muted");
      l1text.textContent = "No offline explanation yet — generate with convert.py --explain.";
    }
    l1.appendChild(l1text);
    panel.appendChild(l1);

    // Layer 2 — deep dive
    const l2 = el("div", "explain__block");
    const head = el("div", "explain__l2head");
    head.appendChild(el("div", "explain__label", `Deep dive · ${providerMeta(getSettings().explainProvider).label}`));
    const btn = el("button", "btn btn--ghost explain__deepbtn", "Explain deeper");
    head.appendChild(btn);
    l2.appendChild(head);
    const out = el("div", "explain__text");
    l2.appendChild(out);
    panel.appendChild(l2);

    getExplainCache(`${card.id}:${lang}`).then((rec) => {
      if (rec && rec.text) {
        renderExplainText(out, rec.text, card, lang);
        btn.textContent = "Regenerate";
      }
    });

    btn.addEventListener("click", async () => {
      const s = getSettings();
      const pid = s.explainProvider || "claude";
      if (!(s.apiKeys && s.apiKeys[pid])) {
        out.replaceChildren();
        out.append(document.createTextNode(`Set your ${providerMeta(pid).label} API key in `));
        const a = el("a", null, "Settings");
        a.href = "#/settings";
        out.append(a, document.createTextNode(" to use deep explanations."));
        return;
      }
      btn.disabled = true;
      out.classList.remove("muted");
      out.textContent = "Thinking…";
      try {
        renderExplainText(out, await fetchDeep(card, lang), card, lang);
        btn.textContent = "Regenerate";
      } catch (e) {
        out.classList.add("muted");
        out.textContent = e.message === "NO_KEY" ? "Set your API key in Settings." : `Failed: ${e.message}`;
      } finally {
        btn.disabled = false;
      }
    });
  }

  render();
  return { element: panel };
}
