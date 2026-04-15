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
