import { t } from "./i18n.js";
import { getSettings, saveSettings, getProject, updateProject } from "./storage.js";

// ── State ─────────────────────────────────────────────────────────────────────

let project = null;
let thread = [];
let currentLang = "fr";
let isLoading = false;

// ── DOM refs ──────────────────────────────────────────────────────────────────

const messagesEl = document.getElementById("messages");
const form = document.getElementById("form");
const input = document.getElementById("input");
const sendBtn = document.getElementById("send");
const techSheetBtn = document.getElementById("tech-sheet-btn");
const statusEl = document.getElementById("status");

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
    const assistantMsg = {
      role: "assistant",
      content: data.text,
      sources: data.sources,
      webSearchQueries: data.webSearchQueries,
    };
    thread.push(assistantMsg);
    appendMessage(assistantMsg);
    persistThread();
  } catch (err) {
    removeTyping();
    appendMessage({
      role: "assistant",
      content: err.message || t(currentLang, "networkError"),
    });
    statusEl.textContent = err.message;
    statusEl.className = "status error";
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
  document.getElementById("settings-overlay").removeAttribute("hidden");
}

function closeSettings() {
  document.getElementById("settings-overlay").setAttribute("hidden", "");
}

function saveSettingsPanel() {
  const lang = document.getElementById("settings-lang").value;
  const username = document.getElementById("settings-username").value.trim();
  saveSettings({ lang, username });
  currentLang = lang;
  if (project) {
    updateProject(project.id, { lang });
    project.lang = lang;
  }
  applyStrings(lang);
  closeSettings();
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
    sendMessage(t(currentLang, "techSheetPrompt"));
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
}
