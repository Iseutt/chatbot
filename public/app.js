import { t } from "./i18n.js";
import {
  getSettings,
  saveSettings,
  getProject,
  updateProject,
  getCustomQuestions,
  setCustomQuestions,
  resetCustomQuestions,
} from "./storage.js";

// ── State ─────────────────────────────────────────────────────────────────────

let project = null;
let thread = [];
let currentLang = "fr";
let isLoading = false;

// Preload the company logo as a data-URL so jsPDF can embed it in the PDF.
let _logoDataUrl = null;
fetch("/logo-aj.png")
  .then((r) => r.blob())
  .then(
    (blob) =>
      new Promise((res) => {
        const fr = new FileReader();
        fr.onload = (e) => {
          _logoDataUrl = e.target.result;
          res();
        };
        fr.onerror = res; // ignore — fall back to geometric A
        fr.readAsDataURL(blob);
      })
  )
  .catch(() => {});

// ── Technical sheet questionnaire ─────────────────────────────────────────────

const DEFAULT_TECH_SHEET_QUESTIONS_FR = [
  {
    key: "moulure",
    label: "Nom de la moulure",
    question: "Quelle moulure souhaitez-vous utiliser ?",
    answers: ["Liner double", "Coin exterieur 3", "Coin exterieur 4", "Coin exterieur 45", "Facia 6"],
  },
  {
    key: "materiau",
    label: "Type de matériaux",
    question: "Quel type de matériau utilisez-vous ?",
    answers: ["Acier", "Aluminium"],
  },
  {
    key: "calibre",
    label: "Calibre",
    question: "Quel calibre souhaitez-vous ?",
    answers: ["22", "24", "26"],
  },
  {
    key: "couleur",
    label: "Couleur",
    question: "Quelle couleur voulez-vous ?",
    answers: ["Noir", "Blanc", "Gris", "Brun"],
  },
  {
    key: "vis",
    label: "Type de vis",
    question: "Quel type de vis utilisez-vous ?",
    answers: ["Auto-perceuse", "Vis colorée", "Vis standard"],
  },
];

const DEFAULT_TECH_SHEET_QUESTIONS_EN = [
  {
    key: "moulure",
    label: "Profile name",
    question: "Which profile would you like to use?",
    answers: ["Double Liner", "3\" Corner", "4\" Corner", "45° Corner", "6\" Fascia"],
  },
  {
    key: "materiau",
    label: "Material type",
    question: "Which material are you using?",
    answers: ["Steel", "Aluminum"],
  },
  {
    key: "calibre",
    label: "Gauge",
    question: "Which gauge would you like?",
    answers: ["22", "24", "26"],
  },
  {
    key: "couleur",
    label: "Color",
    question: "Which color do you want?",
    answers: ["Black", "White", "Grey", "Brown"],
  },
  {
    key: "vis",
    label: "Screw type",
    question: "Which type of screw are you using?",
    answers: ["Self-drilling", "Colored screw", "Standard screw"],
  },
];

function getDefaultQuestions(lang) {
  return lang === "en" ? DEFAULT_TECH_SHEET_QUESTIONS_EN : DEFAULT_TECH_SHEET_QUESTIONS_FR;
}

function cloneQuestions(list) {
  return list.map((q) => ({ key: q.key, question: q.question, label: q.label, answers: [...q.answers] }));
}

function getQuestions() {
  const defaults = getDefaultQuestions(currentLang);
  const custom = getCustomQuestions();
  if (!custom || !custom.length) return defaults;

  // Keep only structurally valid questions (key, question text, at least one answer).
  // If anything stored is malformed — e.g. from a failed earlier customization —
  // we silently drop it so renderChips never receives undefined/empty answers.
  const valid = custom.filter(
    (q) => q && q.key && q.question && Array.isArray(q.answers) && q.answers.length > 0
  );
  if (!valid.length) return defaults;

  // Back-fill labels from the current-language defaults for any matching key.
  const defaultLabels = new Map(defaults.map(q => [q.key, q.label]));
  return valid.map(q => ({ ...q, label: q.label || defaultLabels.get(q.key) }));
}

// ── Customization: pure list operations ───────────────────────────────────────

function _findQ(list, key) {
  return list.findIndex((q) => q.key === key);
}

function addOption(list, questionKey, value) {
  const i = _findQ(list, questionKey);
  if (i === -1) return { ok: false, reason: `question "${questionKey}" not found` };
  if (!value) return { ok: false, reason: "empty value" };
  if (list[i].answers.includes(value)) return { ok: false, reason: `"${value}" already exists` };
  list[i].answers.push(value);
  return { ok: true, question: list[i].question };
}

function removeOption(list, questionKey, value) {
  const i = _findQ(list, questionKey);
  if (i === -1) return { ok: false, reason: `question "${questionKey}" not found` };
  const idx = list[i].answers.indexOf(value);
  if (idx === -1) return { ok: false, reason: `"${value}" not in options` };
  list[i].answers.splice(idx, 1);
  return { ok: true, question: list[i].question };
}

function addQuestion(list, { key, question, answers }) {
  if (!key || !question || !Array.isArray(answers) || answers.length === 0) {
    return { ok: false, reason: "missing key/question/answers" };
  }
  if (_findQ(list, key) !== -1) return { ok: false, reason: `key "${key}" already exists` };
  list.push({ key, question, answers: [...answers] });
  return { ok: true };
}

function removeQuestion(list, questionKey) {
  const i = _findQ(list, questionKey);
  if (i === -1) return { ok: false, reason: `question "${questionKey}" not found` };
  const [removed] = list.splice(i, 1);
  return { ok: true, question: removed.question };
}

function renameQuestion(list, questionKey, newQuestion) {
  const i = _findQ(list, questionKey);
  if (i === -1) return { ok: false, reason: `question "${questionKey}" not found` };
  if (!newQuestion) return { ok: false, reason: "empty new question text" };
  const old = list[i].question;
  list[i].question = newQuestion;
  return { ok: true, old };
}

function renameOption(list, questionKey, oldValue, newValue) {
  const i = _findQ(list, questionKey);
  if (i === -1) return { ok: false, reason: `question "${questionKey}" not found` };
  const idx = list[i].answers.indexOf(oldValue);
  if (idx === -1) return { ok: false, reason: `"${oldValue}" not in options` };
  if (!newValue) return { ok: false, reason: "empty new value" };
  list[i].answers[idx] = newValue;
  return { ok: true, question: list[i].question };
}

// ── Customization: marker parsing / application ───────────────────────────────

const CUSTOMIZE_MARKER_RE = /\[CUSTOMIZE_[A-Z_]+(?:\|[^\]]*)?\]/g;

function parseMarker(raw) {
  // raw like "[CUSTOMIZE_ADD_OPTION|question=materiau|value=Plastique]"
  const inner = raw.slice(1, -1); // strip [ ]
  const parts = inner.split("|");
  const type = parts[0]; // e.g. CUSTOMIZE_ADD_OPTION
  const fields = {};
  for (let i = 1; i < parts.length; i++) {
    const eq = parts[i].indexOf("=");
    if (eq === -1) continue;
    const k = parts[i].slice(0, eq).trim();
    const v = parts[i].slice(eq + 1).trim();
    fields[k] = v;
  }
  return { type, fields };
}

function fmt(lang, key, vars) {
  let s = t(lang, key);
  for (const k in vars) s = s.replaceAll(`{${k}}`, vars[k]);
  return s;
}

/**
 * Parses all [CUSTOMIZE_*|...] markers in `text`, mutates a working copy of
 * the current question list, and persists. Returns:
 *   { cleanText, applied: [humanString, ...] }
 * Also, if options on the currently-answered questions are renamed, we rewrite
 * the stored techSheetAnswers to keep them consistent.
 */
function applyCustomizationMarkers(text) {
  const matches = text.match(CUSTOMIZE_MARKER_RE);
  if (!matches || matches.length === 0) {
    return { cleanText: text, applied: [] };
  }

  const cleanText = text.replace(CUSTOMIZE_MARKER_RE, "").trim();
  const applied = [];

  // Work on a deep clone so failures don't leave partial state.
  let list = cloneQuestions(getQuestions());
  let reset = false;
  const answerRewrites = []; // { key, newValue } for rename-option on answered q's

  for (const raw of matches) {
    const { type, fields } = parseMarker(raw);

    if (type === "CUSTOMIZE_RESET") {
      reset = true;
      list = cloneQuestions(getDefaultQuestions(currentLang));
      applied.push(t(currentLang, "customizeReset"));
      continue;
    }

    let r;
    switch (type) {
      case "CUSTOMIZE_ADD_OPTION":
        r = addOption(list, fields.question, fields.value);
        if (r.ok) applied.push(fmt(currentLang, "customizeAddedOption", { value: fields.value, question: r.question }));
        break;
      case "CUSTOMIZE_REMOVE_OPTION":
        r = removeOption(list, fields.question, fields.value);
        if (r.ok) applied.push(fmt(currentLang, "customizeRemovedOption", { value: fields.value, question: r.question }));
        break;
      case "CUSTOMIZE_ADD_QUESTION": {
        const answers = (fields.answers || "").split(",").map((s) => s.trim()).filter(Boolean);
        r = addQuestion(list, { key: fields.key, question: fields.question, answers });
        if (r.ok) applied.push(fmt(currentLang, "customizeAddedQuestion", { question: fields.question }));
        break;
      }
      case "CUSTOMIZE_REMOVE_QUESTION":
        r = removeQuestion(list, fields.key);
        if (r.ok) applied.push(fmt(currentLang, "customizeRemovedQuestion", { question: r.question }));
        break;
      case "CUSTOMIZE_RENAME_QUESTION":
        r = renameQuestion(list, fields.key, fields.newQuestion);
        if (r.ok) applied.push(fmt(currentLang, "customizeRenamedQuestion", { old: r.old, new: fields.newQuestion }));
        break;
      case "CUSTOMIZE_RENAME_OPTION":
        r = renameOption(list, fields.question, fields.old, fields.new);
        if (r.ok) {
          applied.push(fmt(currentLang, "customizeRenamedOption", { question: r.question, old: fields.old, new: fields.new }));
          answerRewrites.push({ key: fields.question, oldValue: fields.old, newValue: fields.new });
        }
        break;
      default:
        r = { ok: false, reason: `unknown marker ${type}` };
    }

    if (r && !r.ok) {
      applied.push(fmt(currentLang, "customizeFailed", { reason: r.reason }));
    }
  }

  // Persist the resolved list (or clear on reset).
  if (reset) {
    resetCustomQuestions();
  } else {
    setCustomQuestions(list);
  }

  // Rewrite stored answers if a currently-answered option was renamed.
  if (answerRewrites.length && project && techSheetAnswers) {
    let changed = false;
    for (const { key, oldValue, newValue } of answerRewrites) {
      if (techSheetAnswers[key] === oldValue) {
        techSheetAnswers[key] = newValue;
        changed = true;
      }
    }
    if (changed) {
      updateProject(project.id, { techSheetAnswers: { ...techSheetAnswers } });
      project.techSheetAnswers = { ...techSheetAnswers };
    }
  }

  return { cleanText, applied };
}

/**
 * After customizations are applied, re-sync the active questionnaire UI:
 *  - If techSheetMode is off, nothing to do.
 *  - If the questionnaire shrunk past the current step, finish it.
 *  - Otherwise, re-render chips for the (possibly changed) current question.
 */
function reconcileQuestionnaireAfterCustomization() {
  if (!techSheetMode) return;
  const questions = getQuestions();
  if (techSheetStep >= questions.length) {
    finishTechSheetQuestionnaire();
    return;
  }
  hideChips();
  renderChips(questions[techSheetStep].answers);
}

let techSheetMode = false;
let techSheetStep = 0;
let techSheetAnswers = {};

// ── DOM refs ──────────────────────────────────────────────────────────────────

const messagesEl = document.getElementById("messages");
const form = document.getElementById("form");
const input = document.getElementById("input");
const sendBtn = document.getElementById("send");
const techSheetBtn = document.getElementById("tech-sheet-btn");
const statusEl = document.getElementById("status");
const answerChipsEl = document.getElementById("answer-chips");

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  if (location.protocol === "file:") {
    appendMessage({
      role: "assistant",
      content:
        "Open this app through the server (npm start) so the chat can reach the API.",
    });
    return;
  }

  const params = new URLSearchParams(location.search);
  const projectId = params.get("project");

  if (!projectId) {
    location.href = "/";
    return;
  }

  project = getProject(projectId);
  if (!project) {
    location.href = "/";
    return;
  }

  const settings = getSettings();
  // Global settings language takes priority — ensures switching language on the
  // landing page is immediately reflected in both the questionnaire chips and
  // the chat, even for projects created before the switch.
  currentLang = settings.lang || project.lang || "fr";

  applyStrings(currentLang);

  // Render existing thread messages
  thread = [...project.thread];
  for (const msg of thread) {
    appendMessage(msg);
  }

  // Restore / start questionnaire for projects created with the new system
  if (typeof project.techSheetStep === "number") {
    techSheetAnswers = project.techSheetAnswers || {};
    techSheetStep = project.techSheetStep;
    const isMidQuestionnaire = techSheetStep > 0 || Object.keys(techSheetAnswers).length > 0;
    const isNewProject = thread.length === 1 && techSheetStep === 0 && (project.techSheetSheets || []).length === 0;

    if (isNewProject) {
      techSheetMode = true;
      askTechSheetQuestion();
    } else if (isMidQuestionnaire) {
      techSheetMode = true;
      const questions = getQuestions();
      if (techSheetStep < questions.length) {
        renderChips(questions[techSheetStep].answers);
      }
    }
  }

  checkHealth();
  wireListeners();
});

// ── i18n ──────────────────────────────────────────────────────────────────────

function applyStrings(lang) {
  document.documentElement.lang = lang;

  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(lang, el.dataset.i18n);
  });

  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    el.placeholder = t(lang, el.dataset.i18nPlaceholder);
  });

  document.querySelectorAll("[data-i18n-opt]").forEach((el) => {
    el.textContent = t(lang, el.dataset.i18nOpt);
  });

  const gearBtn = document.getElementById("gear-btn");
  if (gearBtn) gearBtn.setAttribute("aria-label", t(lang, "settingsTitle"));

  document.title = `AJ Revetement — ${project?.name || t(lang, "appName")}`;
}

// ── Persistence ───────────────────────────────────────────────────────────────

function persistThread() {
  if (project) {
    updateProject(project.id, { thread: [...thread] });
  }
}

// ── Message rendering ─────────────────────────────────────────────────────────

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function appendMessage(msg) {
  const div = document.createElement("div");
  div.className = `msg ${msg.role}`;
  div.textContent = msg.content;

  if (msg.sources?.length || msg.webSearchQueries?.length) {
    const meta = document.createElement("div");
    meta.className = "msg-sources";

    if (msg.webSearchQueries?.length) {
      const q = document.createElement("p");
      q.className = "queries";
      q.textContent = msg.webSearchQueries.join(" · ");
      meta.appendChild(q);
    }

    if (msg.sources?.length) {
      const ul = document.createElement("ul");
      for (const src of msg.sources) {
        const li = document.createElement("li");
        const a = document.createElement("a");
        a.href = src.uri;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = escapeHtml(src.title);
        li.appendChild(a);
        ul.appendChild(li);
      }
      meta.appendChild(ul);
    }

    div.appendChild(meta);
  }

  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return div;
}

// ── Typing indicator ──────────────────────────────────────────────────────────

function showTyping() {
  const div = document.createElement("div");
  div.className = "msg assistant";
  div.id = "typing-indicator";
  const dots = document.createElement("span");
  dots.className = "typing";
  dots.innerHTML = "<span></span><span></span><span></span>";
  div.appendChild(dots);
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function removeTyping() {
  document.getElementById("typing-indicator")?.remove();
}

// ── Loading state ─────────────────────────────────────────────────────────────

function setLoading(on) {
  isLoading = on;
  input.disabled = on;
  sendBtn.disabled = on;
  techSheetBtn.disabled = on;
  answerChipsEl.querySelectorAll(".answer-chip").forEach((btn) => { btn.disabled = on; });
  statusEl.textContent = on ? t(currentLang, "thinking") : "";
  statusEl.className = "status";
}

// ── Send message ──────────────────────────────────────────────────────────────

async function sendMessage(text) {
  if (!text || isLoading) return;

  thread.push({ role: "user", content: text });
  appendMessage(thread[thread.length - 1]);
  persistThread();

  input.value = "";
  resizeInput();
  setLoading(true);
  showTyping();

  // Skip initial greeting when sending to API
  const apiMessages = thread
    .slice(thread[0]?.role === "assistant" ? 1 : 0)
    .map(({ role, content }) => ({ role, content }));

  try {
    const settings = getSettings();
    const userName = (settings.username || "").trim() || undefined;

    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: apiMessages,
        language: currentLang,
        ...(userName ? { userName } : {}),
        questions: getQuestions(),
      }),
    });

    removeTyping();

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `${t(currentLang, "serverError")} (${res.status})`);
    }

    const data = await res.json();

    // Apply questionnaire customization markers, if any, and strip them.
    const customResult = applyCustomizationMarkers(data.text);
    let responseText = customResult.cleanText;

    // Strip [NOUVELLE_FICHE] marker if present
    let newSheetTrigger = false;
    if (responseText.includes("[NOUVELLE_FICHE]")) {
      newSheetTrigger = true;
      responseText = responseText.replace(/\[NOUVELLE_FICHE\]/g, "").trim();
    }

    const assistantMsg = {
      role: "assistant",
      content: responseText,
      sources: data.sources,
      webSearchQueries: data.webSearchQueries,
    };
    thread.push(assistantMsg);
    appendMessage(assistantMsg);
    persistThread();

    // Show confirmation bubbles for each applied customization, then re-sync UI.
    if (customResult.applied.length) {
      for (const line of customResult.applied) {
        const msg = { role: "assistant", content: line };
        thread.push(msg);
        appendMessage(msg);
      }
      persistThread();
      reconcileQuestionnaireAfterCustomization();
    }

    if (newSheetTrigger) {
      techSheetMode = true;
      techSheetStep = 0;
      techSheetAnswers = {};
      updateProject(project.id, { techSheetStep: 0, techSheetAnswers: {} });
      project.techSheetStep = 0;
      project.techSheetAnswers = {};
      askTechSheetQuestion();
    } else if (techSheetMode && techSheetStep < getQuestions().length) {
      const currentQ = getQuestions()[techSheetStep];
      const followUp = currentLang === "fr"
        ? `Avez-vous d'autres questions ou souhaitez-vous continuer la fiche technique ?\n\n${currentQ.question}`
        : `Do you have any other questions or do you want to continue the technical sheet?\n\n${currentQ.question}`;
      appendMessage({ role: "assistant", content: followUp });
      renderChips(currentQ.answers);
    } else if (techSheetMode && techSheetStep >= getQuestions().length) {
      // Questionnaire may have shrunk via customization — finish it.
      finishTechSheetQuestionnaire();
    }
  } catch (err) {
    removeTyping();
    appendMessage({
      role: "assistant",
      content: err.message || t(currentLang, "networkError"),
    });
    statusEl.textContent = err.message;
    statusEl.className = "status error";
    if (techSheetMode && techSheetStep < getQuestions().length) {
      const currentQ = getQuestions()[techSheetStep];
      const followUp = currentLang === "fr"
        ? `Avez-vous d'autres questions ou souhaitez-vous continuer la fiche technique ?\n\n${currentQ.question}`
        : `Do you have any other questions or do you want to continue the technical sheet?\n\n${currentQ.question}`;
      appendMessage({ role: "assistant", content: followUp });
      renderChips(currentQ.answers);
    }
  } finally {
    setLoading(false);
  }
}

// ── Health check ──────────────────────────────────────────────────────────────

async function checkHealth() {
  try {
    const res = await fetch("/api/health");
    const data = await res.json();
    if (!data.geminiConfigured) {
      appendMessage({ role: "assistant", content: t(currentLang, "noApiKey") });
    }
  } catch {
    appendMessage({ role: "assistant", content: t(currentLang, "networkError") });
  }
}

// ── Textarea auto-resize ──────────────────────────────────────────────────────

function resizeInput() {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 128) + "px";
}

// ── Settings panel ────────────────────────────────────────────────────────────

function openSettings() {
  const settings = getSettings();
  document.getElementById("settings-lang").value = settings.lang || project?.lang || currentLang;
  document.getElementById("settings-username").value = settings.username || "";
  document.getElementById("settings-mic-mode").value = settings.micMode ?? "toggle";
  document.getElementById("settings-mic-live").checked = settings.micLive ?? true;
  document.getElementById("settings-mic-autosend").checked = settings.micAutoSend ?? false;
  document.getElementById("settings-overlay").removeAttribute("hidden");
}

function closeSettings() {
  document.getElementById("settings-overlay").setAttribute("hidden", "");
}

function saveSettingsPanel() {
  const lang = document.getElementById("settings-lang").value;
  const username = document.getElementById("settings-username").value.trim();
  const micMode = document.getElementById("settings-mic-mode").value;
  const micLive = document.getElementById("settings-mic-live").checked;
  const micAutoSend = document.getElementById("settings-mic-autosend").checked;
  saveSettings({ lang, username, micMode, micLive, micAutoSend });
  currentLang = lang;
  if (project) {
    updateProject(project.id, { lang });
    project.lang = lang;
  }
  applyStrings(lang);
  window._applyMicSettings?.();
  closeSettings();
}

// ── Technical sheet questionnaire logic ──────────────────────────────────────

function askTechSheetQuestion() {
  const questions = getQuestions();
  if (techSheetStep >= questions.length) {
    finishTechSheetQuestionnaire();
    return;
  }
  const q = questions[techSheetStep];
  const msg = { role: "assistant", content: q.question };
  thread.push(msg);
  appendMessage(msg);
  persistThread();
  renderChips(q.answers);
}

function renderChips(answers) {
  answerChipsEl.innerHTML = "";
  for (const answer of answers) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "answer-chip";
    btn.textContent = answer;
    btn.addEventListener("click", () => handleChipAnswer(answer));
    answerChipsEl.appendChild(btn);
  }
  answerChipsEl.removeAttribute("hidden");
}

function hideChips() {
  answerChipsEl.setAttribute("hidden", "");
  answerChipsEl.innerHTML = "";
}

function handleChipAnswer(answer) {
  if (isLoading) return;
  hideChips();
  const q = getQuestions()[techSheetStep];
  techSheetAnswers[q.key] = answer;
  techSheetStep++;
  updateProject(project.id, { techSheetStep, techSheetAnswers: { ...techSheetAnswers } });
  project.techSheetStep = techSheetStep;
  project.techSheetAnswers = { ...techSheetAnswers };
  thread.push({ role: "user", content: answer });
  appendMessage(thread[thread.length - 1]);
  persistThread();
  askTechSheetQuestion();
}

function finishTechSheetQuestionnaire() {
  techSheetMode = false;
  hideChips();

  const completedSheet = { ...techSheetAnswers };
  const updatedSheets = [...(project.techSheetSheets || []), completedSheet];
  const sheetNum = updatedSheets.length;

  techSheetAnswers = {};
  techSheetStep = 0;

  updateProject(project.id, { techSheetStep: 0, techSheetAnswers: {}, techSheetSheets: updatedSheets });
  project.techSheetStep = 0;
  project.techSheetAnswers = {};
  project.techSheetSheets = updatedSheets;

  const msg = {
    role: "assistant",
    content: currentLang === "fr"
      ? `Fiche ${sheetNum} complétée ! Cliquez sur « Fiche technique » pour générer votre PDF, ou demandez-moi d'en créer une nouvelle si vous avez besoin d'une autre fiche.`
      : `Sheet ${sheetNum} completed! Click "Technical Sheet" to generate your PDF, or ask me to create a new one if you need another sheet.`,
  };
  thread.push(msg);
  appendMessage(msg);
  persistThread();
}

// ── Technical drawing helpers ─────────────────────────────────────────────────

const _D = {
  SCALE:   15,       // mm per inch (default)
  THK:     0.75,     // profile line width mm
  DIM_LW:  0.175,    // dimension line width mm
  EXT_GAP: 1.5,      // extension line gap mm
  EXT_OVSH:2.0,      // extension line overshoot mm
  OVSH:    0.3745,   // line overshoot at corners mm
  ARR_L:   1.55,     // arrowhead length mm
  ARR_W:   0.725,    // arrowhead half-width mm
};

// Adds a bezier-approximated 180° arc to the CURRENT PATH.
// The current path point must already be at pt(startDeg) before calling.
// Does NOT call moveTo or stroke — caller owns the full path lifecycle.
// startDeg/endDeg in jsPDF screen degrees (0=right, 90=down); antiCCW=true → CCW
function _arcPath(doc, cx, cy, R, startDeg, endDeg, antiCCW) {
  const KAPPA = 0.5522847498;
  const sign  = antiCCW ? -1 : 1;   // CW=+1, CCW=-1

  function pt(d)  { const r = d * Math.PI / 180; return [cx + R * Math.cos(r), cy + R * Math.sin(r)]; }
  function tan(d) { const r = d * Math.PI / 180; return [-sign * Math.sin(r), sign * Math.cos(r)]; }

  const a0 = startDeg, a1 = startDeg + sign * 90, a2 = endDeg;
  const [x0, y0] = pt(a0), [x1, y1] = pt(a1), [x2, y2] = pt(a2);
  const [t0x, t0y] = tan(a0), [t1x, t1y] = tan(a1), [t2x, t2y] = tan(a2);
  const kr = KAPPA * R;

  doc.curveTo(x0 + kr * t0x, y0 + kr * t0y, x1 - kr * t1x, y1 - kr * t1y, x1, y1);
  doc.curveTo(x1 + kr * t1x, y1 + kr * t1y, x2 - kr * t2x, y2 - kr * t2y, x2, y2);
}

// Standalone arc stroke (used only where an isolated arc is needed).
function _arc(doc, cx, cy, R, startDeg, endDeg, antiCCW) {
  const sign = antiCCW ? -1 : 1;
  function pt(d) { const r = d * Math.PI / 180; return [cx + R * Math.cos(r), cy + R * Math.sin(r)]; }
  const [sx, sy] = pt(startDeg);
  doc.moveTo(sx, sy);
  _arcPath(doc, cx, cy, R, startDeg, endDeg, antiCCW);
  doc.stroke();
}

function _drawArrow(doc, x, y, ux, uy, nx, ny, dir) {
  const tx1 = x + dir * _D.ARR_L * ux + _D.ARR_W * nx;
  const ty1 = y + dir * _D.ARR_L * uy + _D.ARR_W * ny;
  const tx2 = x + dir * _D.ARR_L * ux - _D.ARR_W * nx;
  const ty2 = y + dir * _D.ARR_L * uy - _D.ARR_W * ny;
  doc.setFillColor(0);
  doc.triangle(x, y, tx1, ty1, tx2, ty2, "F");
}

function _dimLine(doc, xa, ya, xb, yb, label) {
  const dx = xb - xa, dy = yb - ya, len = Math.hypot(dx, dy);
  if (len < 0.01) return;
  const ux = dx / len, uy = dy / len, nx = -uy;
  doc.setLineWidth(_D.DIM_LW);
  doc.line(xa + _D.ARR_L * ux, ya + _D.ARR_L * uy, xb - _D.ARR_L * ux, yb - _D.ARR_L * uy);
  _drawArrow(doc, xa, ya, ux, uy, nx, ux, +1);
  _drawArrow(doc, xb, yb, ux, uy, nx, ux, -1);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(2.5);
  doc.setTextColor(0);
  const angle = Math.atan2(uy, ux) * 180 / Math.PI;
  doc.text(label, (xa + xb) / 2, (ya + yb) / 2 - 1.0, { angle, align: "center" });
}

// vertical extension lines → horizontal dim line
function _dimH(doc, xa, ya, xb, yb, yDim, label) {
  doc.setLineWidth(_D.DIM_LW);
  doc.line(xa, ya + (yDim >= ya ? _D.EXT_GAP : -_D.EXT_GAP), xa, yDim + (yDim >= ya ? _D.EXT_OVSH : -_D.EXT_OVSH));
  doc.line(xb, yb + (yDim >= yb ? _D.EXT_GAP : -_D.EXT_GAP), xb, yDim + (yDim >= yb ? _D.EXT_OVSH : -_D.EXT_OVSH));
  _dimLine(doc, xa, yDim, xb, yDim, label);
}

// horizontal extension lines → vertical dim line
function _dimV(doc, xa, ya, xb, yb, xDim, label) {
  doc.setLineWidth(_D.DIM_LW);
  doc.line(xa + (xDim >= xa ? _D.EXT_GAP : -_D.EXT_GAP), ya, xDim + (xDim >= xa ? _D.EXT_OVSH : -_D.EXT_OVSH), ya);
  doc.line(xb + (xDim >= xb ? _D.EXT_GAP : -_D.EXT_GAP), yb, xDim + (xDim >= xb ? _D.EXT_OVSH : -_D.EXT_OVSH), yb);
  _dimLine(doc, xDim, ya, xDim, yb, label);
}

function _dimAligned(doc, xa, ya, xb, yb, offset, label) {
  const dx = xb - xa, dy = yb - ya, len = Math.hypot(dx, dy);
  if (len < 0.01) return;
  const ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
  const sign = offset >= 0 ? 1 : -1;
  const q1x = xa + offset * nx, q1y = ya + offset * ny;
  const q2x = xb + offset * nx, q2y = yb + offset * ny;
  doc.setLineWidth(_D.DIM_LW);
  doc.line(xa + sign * _D.EXT_GAP * nx, ya + sign * _D.EXT_GAP * ny,
           q1x + sign * _D.EXT_OVSH * nx, q1y + sign * _D.EXT_OVSH * ny);
  doc.line(xb + sign * _D.EXT_GAP * nx, yb + sign * _D.EXT_GAP * ny,
           q2x + sign * _D.EXT_OVSH * nx, q2y + sign * _D.EXT_OVSH * ny);
  _dimLine(doc, q1x, q1y, q2x, q2y, label);
}

function _inchLabel(v) {
  const D = 16, t = Math.round(v * D), w = Math.floor(t / D), r = t % D;
  if (r === 0) return `${w}"`;
  const gcd = (a, b) => b === 0 ? a : gcd(b, a % b);
  const g = gcd(r, D), n = r / g, d = D / g;
  return w === 0 ? `${n}/${d}"` : `${w} ${n}/${d}"`;
}

// ── Liner double ──────────────────────────────────────────────────────────────
function drawLiner(doc, CX, CY) {
  const S = _D.SCALE;
  const radius     = (1 / 16) * S / 2;   // R_ARC
  const spacing    = radius * 2;
  const H_total    = 6.0 * S;
  const V_total    = 0.75 * S;
  const V_straight = Math.max(0, V_total - radius);

  const x_left = CX - H_total / 2, x_right = CX + H_total / 2;
  const vxL    = CX - spacing / 2,  vxR     = CX + spacing / 2;
  const y_base = CY, y_top_tan = y_base - V_straight;
  const y_ext  = y_top_tan - radius;   // bezier control point height

  // Single continuous path — no gaps at arc junctions
  doc.setLineWidth(_D.THK);
  doc.moveTo(x_left,  y_base);
  doc.lineTo(vxL,     y_base);
  doc.lineTo(vxL,     y_top_tan);
  doc.curveTo(vxL, y_ext, vxR, y_ext, vxR, y_top_tan);  // top arc
  doc.lineTo(vxR,     y_base);
  doc.lineTo(x_right, y_base);
  doc.stroke();

  // dimensions
  doc.setLineWidth(_D.THK);
  _dimH(doc, x_left, y_base, CX,      y_base, y_base + 11.25, _inchLabel(3.0));
  _dimH(doc, CX,     y_base, x_right, y_base, y_base + 11.25, _inchLabel(3.0));
  _dimV(doc, vxL,    y_base, vxL,     y_ext,  x_left - 8.75,  _inchLabel(0.75));
}

// ── Coin extérieur 3" / 4" (shared geometry, S = scale mm/inch) ───────────────
function _drawCoinExterieur(doc, CX, CY, H4_in, H5_in, S) {
  const R1 = (1 / 16) * S / 2, R2 = R1;
  const OV = _D.OVSH;
  const ptm = S / 60;   // pt→mm scaling for dim offsets

  const H1 = 3.0 * S, H2 = 0.75 * S, H3t = 0.75 * S;
  const H4t = H4_in * S, H5t = H5_in * S, H6t = 0.75 * S;
  const H7 = 0.75 * S,  H8 = 3.0 * S;

  const H3_line = Math.max(0, H3t - R1), H4_line = Math.max(0, H4t - R1);
  const H5_line = Math.max(0, H5t - R2), H6_line = Math.max(0, H6t - R2);

  const x0 = CX, y0 = CY + H1 * 0.3;

  const x1 = x0,       y1 = y0 - H1;            // jambe verticale (UP)
  const x2 = x1 - H2,  y2 = y1;                 // retour H haut (LEFT)
  const x3 = x2,       y3 = y2 + H3_line;       // retour V (DOWN)
  const cx1 = x3 - R1, cy1 = y3;                // arc1 center
  const x_arc1_left = cx1 - R1, y_arc1_left = y3;
  const x_arc1_bot  = cx1,      y_arc1_bot   = cy1 + R1;
  const x4 = x_arc1_left, y4 = y_arc1_left;
  const x5 = x4,           y5 = y4 - H4_line;   // montant V (UP)
  const x6 = x5, y6 = y5;
  const x7 = x6 + H5_line, y7 = y6;             // tablette H (RIGHT)
  const cx2 = x7, cy2 = y7 + R2;                // arc2 center
  const x_arc2_bot   = x7,      y_arc2_bot   = y7 + 2 * R2;
  const x_arc2_right = x7 + R2, y_arc2_right = cy2;
  const x8 = x_arc2_bot, y8 = y_arc2_bot;
  const x9 = x8 - H6_line, y9 = y8;            // petit retour H (LEFT)
  const x10 = x9, y10 = y9 + H7;               // petit retour V (DOWN)
  const x11 = x10 + H8, y11 = y10;             // base H (RIGHT)

  // Single continuous path — eliminates white gaps at arc junctions
  doc.setLineWidth(_D.THK);
  doc.moveTo(x0,  y0);
  doc.lineTo(x1,  y1);                                  // vertical up
  doc.lineTo(x2,  y2);                                  // horizontal left
  doc.lineTo(x3,  y3);                                  // vertical down → arc1 start
  _arcPath(doc, cx1, cy1, R1, 0,   180, false);         // CW right→down→left → (x4,y4)
  doc.lineTo(x5,  y5);                                  // vertical up
  doc.lineTo(x7,  y7);                                  // horizontal right → arc2 start
  _arcPath(doc, cx2, cy2, R2, 270, 90,  false);         // CW top→right→bottom → (x8,y8)
  doc.lineTo(x9,  y9);                                  // horizontal left
  doc.lineTo(x10, y10);                                 // vertical down
  doc.lineTo(x11, y11);                                 // base right
  doc.stroke();

  const offR = 25*ptm, offTop = 25*ptm, offS = 15*ptm, offL = 25*ptm;
  const offIn = 30*ptm, offBot = 45*ptm, offBotSm = 20*ptm;

  _dimV(doc, x0,          y0,          x1,            y1,          x0 + offR,   _inchLabel(3.0));
  _dimH(doc, x2,          y2,          x1,            y1,          y2 - offTop, _inchLabel(0.75));
  _dimV(doc, x_arc1_bot,  y_arc1_bot,  x2,            y2,          x3 + offS,   _inchLabel(0.75));
  _dimV(doc, x_arc1_bot,  y_arc1_bot,  x5,            y5,          x5 - offL,   _inchLabel(H4_in));
  _dimH(doc, x6,          y6,          x_arc2_right,  y_arc2_right, y6 - offTop, _inchLabel(H5_in));
  _dimH(doc, x9,          y9,          x_arc2_right,  y_arc2_right, y9 + offBotSm, _inchLabel(0.75));
  _dimV(doc, x10,         y10,         x9,            y9,          x10 - offIn, _inchLabel(0.75));
  _dimH(doc, x10,         y10,         x11,           y11,         y10 + offBot, _inchLabel(3.0));
}

function drawCoinExterieur3(doc, CX, CY) { _drawCoinExterieur(doc, CX, CY, 3.0, 3.0, 15); }
function drawCoinExterieur4(doc, CX, CY) { _drawCoinExterieur(doc, CX, CY, 4.0, 4.0, 12); }

// ── Coin extérieur 45° ────────────────────────────────────────────────────────
function drawCoinExterieur45(doc, CX, CY) {
  const S = _D.SCALE;
  const R = (1 / 16) * S / 2;

  const L1 = 2.0 * S, L2t = 0.75 * S, L3t = 0.75 * S, L4 = 2.0 * S;

  const theta = -45 * Math.PI / 180;   // interior angle 135° → theta = -45°
  const ux =  Math.cos(theta);
  const uy = -Math.sin(theta);          // Y-flip for jsPDF
  const nx = -uy, ny = ux;

  const l2_line = Math.max(0, L2t - R), l3_line = Math.max(0, L3t - R);

  const x0 = CX - L1 / 2, y0 = CY;
  const x1 = x0 + L1,     y1 = y0;
  const x2 = x1 + l2_line * ux, y2 = y1 + l2_line * uy;

  const arc_cx = x2 + R * nx, arc_cy = y2 + R * ny;

  // jsPDF start angle = direct atan2 in jsPDF coords (Y-down)
  const start_js = Math.atan2(y2 - arc_cy, x2 - arc_cx) * 180 / Math.PI;
  const end_js   = start_js - 180;   // CCW 180° arc → subtract 180

  const x3 = arc_cx - (x2 - arc_cx), y3 = arc_cy - (y2 - arc_cy);
  const x4 = x3 - l3_line * ux, y4 = y3 - l3_line * uy;
  const x5 = x4,                y5 = y4 + L4;

  const x_arc_diag = arc_cx + R * ux, y_arc_diag = arc_cy + R * uy;

  // Single continuous path
  doc.setLineWidth(_D.THK);
  doc.moveTo(x0, y0);
  doc.lineTo(x1, y1);                                           // horizontal baseline
  doc.lineTo(x2, y2);                                           // diagonal → arc start
  _arcPath(doc, arc_cx, arc_cy, R, start_js, end_js, true);    // CCW 180° → (x3,y3)
  doc.lineTo(x4, y4);                                           // diagonal
  doc.lineTo(x5, y5);                                           // vertical down
  doc.stroke();

  _dimH(doc, x0, y0, x1, y1, y0 + 7.5, _inchLabel(2.0));
  _dimAligned(doc, x1, y1, x_arc_diag, y_arc_diag, -4.5, _inchLabel(0.75));
  _dimV(doc, x4, y4, x5, y5, x5 + 6.25, _inchLabel(2.0));
}

// ── Facia 6" ─────────────────────────────────────────────────────────────────
function drawFacia6(doc, CX, CY) {
  const S  = _D.SCALE;
  const R  = 3 * (S / 60);   // 3 ReportLab pts converted to mm
  const OV = _D.OVSH;

  const V1      = 6.0  * S;
  const H1_line = Math.max(0, 1.25 * S - R);
  const D3p     = 0.5  * S;

  const x0 = CX - 5.0, y0 = CY - 45.0;
  const x1 = x0,        y1 = y0 + V1;     // vertical descends (DOWN)
  const x2 = x1 + H1_line, y2 = y1;
  const x_right_ext = x2 + R;
  const cx3 = x2, cy3 = y1 - R;           // arc center: R above y1
  const y_arc_end = y1 - 2 * R;
  const x3 = x_right_ext - D3p, y3 = y_arc_end;

  // Single continuous path
  doc.setLineWidth(_D.THK);
  doc.moveTo(x0, y0);
  doc.lineTo(x1, y1);                              // long vertical
  doc.lineTo(x2, y2);                              // horizontal → arc start
  _arcPath(doc, cx3, cy3, R, 90, 270, true);       // CCW semicircle → (x2, y_arc_end)
  if (x3 < x2) doc.lineTo(x3, y3);                // short return horizontal
  doc.stroke();

  _dimV(doc, x0,  y0,  x1,           y1,  x0 - 8.75,    _inchLabel(6.0));
  _dimH(doc, x1,  y1,  x_right_ext,  y1,  y1 + 11.25,   _inchLabel(1.25));
  _dimH(doc, x3,  y3,  x_right_ext,  y3,  y_arc_end - 11.25, _inchLabel(0.5));
}

// ── PDF generation ────────────────────────────────────────────────────────────

function drawTechSheetPage(doc, answers, sheetIndex) {
  const m = 5;
  const pw = 279;
  const ph = 216;
  const endX = pw - m;
  const endY = ph - m;
  const stripY = 160;
  const col1X = 98;
  const col2X = 190;
  const red = [139, 26, 26];

  doc.setDrawColor(0);
  doc.setLineWidth(0.4);

  doc.rect(m, m, endX - m, endY - m);
  doc.line(m, stripY, endX, stripY);
  doc.line(col1X, stripY, col1X, endY);
  doc.line(col2X, stripY, col2X, endY);

  // ── Main content area: technical drawing ──────────────────────────────────
  const CX = (m + endX) / 2;
  const CY = (m + stripY) / 2;
  doc.setDrawColor(0, 0, 0);
  const moulure = answers.moulure || "";
  if (moulure.includes("Liner"))             drawLiner(doc, CX, CY);
  else if (moulure.includes("45"))           drawCoinExterieur45(doc, CX, CY);
  else if (moulure.includes("4"))            drawCoinExterieur4(doc, CX, CY);
  else if (moulure.includes("3"))            drawCoinExterieur3(doc, CX, CY);
  else if (moulure.toLowerCase().includes("facia")) drawFacia6(doc, CX, CY);

  // reset draw color/linewidth for the rest of the page
  doc.setDrawColor(0);
  doc.setLineWidth(0.4);

  // ── Bottom Left: AJ Logo + Company Info ──────────────────────────────────
  const lx = m + 4;
  const ly = stripY + 4;

  // Draw logo (real image or geometric fallback)
  const aW = 18, aH = 18;
  if (_logoDataUrl) {
    doc.addImage(_logoDataUrl, "PNG", lx, ly, aW, aH);
  } else {
    // Geometric "A" fallback
    doc.setDrawColor(...red);
    doc.setLineWidth(1.5);
    doc.line(lx,            ly + aH, lx + aW / 2, ly);
    doc.line(lx + aW,       ly + aH, lx + aW / 2, ly);
    doc.line(lx + aW * 0.22, ly + aH * 0.48, lx + aW * 0.78, ly + aH * 0.48);
    doc.setDrawColor(0);
    doc.setLineWidth(0.4);
  }

  // Company name inline with the logo
  doc.setTextColor(...red);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text("AJ REVÊTEMENT", lx + aW + 3, ly + 7);

  doc.setTextColor(30, 30, 30);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  doc.text("5180 Rue Gaudet, Drummondville, QC J2E 1L9", lx, ly + aH + 5);
  doc.text("Téléphone: 819-388-8668", lx, ly + aH + 11);

  // ── Bottom Middle: Answers ────────────────────────────────────────────────
  const mx = col1X + 5;
  let my = stripY + 10;
  const answerRows = getQuestions().map((q) => {
    const label = q.label || q.question.replace(/\s*[?:]\s*$/, "");
    return [label, answers[q.key] || "—"];
  });

  doc.setTextColor(30, 30, 30);
  doc.setFontSize(7);
  for (const [label, value] of answerRows) {
    // Draw "- Label :" in bold, then value in normal on the same line
    const boldPart = `- ${label} : `;
    doc.setFont("helvetica", "bold");
    doc.text(boldPart, mx, my);
    const bw = doc.getTextWidth(boldPart);
    doc.setFont("helvetica", "normal");
    doc.text(value, mx + bw, my);
    my += 7;
  }

  // ── Bottom Right: Project Info ────────────────────────────────────────────
  const rx = col2X + 5;
  let ry = stripY + 10;

  doc.setTextColor(30, 30, 30);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  const sheetLabel = (project.techSheetSheets || []).length > 1
    ? `${project.name || "Projet"} — Fiche ${sheetIndex + 1}`
    : (project.name || "Projet");
  doc.text(sheetLabel, rx, ry);

  ry += 8;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  const dateStr = new Date(project.createdAt).toLocaleDateString("fr-CA", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  doc.text(dateStr, rx, ry);
}

function generateTechSheetPDF() {
  const sheets = project.techSheetSheets || [];

  if (sheets.length === 0) {
    appendMessage({
      role: "assistant",
      content: currentLang === "fr"
        ? "Veuillez d'abord répondre aux questions pour générer la fiche technique."
        : "Please answer all questions first to generate the technical sheet.",
    });
    return;
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "letter" });

  sheets.forEach((answers, index) => {
    if (index > 0) doc.addPage();
    drawTechSheetPage(doc, answers, index);
  });

  const safeName = (project.name || "fiche").replace(/[^a-z0-9]/gi, "-").toLowerCase();
  doc.save(`fiche-technique-${safeName}.pdf`);
}

// ── Event wiring ──────────────────────────────────────────────────────────────

function wireListeners() {
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (text) sendMessage(text);
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const text = input.value.trim();
      if (text) sendMessage(text);
    }
  });

  input.addEventListener("input", resizeInput);

  techSheetBtn.addEventListener("click", () => {
    generateTechSheetPDF();
  });

  document.getElementById("gear-btn").addEventListener("click", openSettings);
  document.getElementById("settings-close").addEventListener("click", closeSettings);
  document.getElementById("settings-save").addEventListener("click", saveSettingsPanel);

  document.getElementById("settings-overlay").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeSettings();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeSettings();
  });

  // ── Voice input ──────────────────────────────────────────────────────────────

  const micBtn = document.getElementById("mic-btn");
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    micBtn.classList.add("mic-unsupported");
  } else {
    const recognition = new SpeechRecognition();
    recognition.continuous = false;

    function applyMicSettings() {
      const s = getSettings();
      recognition.interimResults = s.micLive ?? true;

      // Clear previous mode listeners
      micBtn.onmousedown = null;
      micBtn.onmouseup = null;
      micBtn.ontouchstart = null;
      micBtn.ontouchend = null;
      micBtn.onclick = null;

      if ((s.micMode ?? "toggle") === "hold") {
        const startRec = (e) => {
          e.preventDefault();
          if (isLoading) return;
          recognition.lang = currentLang === "fr" ? "fr-FR" : "en-US";
          recognition.start();
          micBtn.classList.add("recording");
        };
        const stopRec = () => { recognition.stop(); };
        micBtn.addEventListener("mousedown", startRec);
        micBtn.addEventListener("touchstart", startRec, { passive: false });
        micBtn.addEventListener("mouseup", stopRec);
        micBtn.addEventListener("mouseleave", stopRec);
        micBtn.addEventListener("touchend", stopRec);
      } else {
        micBtn.addEventListener("click", () => {
          if (isLoading) return;
          recognition.lang = currentLang === "fr" ? "fr-FR" : "en-US";
          if (micBtn.classList.contains("recording")) {
            recognition.stop();
          } else {
            recognition.start();
            micBtn.classList.add("recording");
          }
        });
      }
    }

    recognition.addEventListener("result", (e) => {
      let interim = "";
      let final = "";
      for (const r of e.results) {
        if (r.isFinal) final += r[0].transcript;
        else interim += r[0].transcript;
      }
      input.value = final || interim;
      input.style.opacity = final ? "" : "0.6";
      resizeInput();
    });

    recognition.addEventListener("end", () => {
      micBtn.classList.remove("recording");
      input.style.opacity = "";
      const s = getSettings();
      if ((s.micAutoSend ?? false) && input.value.trim()) {
        sendMessage(input.value.trim());
      } else {
        input.focus();
      }
    });

    recognition.addEventListener("error", (e) => {
      micBtn.classList.remove("recording");
      input.style.opacity = "";
      if (e.error === "not-allowed") {
        alert(currentLang === "fr"
          ? "Accès au microphone refusé. Vérifiez les permissions du navigateur."
          : "Microphone access denied. Check your browser permissions.");
      }
    });

    applyMicSettings();
    window._applyMicSettings = applyMicSettings;
  }
}
