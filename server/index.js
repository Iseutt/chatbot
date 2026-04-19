import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI } from "@google/genai";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");

const envPaths = [
  path.join(rootDir, ".env"),
  path.join(process.cwd(), ".env"),
];

if (fs.existsSync(envPaths[0])) dotenv.config({ path: envPaths[0] });
if (fs.existsSync(envPaths[1])) dotenv.config({ path: envPaths[1], override: true });
dotenv.config();

const publicDir = path.join(rootDir, "public");

const app = express();
app.use(cors());
app.use(express.json({ limit: "512kb" }));
app.use(
  express.static(publicDir, {
    setHeaders(res, filePath) {
      if (filePath.endsWith(".css") || filePath.endsWith(".js")) {
        res.setHeader("Cache-Control", "no-store, max-age=0");
      }
    },
  })
);

const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

const SYSTEM_INSTRUCTION_BASE = `You are the professional in-house assistant for AJ Revetement, a company focused on coatings and surface treatments (revêtements).

Your role today:
- Answer questions clearly and professionally for staff.
- When the user needs recent facts, standards, product data, or anything time-sensitive, rely on Google Search grounding so answers reflect current public information.
- When asked to generate a technical sheet, produce a well-structured document with sections such as: Product Name, Description, Applications, Technical Properties, Surface Preparation, Application Method, Drying/Curing Times, Safety & Handling, and any other relevant fields from the conversation.

Tone: concise, accurate, and helpful. If search sources support claims, you may mention that information comes from web sources without over-explaining the tool.

Technical sheet context: The user may be filling out a guided questionnaire to create technical sheets (fiches techniques). If the user asks to create a new technical sheet, start a new one, make another one, or uses phrases like "nouvelle fiche", "new one", "un autre", "another one", "créer une nouvelle", include the exact marker [NOUVELLE_FICHE] at the very end of your response. Only include this marker when the user clearly wants to start a new questionnaire for another technical sheet.`;

/** Strip risky characters and cap length for a user-supplied display name. */
function sanitizeDisplayName(raw) {
  if (raw == null || typeof raw !== "string") return "";
  const trimmed = raw.trim().replace(/\s+/g, " ");
  if (!trimmed) return "";
  const noControls = trimmed.replace(/[\u0000-\u001F\u007F]/g, "");
  const max = 80;
  return noControls.length > max ? noControls.slice(0, max) : noControls;
}

function buildSystemInstruction(lang, displayName, questions) {
  const langName = lang === "en" ? "English" : "French";
  const newSheetExample = lang === "en"
    ? `"Sure, let's start a new sheet! [NOUVELLE_FICHE]"`
    : `"Bien sûr, lançons une nouvelle fiche ! [NOUVELLE_FICHE]"`;

  let text =
    SYSTEM_INSTRUCTION_BASE +
    `\n\nCommunicate exclusively in ${langName}. All your responses must be in ${langName}.` +
    `\n\nWhen you include the [NOUVELLE_FICHE] marker, your confirmation sentence must also be in ${langName} — for example: ${newSheetExample}`;

  if (displayName) {
    text += `\n\nUser context: The person you are assisting has set their display name to "${displayName}". Use it when addressing them when it fits naturally. If they ask what their name is (or similar), answer using this display name.`;
  }

  if (Array.isArray(questions)) {
    text += `\n\nCurrent tech-sheet questionnaire (JSON):\n${JSON.stringify(questions)}\n` +
      `\nThe user can customize this questionnaire by chatting with you. When, and ONLY when, the user clearly asks to change it, emit one or more of the following markers at the VERY END of your reply, each on its own line. Fields are separated by a pipe character ("|"). Do not invent extra fields. Never emit these markers outside of an explicit user request to change the questionnaire.\n` +
      `\nGrammar:\n` +
      `[CUSTOMIZE_ADD_OPTION|question=<existing-key>|value=<text>]\n` +
      `[CUSTOMIZE_REMOVE_OPTION|question=<existing-key>|value=<text>]\n` +
      `[CUSTOMIZE_ADD_QUESTION|key=<new-snake-case-key>|question=<text>|answers=<comma,separated,values>]\n` +
      `[CUSTOMIZE_REMOVE_QUESTION|key=<existing-key>]\n` +
      `[CUSTOMIZE_RENAME_QUESTION|key=<existing-key>|newQuestion=<text>]\n` +
      `[CUSTOMIZE_RENAME_OPTION|question=<existing-key>|old=<text>|new=<text>]\n` +
      `[CUSTOMIZE_RESET]\n` +
      `\nRules:\n` +
      `- "question" / "key" must exactly match an existing key from the JSON above, except for CUSTOMIZE_ADD_QUESTION where you generate a short new snake_case key (lowercase ASCII, no spaces) that does not collide with any existing key.\n` +
      `- Field values may contain spaces and accented characters, but must not contain the characters "|" or "]".\n` +
      `- Always also write a short natural-language confirmation in the body of your reply (the markers are stripped from the displayed text before the user sees it).\n` +
      `- If the user asks for something ambiguous, ask a clarifying question and do NOT emit any marker.\n`;
  }

  return text;
}

const MAX_QUESTIONS = 50;
const MAX_QUESTIONS_JSON_BYTES = 10_000;

function validateQuestions(raw) {
  if (raw === undefined || raw === null) return { ok: true, value: undefined };
  if (!Array.isArray(raw)) return { ok: false, reason: "questions must be an array" };
  if (raw.length > MAX_QUESTIONS) return { ok: false, reason: `too many questions (>${MAX_QUESTIONS})` };

  let serialized;
  try {
    serialized = JSON.stringify(raw);
  } catch {
    return { ok: false, reason: "questions not serializable" };
  }
  if (Buffer.byteLength(serialized, "utf8") > MAX_QUESTIONS_JSON_BYTES) {
    return { ok: false, reason: "questions payload too large" };
  }

  const seen = new Set();
  for (const q of raw) {
    if (!q || typeof q !== "object") return { ok: false, reason: "each question must be an object" };
    if (typeof q.key !== "string" || !q.key) return { ok: false, reason: "question.key must be a non-empty string" };
    if (seen.has(q.key)) return { ok: false, reason: `duplicate key "${q.key}"` };
    seen.add(q.key);
    if (typeof q.question !== "string" || !q.question) return { ok: false, reason: "question.question must be a non-empty string" };
    if (!Array.isArray(q.answers)) return { ok: false, reason: "question.answers must be an array" };
    for (const a of q.answers) {
      if (typeof a !== "string") return { ok: false, reason: "each answer must be a string" };
    }
  }
  return { ok: true, value: raw };
}

function toGeminiContents(messages) {
  return messages.map((m) => {
    const role = m.role === "assistant" ? "model" : "user";
    const text = String(m.content ?? "").trim();
    return { role, parts: [{ text }] };
  });
}

function extractSources(candidate) {
  const chunks = candidate?.groundingMetadata?.groundingChunks;
  if (!chunks?.length) return { sources: [], webSearchQueries: [] };

  const seen = new Set();
  const sources = [];
  for (const chunk of chunks) {
    const web = chunk.web;
    if (!web?.uri) continue;
    if (seen.has(web.uri)) continue;
    seen.add(web.uri);
    sources.push({ title: web.title || web.domain || "Source", uri: web.uri });
  }

  const webSearchQueries =
    candidate?.groundingMetadata?.webSearchQueries?.filter(Boolean) ?? [];

  return { sources, webSearchQueries };
}

app.get("/api/health", (_req, res) => {
  const keyOk = Boolean(readApiKey());
  res.json({
    ok: true,
    geminiConfigured: keyOk,
    model: MODEL,
    ...(!keyOk && {
      envHelp: {
        expectedPath: envPaths[0],
        rootEnvExists: fs.existsSync(envPaths[0]),
        cwdEnvExists: fs.existsSync(envPaths[1]),
        cwd: process.cwd(),
      },
    }),
  });
});

function normalizeKey(raw) {
  if (!raw) return "";
  return raw
    .trim()
    .replace(/^\uFEFF/, "")
    .replace(/^["']|["']$/g, "");
}

/** Supports GEMINI_API_KEY or GOOGLE_API_KEY (both used in Google docs). */
function readApiKey() {
  const raw =
    process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
  return normalizeKey(raw);
}

app.post("/api/chat", async (req, res) => {
  const apiKey = readApiKey();
  if (!apiKey) {
    return res.status(503).json({
      error:
        "Missing GEMINI_API_KEY. Copy .env.example to .env and add your key.",
    });
  }

  const { messages, language, userName, username, questions } = req.body ?? {};
  const lang = language === "en" ? "en" : "fr";
  const displayName = sanitizeDisplayName(
    typeof userName === "string" ? userName : typeof username === "string" ? username : ""
  );
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "Expected a non-empty messages array." });
  }

  const qCheck = validateQuestions(questions);
  if (!qCheck.ok) {
    return res.status(400).json({ error: `Invalid questions: ${qCheck.reason}` });
  }

  const last = messages[messages.length - 1];
  if (last?.role !== "user") {
    return res.status(400).json({ error: "Last message must be from the user." });
  }

  const contents = toGeminiContents(messages);
  const empty = contents.some((c) => !c.parts[0]?.text);
  if (empty) {
    return res.status(400).json({ error: "Messages must include non-empty text." });
  }

  try {
    const ai = new GoogleGenAI({ apiKey });

    const baseConfig = {
      systemInstruction: buildSystemInstruction(lang, displayName, qCheck.value),
    };
    const withSearch = { ...baseConfig, tools: [{ googleSearch: {} }] };

    let response;
    try {
      response = await ai.models.generateContent({
        model: MODEL,
        contents,
        config: withSearch,
      });
    } catch (searchErr) {
      console.warn(
        "Gemini with Google Search failed, retrying without web search:",
        searchErr?.message || searchErr
      );
      response = await ai.models.generateContent({
        model: MODEL,
        contents,
        config: baseConfig,
      });
    }

    let text = response.text?.trim();
    const candidate = response.candidates?.[0];
    const blockReason = response.promptFeedback?.blockReason;

    if (!text && candidate?.content?.parts?.length) {
      text = candidate.content.parts
        .map((p) => p.text)
        .filter(Boolean)
        .join("")
        .trim();
    }

    if (!text) {
      const reason = blockReason
        ? `Blocked (${blockReason}).`
        : candidate?.finishReason
          ? `No text (finish: ${candidate.finishReason}).`
          : "The model returned an empty reply.";
      return res.status(502).json({ error: reason });
    }

    const { sources, webSearchQueries } = extractSources(candidate);

    res.json({ text, sources, webSearchQueries });
  } catch (err) {
    console.error(err);
    const message =
      err?.message || "Request to Gemini failed. Check the server logs.";
    res.status(500).json({ error: message });
  }
});

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => {
  console.log(`AJ Revetement assistant → http://localhost:${PORT}`);
  const keyOk = Boolean(readApiKey());
  console.log(
    keyOk
      ? "[env] Gemini API key loaded."
      : "[env] No API key found. Put GEMINI_API_KEY=... in a file named exactly `.env` next to package.json (not .env.txt)."
  );
  if (!keyOk) {
    console.log("[env] Checked:", envPaths.join(" | "));
    console.log(
      "[env] Exists:",
      envPaths.map((p) => `${fs.existsSync(p) ? "yes" : "no"} ${p}`).join(" | ")
    );
  }
});
