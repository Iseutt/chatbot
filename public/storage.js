import { t } from "./i18n.js";

const SETTINGS_KEY = "ajr_settings";
const PROJECTS_KEY = "ajr_projects";
const CHARTE_KEY = "ajr_charte_accepted";

export function isCharteAccepted() {
  return localStorage.getItem(CHARTE_KEY) === "true";
}

export function acceptCharte() {
  localStorage.setItem(CHARTE_KEY, "true");
}

// ── Settings ──────────────────────────────────────────────────────────────────

export function getSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const defaults = { lang: "fr", username: "", micMode: "toggle", micLive: true, micAutoSend: false };
    return raw ? { ...defaults, ...JSON.parse(raw) } : defaults;
  } catch {
    return { lang: "fr", username: "", micMode: "toggle", micLive: true, micAutoSend: false };
  }
}

export function saveSettings(patch) {
  const current = getSettings();
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...current, ...patch }));
}

// ── Projects ──────────────────────────────────────────────────────────────────

export function getProjects() {
  try {
    const raw = localStorage.getItem(PROJECTS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return arr.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  } catch {
    return [];
  }
}

function saveProjects(arr) {
  localStorage.setItem(PROJECTS_KEY, JSON.stringify(arr));
}

export function getProject(id) {
  return getProjects().find((p) => p.id === id) ?? null;
}

export function createProject(name, lang) {
  const now = new Date().toISOString();
  const id = "proj_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);
  const project = {
    id,
    name: name || t(lang, "newProjectName"),
    lang: lang || "fr",
    createdAt: now,
    updatedAt: now,
    thread: [{ role: "assistant", content: t(lang, "greeting") }],
    techSheetStep: 0,
    techSheetAnswers: {},
  };
  const projects = getProjects();
  projects.unshift(project);
  saveProjects(projects);
  return project;
}

export function updateProject(id, patch) {
  const projects = getProjects();
  const idx = projects.findIndex((p) => p.id === id);
  if (idx === -1) return;
  projects[idx] = { ...projects[idx], ...patch, updatedAt: new Date().toISOString() };
  saveProjects(projects);
}

export function deleteProject(id) {
  const projects = getProjects().filter((p) => p.id !== id);
  saveProjects(projects);
}
