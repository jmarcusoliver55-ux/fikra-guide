// Função do Netlify que conversa com a API do Claude.
// A chave fica SÓ na variável de ambiente ANTHROPIC_API_KEY do Netlify.
// Ela nunca vai para o navegador nem para o GitHub.

import { interviewPrompt, CV_PROMPT, LANGUAGES } from "./prompts.mjs";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-5-5";
const API_URL = "https://api.anthropic.com/v1/messages";

// Limites para proteger os créditos (Anthropic e Netlify).
const MAX_MESSAGES = 40;          // mensagens por conversa
const MAX_CHARS_PER_MESSAGE = 4000;
const MAX_PROFILE_CHARS = 12000;
const MAX_TOKENS = { interview: 800, cv: 3000 };

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

export function validate(body) {
  if (!body || typeof body !== "object") return "invalid body";
  const { mode, lang } = body;
  if (mode !== "interview" && mode !== "cv") return "invalid mode";
  if (!Object.hasOwn(LANGUAGES, lang)) return "invalid language";

  if (mode === "interview") {
    const { messages } = body;
    if (!Array.isArray(messages) || messages.length === 0) return "messages required";
    if (messages.length > MAX_MESSAGES) return "conversation too long";
    for (const m of messages) {
      if (!m || (m.role !== "user" && m.role !== "assistant")) return "invalid role";
      if (typeof m.content !== "string" || !m.content.trim()) return "empty message";
      if (m.content.length > MAX_CHARS_PER_MESSAGE) return "message too long";
    }
    if (messages[0].role !== "user") return "first message must be from user";
    if (messages[messages.length - 1].role !== "user") return "last message must be from user";
  } else {
    const { profile } = body;
    if (!profile || typeof profile !== "object") return "profile required";
    if (JSON.stringify(profile).length > MAX_PROFILE_CHARS) return "profile too large";
  }
  return null;
}

export function buildRequest(body) {
  if (body.mode === "interview") {
    return {
      model: MODEL,
      max_tokens: MAX_TOKENS.interview,
      system: interviewPrompt(body.lang),
      messages: body.messages.map((m) => ({ role: m.role, content: m.content })),
    };
  }
  return {
    model: MODEL,
    max_tokens: MAX_TOKENS.cv,
    system: CV_PROMPT,
    messages: [{ role: "user", content: "Confirmed profile:\n" + JSON.stringify(body.profile) }],
  };
}

export function parseCv(text) {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("no json");
  const cv = JSON.parse(cleaned.slice(start, end + 1));
  if (!cv.pt || !cv.en) throw new Error("missing language");
  return cv;
}

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "method not allowed" });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return json(500, { error: "server not configured" });

  let body;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid json" });
  }

  const problem = validate(body);
  if (problem) return json(400, { error: problem });

  let apiRes;
  try {
    apiRes = await fetch(API_URL, {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(buildRequest(body)),
    });
  } catch {
    return json(502, { error: "ai unavailable" });
  }

  if (!apiRes.ok) {
    // Não repassa detalhes da API para o navegador.
    console.error("Anthropic API error", apiRes.status);
    return json(502, { error: "ai error", status: apiRes.status });
  }

  const data = await apiRes.json();
  const text = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  if (body.mode === "interview") return json(200, { reply: text });

  try {
    return json(200, { cv: parseCv(text) });
  } catch {
    return json(502, { error: "cv format error" });
  }
};

export const config = { path: "/api/agent" };
