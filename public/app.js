import { t } from "./i18n.js";
import { getSettings, saveSettings, getProject, updateProject } from "./storage.js";

// ── State ─────────────────────────────────────────────────────────────────────

let project = null;
let thread = [];
let currentLang = "fr";
let isLoading = false;

// ── Technical sheet questionnaire ─────────────────────────────────────────────

const TECH_SHEET_QUESTIONS = [
  {
    key: "moulure",
    question: "Quelle moulure souhaitez-vous utiliser ?",
    answers: ["Liner double", "Coin exterieur 3", "Coin exterieur 4", "Coin exterieur 45", "Facia 6"],
  },
  {
    key: "materiau",
    question: "Quel type de matériau utilisez-vous ?",
    answers: ["Acier", "Aluminium"],
  },
  {
    key: "calibre",
    question: "Quel calibre souhaitez-vous ?",
    answers: ["22", "24", "26"],
  },
  {
    key: "couleur",
    question: "Quelle couleur voulez-vous ?",
    answers: ["Noir", "Blanc", "Gris", "Brun"],
  },
  {
    key: "vis",
    question: "Quel type de vis utilisez-vous ?",
    answers: ["Auto-perceuse", "Vis colorée", "Vis standard"],
  },
];

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
  currentLang = project.lang || settings.lang || "fr";

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
      renderChips(TECH_SHEET_QUESTIONS[techSheetStep].answers);
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
      }),
    });

    removeTyping();

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `${t(currentLang, "serverError")} (${res.status})`);
    }

    const data = await res.json();

    // Strip [NOUVELLE_FICHE] marker if present
    let responseText = data.text;
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

    if (newSheetTrigger) {
      techSheetMode = true;
      techSheetStep = 0;
      techSheetAnswers = {};
      updateProject(project.id, { techSheetStep: 0, techSheetAnswers: {} });
      project.techSheetStep = 0;
      project.techSheetAnswers = {};
      askTechSheetQuestion();
    } else if (techSheetMode && techSheetStep < TECH_SHEET_QUESTIONS.length) {
      const currentQ = TECH_SHEET_QUESTIONS[techSheetStep];
      const followUp = currentLang === "fr"
        ? `Avez-vous d'autres questions ou souhaitez-vous continuer la fiche technique ?\n\n${currentQ.question}`
        : `Do you have any other questions or do you want to continue the technical sheet?\n\n${currentQ.question}`;
      appendMessage({ role: "assistant", content: followUp });
      renderChips(currentQ.answers);
    }
  } catch (err) {
    removeTyping();
    appendMessage({
      role: "assistant",
      content: err.message || t(currentLang, "networkError"),
    });
    statusEl.textContent = err.message;
    statusEl.className = "status error";
    if (techSheetMode && techSheetStep < TECH_SHEET_QUESTIONS.length) {
      const currentQ = TECH_SHEET_QUESTIONS[techSheetStep];
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
  document.getElementById("settings-lang").value = project?.lang || settings.lang || currentLang;
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
  if (techSheetStep >= TECH_SHEET_QUESTIONS.length) {
    finishTechSheetQuestionnaire();
    return;
  }
  const q = TECH_SHEET_QUESTIONS[techSheetStep];
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
  const q = TECH_SHEET_QUESTIONS[techSheetStep];
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
  SCALE:      15,       // mm per inch
  PT:         0.25,     // mm per ReportLab point  (15/60)
  THK:        0.75,     // profile line width mm
  DIM_LW:     0.175,    // dimension line width mm
  R_ARC:      0.46875,  // (1/16 inch * 15 mm/in) / 2
  EXT_GAP:    1.5,      // 6 pts
  EXT_OVSH:   2.0,      // 8 pts
  OVSH:       0.3745,   // 1.498 pts
  ARR_L:      1.55,     // 6.2 pts
  ARR_W:      0.725,    // 2.9 pts
};

function _drawArrow(doc, x, y, ux, uy, nx, ny, dir) {
  const tx1 = x + dir * _D.ARR_L * ux + _D.ARR_W * nx;
  const ty1 = y + dir * _D.ARR_L * uy + _D.ARR_W * ny;
  const tx2 = x + dir * _D.ARR_L * ux - _D.ARR_W * nx;
  const ty2 = y + dir * _D.ARR_L * uy - _D.ARR_W * ny;
  doc.setFillColor(0);
  doc.triangle(x, y, tx1, ty1, tx2, ty2, "F");
}

function _dimLine(doc, xa, ya, xb, yb, label) {
  const dx = xb - xa, dy = yb - ya;
  const len = Math.hypot(dx, dy);
  if (len < 0.01) return;
  const ux = dx / len, uy = dy / len;
  const nx = -uy, ny = ux;
  doc.setLineWidth(_D.DIM_LW);
  doc.line(xa + _D.ARR_L * ux, ya + _D.ARR_L * uy, xb - _D.ARR_L * ux, yb - _D.ARR_L * uy);
  _drawArrow(doc, xa, ya, ux, uy, nx, ny, +1);
  _drawArrow(doc, xb, yb, ux, uy, nx, ny, -1);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(2.5);
  doc.setTextColor(0);
  const angle = Math.atan2(uy, ux) * 180 / Math.PI;
  doc.text(label, (xa + xb) / 2, (ya + yb) / 2 - 1.0, { angle, align: "center" });
}

// dim_h_with_ext: vertical extension lines, horizontal dim line
function _dimH(doc, xa, ya, xb, yb, yDim, label) {
  doc.setLineWidth(_D.DIM_LW);
  doc.line(xa, ya + (yDim >= ya ? _D.EXT_GAP : -_D.EXT_GAP), xa, yDim + (yDim >= ya ? _D.OVSH : -_D.OVSH));
  doc.line(xb, yb + (yDim >= yb ? _D.EXT_GAP : -_D.EXT_GAP), xb, yDim + (yDim >= yb ? _D.OVSH : -_D.OVSH));
  _dimLine(doc, xa, yDim, xb, yDim, label);
}

// dim_v_with_ext: horizontal extension lines, vertical dim line
function _dimV(doc, xa, ya, xb, yb, xDim, label) {
  doc.setLineWidth(_D.DIM_LW);
  doc.line(xa + (xDim >= xa ? _D.EXT_GAP : -_D.EXT_GAP), ya, xDim + (xDim >= xa ? _D.OVSH : -_D.OVSH), ya);
  doc.line(xb + (xDim >= xb ? _D.EXT_GAP : -_D.EXT_GAP), yb, xDim + (xDim >= xb ? _D.OVSH : -_D.OVSH), yb);
  _dimLine(doc, xDim, ya, xDim, yb, label);
}

function _inchLabel(valueIn) {
  const DENOM = 16;
  const total = Math.round(valueIn * DENOM);
  const whole = Math.floor(total / DENOM);
  const rem = total % DENOM;
  if (rem === 0) return `${whole}"`;
  // reduce fraction
  const gcd = (a, b) => b === 0 ? a : gcd(b, a % b);
  const g = gcd(rem, DENOM);
  const n = rem / g, d = DENOM / g;
  return whole === 0 ? `${n}/${d}"` : `${whole} ${n}/${d}"`;
}

// ── Liner double ──────────────────────────────────────────────────────────────
function drawLiner(doc, CX, CY) {
  const S = _D.SCALE;
  const H_total = 6.0 * S;
  const V_total = 0.75 * S;
  const radius  = _D.R_ARC;
  const spacing = radius * 2;
  const V_straight = Math.max(0, V_total - radius);

  const x_left = CX - H_total / 2;
  const x_right = CX + H_total / 2;
  const vxL = CX - spacing / 2;
  const vxR = CX + spacing / 2;
  const y_base = CY;
  const y_top_tan = y_base - V_straight;

  doc.setLineWidth(_D.THK);
  doc.line(x_left,  y_base,   vxL, y_base);
  doc.line(vxL,     y_base,   vxL, y_top_tan);
  // top arc: CCW from left tangent to right tangent going upward
  doc.arc(CX, y_top_tan, spacing / 2, spacing / 2, 180, 0, true, "S");
  doc.line(vxR, y_top_tan, vxR, y_base);
  doc.line(vxR, y_base, x_right, y_base);

  // dimensions
  const yDimBot = y_base + 11.25;
  const yDimTop = y_top_tan - radius - 11.25;
  const xDimL   = x_left - 8.75;

  _dimH(doc, x_left, y_base, CX, y_base, yDimBot, _inchLabel(3.0));
  _dimH(doc, CX, y_base, x_right, y_base, yDimBot, _inchLabel(3.0));
  _dimV(doc, vxL, y_base, vxL, y_top_tan - radius, xDimL, _inchLabel(0.75));
}

// ── Coin extérieur 3" / 4" (shared geometry) ─────────────────────────────────
function _drawCoinExterieur(doc, CX, CY, H4_in, H5_in) {
  const S  = _D.SCALE;
  const R1 = _D.R_ARC, R2 = _D.R_ARC;
  const OV = _D.OVSH;

  const H1 = 3.0  * S;
  const H2 = 0.75 * S;
  const H3t = 0.75 * S;
  const H4t = H4_in * S;
  const H5t = H5_in * S;
  const H6t = 0.75 * S;
  const H7  = 0.75 * S;
  const H8  = 3.0  * S;

  const H3_line = Math.max(0, H3t - R1);
  const H4_line = Math.max(0, H4t - R1);
  const H5_line = Math.max(0, H5t - R2);
  const H6_line = Math.max(0, H6t - R2);

  // origin — offset so drawing is roughly centred
  const x0 = CX;
  const y0 = CY + H1 * 0.3;  // shift down a bit so the profile centres vertically

  // 1) jambe verticale (goes UP)
  const x1 = x0, y1 = y0 - H1;
  // 2) retour horizontal haut (goes LEFT)
  const x2 = x1 - H2, y2 = y1;
  // 3) retour vertical (goes DOWN)
  const x3 = x2, y3 = y2 + H3_line;
  // arc 1: centre left of x3, at y3; draws right→below→left in jsPDF
  const cx1 = x3 - R1, cy1 = y3;
  const x_arc1_left = cx1 - R1, y_arc1_left = y3;
  const x_arc1_bot  = cx1,      y_arc1_bot  = cy1 + R1;
  // 4+5) montant vertical (goes UP from arc bottom-left)
  const x4 = x_arc1_left, y4 = y_arc1_left;
  const x5 = x4,          y5 = y4 - H4_line;
  // 6) tablette horizontale (goes RIGHT)
  const x6 = x5, y6 = y5;
  const x7 = x6 + H5_line, y7 = y6;
  // arc 2: above x7,y7; draws above→right→below
  const cx2 = x7, cy2 = y7 + R2;
  const x_arc2_bot   = x7,      y_arc2_bot   = y7 + 2 * R2;
  const x_arc2_right = x7 + R2, y_arc2_right = cy2;
  // 8) petit retour horizontal (goes LEFT)
  const x8 = x_arc2_bot, y8 = y_arc2_bot;
  const x9 = x8 - H6_line, y9 = y8;
  // 9) petit retour vertical (goes DOWN)
  const x10 = x9, y10 = y9 + H7;
  // 10) base horizontale (goes RIGHT)
  const x11 = x10 + H8, y11 = y10;

  doc.setLineWidth(_D.THK);
  doc.line(x0 - OV, y0, x1 - OV, y1);                         // jambe
  doc.line(x1 + OV, y1, x2 - OV, y2);                         // retour H haut
  doc.line(x2, y2, x3, y3);                                    // retour V haut
  doc.arc(cx1, cy1, R1, R1, 0, 180, false, "S");               // arc1
  doc.line(x4, y4, x5, y5);                                    // montant V
  doc.line(x6 - OV, y6, x7 + OV, y7);                         // tablette H
  doc.arc(cx2, cy2, R2, R2, 270, 90, false, "S");              // arc2
  doc.line(x8 + OV, y8, x9 - OV, y9);                         // petit retour H
  doc.line(x9, y9, x10, y10);                                  // petit retour V
  doc.line(x10 - OV, y10, x11 + OV, y11);                     // base H

  // dimensions
  const off = 6.25;   // 25 pts * PT_TO_MM
  const offL = 6.25, offR = 6.25, offS = 3.75, offIn = 7.5, offBot = 11.25, offTop = 6.25, offBotSm = 5.0;

  _dimV(doc, x0, y0, x1, y1, x0 + offR, _inchLabel(3.0));
  _dimH(doc, x2, y2, x1, y1, y2 - offTop, _inchLabel(0.75));
  _dimV(doc, x_arc1_bot, y_arc1_bot, x2, y2, x3 + offS, _inchLabel(0.75));
  _dimV(doc, x_arc1_bot, y_arc1_bot, x5, y5, x5 - offL, _inchLabel(H4_in));
  _dimH(doc, x6, y6, x_arc2_right, y_arc2_right, y6 - offTop, _inchLabel(H5_in));
  _dimH(doc, x9, y9, x_arc2_right, y_arc2_right, y9 + offBotSm, _inchLabel(0.75));
  _dimV(doc, x10, y10, x9, y9, x10 - offIn, _inchLabel(0.75));
  _dimH(doc, x10, y10, x11, y11, y10 + offBot, _inchLabel(3.0));
}

function drawCoinExterieur3(doc, CX, CY) { _drawCoinExterieur(doc, CX, CY, 3.0, 3.0); }
function drawCoinExterieur4(doc, CX, CY) { _drawCoinExterieur(doc, CX, CY, 4.0, 4.0); }

// ── Coin extérieur 45° ────────────────────────────────────────────────────────
function drawCoinExterieur45(doc, CX, CY) {
  const S = _D.SCALE;
  const R = _D.R_ARC;
  const KAPPA = 0.5522847498;

  const L1 = 2.0  * S;
  const L2t = 0.75 * S;
  const L3t = 0.75 * S;
  const L4 = 2.0  * S;

  const angle_int = 135.0;
  const theta_deg = -(180.0 - angle_int);   // = -45°
  const theta = theta_deg * Math.PI / 180;

  // In jsPDF (Y-down), uy must be negated relative to RL
  const ux =  Math.cos(theta);
  const uy = -Math.sin(theta);   // Y-flip
  const nx = -uy, ny = ux;

  const l2_line = Math.max(0, L2t - R);
  const l3_line = Math.max(0, L3t - R);

  const x0 = CX - L1 / 2;
  const y0 = CY;

  const x1 = x0 + L1,  y1 = y0;
  const x2 = x1 + l2_line * ux,  y2 = y1 + l2_line * uy;

  const arc_cx = x2 + R * nx;
  const arc_cy = y2 + R * ny;

  // start angle for the arc in RL: angle from center to p2
  const start_rl = Math.atan2(-(y2 - arc_cy), x2 - arc_cx) * 180 / Math.PI;  // negate dy for RL
  // convert to jsPDF arc angles: extent=+180 (CCW) → antiCCW=true
  const start_js = -start_rl;
  const end_js   = -(start_rl + 180);

  // p3 = opposite end of arc from p2
  const x3 = arc_cx - (x2 - arc_cx);
  const y3 = arc_cy - (y2 - arc_cy);

  const x4 = x3 - l3_line * ux,  y4 = y3 - l3_line * uy;
  const x5 = x4,                  y5 = y4 + L4;

  // point on arc along diagonal direction (for dim line)
  const x_arc_diag = arc_cx + R * ux;
  const y_arc_diag = arc_cy + R * uy;

  doc.setLineWidth(_D.THK);
  doc.line(x0, y0, x1, y1);
  doc.line(x1, y1, x2, y2);
  doc.arc(arc_cx, arc_cy, R, R, start_js, end_js, true, "S");
  doc.line(x3, y3, x4, y4);
  doc.line(x4, y4, x5, y5);

  // dimensions
  const offH = 7.5, offV = 6.25, offDiag = -4.5;
  _dimH(doc, x0, y0, x1, y1, y0 + offH, _inchLabel(2.0));
  // diagonal dim (aligned)
  _dimAligned(doc, x1, y1, x_arc_diag, y_arc_diag, offDiag, _inchLabel(0.75));
  _dimV(doc, x4, y4, x5, y5, x5 + offV, _inchLabel(2.0));
}

function _dimAligned(doc, xa, ya, xb, yb, offset, label) {
  const dx = xb - xa, dy = yb - ya;
  const len = Math.hypot(dx, dy);
  if (len < 0.01) return;
  const ux = dx / len, uy = dy / len;
  const nx = -uy, ny = ux;
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

// ── Facia 6" ─────────────────────────────────────────────────────────────────
function drawFacia6(doc, CX, CY) {
  const S = _D.SCALE;
  const R = 3 * _D.PT;   // 3 pts
  const OV = _D.OVSH;

  const V1  = 6.0  * S;
  const H1t = 1.25 * S;
  const D3p = 0.5  * S;

  const H1_line = Math.max(0, H1t - R);

  // position: y_offset_rl = 180 pts → 45mm; negate for jsPDF
  const x0 = CX - 5.0;
  const y0 = CY - 45.0;

  // 1) verticale descendante (DOWN in jsPDF)
  const x1 = x0, y1 = y0 + V1;

  // 2) horizontale droite
  const x2 = x1 + H1_line, y2 = y1;
  const x_right_ext = x2 + R;

  // 3) arc ")" — center is R above y1 in jsPDF (above = smaller y)
  const cx3 = x2, cy3 = y1 - R;
  const x_arc_end = x2, y_arc_end = y1 - 2 * R;

  // petit retour gauche
  const x3 = x_right_ext - D3p, y3 = y_arc_end;

  doc.setLineWidth(_D.THK);
  doc.line(x0, y0, x1, y1);
  doc.line(x1 - OV, y1, x2 + OV, y2);
  // arc from (x2, y1) → right → (x2, y_arc_end): CCW in jsPDF
  doc.arc(cx3, cy3, R, R, 90, 270, true, "S");
  if (x3 < x_arc_end) {
    doc.line(x_arc_end + OV, y_arc_end, x3 - OV, y3);
  }

  // dimensions
  const xDimV  = x0 - 8.75;
  const yDimH1 = y1 + 11.25;
  const yDimD3 = y_arc_end - 11.25;

  _dimV(doc, x0, y0, x1, y1, xDimV, _inchLabel(6.0));
  _dimH(doc, x1, y1, x_right_ext, y1, yDimH1, _inchLabel(1.25));
  _dimH(doc, x3, y3, x_right_ext, y3, yDimD3, _inchLabel(0.5));
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
  const ly = stripY + 5;

  doc.setFillColor(...red);
  doc.roundedRect(lx, ly, 13, 13, 1.2, 1.2, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6.5);
  doc.text("AJ", lx + 6.5, ly + 8.5, { align: "center" });

  doc.setTextColor(...red);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text("AJ REVÊTEMENT", lx + 16, ly + 5.5);

  doc.setTextColor(30, 30, 30);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  doc.text("5180 Rue Gaudet, Drummondville, QC J2E 1L9", lx, ly + 20);
  doc.text("Téléphone: 819-388-8668", lx, ly + 26);

  // ── Bottom Middle: Answers ────────────────────────────────────────────────
  const mx = col1X + 5;
  let my = stripY + 10;
  const answerRows = [
    ["Moulure",     answers.moulure   || "—"],
    ["Matériau",    answers.materiau  || "—"],
    ["Calibre",     answers.calibre   || "—"],
    ["Couleur",     answers.couleur   || "—"],
    ["Type de vis", answers.vis       || "—"],
  ];

  doc.setTextColor(30, 30, 30);
  doc.setFontSize(7);
  for (const [label, value] of answerRows) {
    doc.setFont("helvetica", "bold");
    doc.text(`${label} :`, mx, my);
    doc.setFont("helvetica", "normal");
    doc.text(value, mx + 30, my);
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
