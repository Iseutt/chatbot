import { t, STRINGS } from "./i18n.js";
import {
  getSettings,
  saveSettings,
  getProjects,
  createProject,
  deleteProject,
} from "./storage.js";

let searchQuery = "";

let currentLang = "fr";

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  const settings = getSettings();
  currentLang = settings.lang || "fr";

  applyStrings(currentLang);
  document.getElementById("lang-select").value = currentLang;
  renderProjectList();
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

  // Language select options
  document.querySelectorAll("[data-i18n-opt]").forEach((el) => {
    el.textContent = t(lang, el.dataset.i18nOpt);
  });

  // Gear button aria-label
  const gearBtn = document.getElementById("gear-btn");
  if (gearBtn) gearBtn.setAttribute("aria-label", t(lang, "settingsTitle"));
}

// ── Project list ──────────────────────────────────────────────────────────────

function matchesSearch(proj, query) {
  if (!query) return true;
  const q = query.toLowerCase();
  if (proj.name.toLowerCase().includes(q)) return true;
  return proj.thread?.some((msg) => msg.content?.toLowerCase().includes(q));
}

function renderProjectList() {
  const list = document.getElementById("project-list");
  const empty = document.getElementById("lp-empty");
  const searchEmpty = document.getElementById("search-empty");
  const projects = getProjects();

  list.innerHTML = "";

  if (projects.length === 0) {
    empty.style.display = "";
    searchEmpty.hidden = true;
    return;
  }
  empty.style.display = "none";

  const filtered = projects.filter((p) => matchesSearch(p, searchQuery));
  searchEmpty.hidden = filtered.length > 0;

  for (const proj of filtered) {
    const li = document.createElement("li");

    const info = document.createElement("div");
    info.className = "proj-info";

    const name = document.createElement("div");
    name.className = "proj-name";
    name.textContent = proj.name;

    const date = document.createElement("div");
    date.className = "proj-date";
    date.textContent = formatDate(proj.updatedAt, currentLang);

    info.appendChild(name);
    info.appendChild(date);

    const del = document.createElement("button");
    del.className = "proj-delete";
    del.textContent = "✕";
    del.title = t(currentLang, "deleteProject");
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      handleDeleteProject(proj.id);
    });

    li.appendChild(info);
    li.appendChild(del);

    li.addEventListener("click", () => openProject(proj.id));
    list.appendChild(li);
  }
}

function formatDate(iso, lang) {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(lang === "fr" ? "fr-CA" : "en-CA", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

// ── Actions ───────────────────────────────────────────────────────────────────

function openProject(id) {
  window.location.href = `/chat.html?project=${encodeURIComponent(id)}`;
}

function handleNewProject() {
  const name = window.prompt(
    t(currentLang, "newProjectNamePrompt"),
    t(currentLang, "newProjectName")
  );
  if (name === null) return; // cancelled
  const proj = createProject(name.trim() || t(currentLang, "newProjectName"), currentLang);
  openProject(proj.id);
}

function handleDeleteProject(id) {
  if (!window.confirm(t(currentLang, "confirmDelete"))) return;
  deleteProject(id);
  renderProjectList();
}


function handleLangChange(newLang) {
  currentLang = newLang;
  saveSettings({ lang: newLang });
  applyStrings(newLang);
  renderProjectList();
  // Sync settings panel select if open
  const settingsLang = document.getElementById("settings-lang");
  if (settingsLang) settingsLang.value = newLang;
}

// ── Settings panel ────────────────────────────────────────────────────────────

function openSettings() {
  const overlay = document.getElementById("settings-overlay");
  const settings = getSettings();
  document.getElementById("settings-lang").value = settings.lang || currentLang;
  document.getElementById("settings-username").value = settings.username || "";
  document.getElementById("settings-mic-mode").value = settings.micMode ?? "toggle";
  document.getElementById("settings-mic-live").checked = settings.micLive ?? true;
  document.getElementById("settings-mic-autosend").checked = settings.micAutoSend ?? false;
  overlay.removeAttribute("hidden");
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
  handleLangChange(lang);
  closeSettings();
}

// ── Event wiring ──────────────────────────────────────────────────────────────

function wireListeners() {
  document.getElementById("new-project-btn").addEventListener("click", handleNewProject);

  document.getElementById("search-input").addEventListener("input", (e) => {
    searchQuery = e.target.value.trim();
    renderProjectList();
  });

  document.getElementById("lang-select").addEventListener("change", (e) => {
    handleLangChange(e.target.value);
  });

  document.getElementById("gear-btn").addEventListener("click", openSettings);
  document.getElementById("settings-close").addEventListener("click", closeSettings);
  document.getElementById("settings-save").addEventListener("click", saveSettingsPanel);

  // Close overlay on backdrop click
  document.getElementById("settings-overlay").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeSettings();
  });

  // Close on Escape
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeSettings();
  });
}
