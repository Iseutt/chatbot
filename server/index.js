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
      if (filePath.endsWith(".css")) {
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

Tone: concise, accurate, and helpful. If search sources support claims, you may mention that information comes from web sources without over-explaining the tool.`;

function buildSystemInstruction(lang) {
  const langName = lang === "en" ? "English" : "French";
  return SYSTEM_INSTRUCTION_BASE + `\n\nCommunicate exclusively in ${langName}. All your responses must be in ${langName}.`;
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

  const { messages, language } = req.body ?? {};
  const lang = language === "en" ? "en" : "fr";
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "Expected a non-empty messages array." });
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

    const baseConfig = { systemInstruction: buildSystemInstruction(lang) };
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
