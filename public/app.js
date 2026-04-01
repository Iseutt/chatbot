const messagesEl = document.getElementById("messages");
const form = document.getElementById("form");
const input = document.getElementById("input");
const sendBtn = document.getElementById("send");
const statusEl = document.getElementById("status");

/** @type {{ role: 'user' | 'assistant', content: string, sources?: {title: string, uri: string}[], webSearchQueries?: string[] }[]} */
let thread = [];

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

function appendMessage(msg) {
  const div = document.createElement("div");
  div.className = `msg ${msg.role}`;
  let html = escapeHtml(msg.content);

  if (msg.role === "assistant" && (msg.sources?.length || msg.webSearchQueries?.length)) {
    const parts = [];
    if (msg.webSearchQueries?.length) {
      parts.push(
        `<div class="queries">Web: ${escapeHtml(msg.webSearchQueries.join(" · "))}</div>`
      );
    }
    if (msg.sources?.length) {
      const items = msg.sources
        .map(
          (s) =>
            `<li><a href="${escapeHtml(s.uri)}" target="_blank" rel="noopener noreferrer">${escapeHtml(s.title)}</a></li>`
        )
        .join("");
      parts.push(`<div class="msg-sources">Sources<ul>${items}</ul></div>`);
    }
    html += parts.join("");
  }

  div.innerHTML = html;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function setLoading(on) {
  sendBtn.disabled = on;
  input.disabled = on;
  statusEl.textContent = on ? "Thinking…" : "";
  statusEl.classList.toggle("error", false);
}

function showTyping() {
  const wrap = document.createElement("div");
  wrap.className = "msg assistant";
  wrap.id = "typing-indicator";
  wrap.innerHTML =
    '<div class="typing"><span></span><span></span><span></span></div>';
  messagesEl.appendChild(wrap);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function removeTyping() {
  document.getElementById("typing-indicator")?.remove();
}

function resizeInput() {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 128)}px`;
}

thread.push({
  role: "assistant",
  content: "How can I help you today?",
});
appendMessage(thread[0]);

if (location.protocol === "file:") {
  appendMessage({
    role: "assistant",
    content:
      "Open this app through the server so the chat can reach the API: run `npm start` in the project folder, then visit http://localhost:3000 — opening the HTML file directly will not work.",
  });
}

async function checkHealth() {
  try {
    const r = await fetch("/api/health");
    const data = await r.json();
    if (!data.geminiConfigured) {
      statusEl.classList.add("error");
      const h = data.envHelp;
      if (h && !h.rootEnvExists && !h.cwdEnvExists) {
        statusEl.textContent =
          "No .env file found. Create .env next to package.json (see .env.example).";
      } else if (h && h.rootEnvExists) {
        statusEl.textContent =
          "Key missing or empty in .env — use GEMINI_API_KEY=yourKey (no spaces).";
      } else {
        statusEl.textContent =
          "Set GEMINI_API_KEY in .env next to package.json, then restart the server.";
      }
    }
  } catch {
    statusEl.textContent = "Server unreachable";
    statusEl.classList.add("error");
  }
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;

  thread.push({ role: "user", content: text });
  appendMessage(thread[thread.length - 1]);
  input.value = "";
  resizeInput();

  setLoading(true);
  showTyping();

  try {
    const apiMessages = thread
      .slice(thread[0]?.role === "assistant" ? 1 : 0)
      .map(({ role, content }) => ({ role, content }));

    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: apiMessages }),
    });
    const data = await res.json().catch(() => ({}));
    removeTyping();

    if (!res.ok) {
      const errText = data.error || `Request failed (${res.status}).`;
      statusEl.textContent = errText;
      statusEl.classList.add("error");
      console.error("Chat API error:", res.status, data);
      appendMessage({
        role: "assistant",
        content: `Sorry — something went wrong.\n\n${errText}`,
      });
      return;
    }

    const assistantMsg = {
      role: "assistant",
      content: data.text,
      sources: data.sources,
      webSearchQueries: data.webSearchQueries,
    };
    thread.push(assistantMsg);
    appendMessage(assistantMsg);
    statusEl.textContent = "";
  } catch (e) {
    removeTyping();
    const hint =
      location.protocol === "file:"
        ? "You are viewing this page as a file. Start the server with npm start and use http://localhost:3000"
        : "Could not reach the server. Is it running (npm start)?";
    statusEl.textContent = "Network error";
    statusEl.classList.add("error");
    console.error(e);
    appendMessage({
      role: "assistant",
      content: `Sorry — ${hint}`,
    });
  } finally {
    setLoading(false);
  }
});

input.addEventListener("input", resizeInput);
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    form.requestSubmit();
  }
});

checkHealth();
