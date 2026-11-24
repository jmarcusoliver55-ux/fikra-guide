// Função do Netlify: o agente Fikra Guide.
// A chave fica SÓ na variável de ambiente ANTHROPIC_API_KEY do Netlify.
// Ela nunca vai para o navegador nem para o GitHub.

import { interviewPrompt, INTERVIEW_TOOLS, CV_PROMPT, CV_TOOL, LANGUAGES } from "./prompts.mjs";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-5-5";
const API_URL = "https://api.anthropic.com/v1/messages";

// Limites para proteger os créditos (Anthropic e Netlify).
export const MAX_MESSAGES = 60;          // mensagens por conversa
const MAX_USER_CHARS = 4000;
const MAX_ASSISTANT_CHARS = 8000;
const MAX_PROFILE_CHARS = 12000;
const MAX_TOKENS = { interview: 1500, cv: 4000 };

const PROFILE_KEYS = ["name", "city", "contact", "experience", "education", "languages", "skills", "availability"];

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

// ---------- validação e limpeza ----------

// Limpa o histórico em vez de recusar: remove mensagens vazias e junta
// mensagens seguidas do mesmo lado, para a conversa nunca "travar".
export function cleanMessages(messages) {
  const out = [];
  for (const m of messages) {
    if (!m || (m.role !== "user" && m.role !== "assistant") || typeof m.content !== "string") continue;
    const content = m.content.trim().slice(0, m.role === "user" ? MAX_USER_CHARS : MAX_ASSISTANT_CHARS);
    if (!content) continue;
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content += "\n" + content;
    else out.push({ role: m.role, content });
  }
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}

export function cleanProfile(p) {
  const out = {};
  if (!p || typeof p !== "object") return out;
  for (const k of PROFILE_KEYS) if (p[k] !== undefined) out[k] = p[k];
  return out;
}

export function validate(body) {
  if (!body || typeof body !== "object") return "invalid body";
  const { mode, lang } = body;
  if (mode !== "interview" && mode !== "cv") return "invalid mode";
  if (!Object.hasOwn(LANGUAGES, lang)) return "invalid language";
  if (JSON.stringify(body.profile || {}).length > MAX_PROFILE_CHARS) return "profile too large";

  if (mode === "interview") {
    if (!Array.isArray(body.messages)) return "messages required";
    if (body.messages.length > MAX_MESSAGES) return "conversation too long";
    const last = body.messages[body.messages.length - 1];
    if (!last || last.role !== "user" || typeof last.content !== "string" || !last.content.trim()) return "last message must be from user";
    if (last.content.length > MAX_USER_CHARS) return "message too long";
  } else if (!body.profile || typeof body.profile !== "object") {
    return "profile required";
  }
  return null;
}

// ---------- ferramentas do agente ----------

export function applyTools(content, profile) {
  let next = { ...profile };
  let confirm = null;
  const results = [];
  for (const block of content) {
    if (block.type !== "tool_use") continue;
    if (block.name === "update_profile") {
      next = { ...next, ...cleanProfile(block.input) };
      results.push({ type: "tool_result", tool_use_id: block.id, content: "Saved." });
    } else if (block.name === "request_confirmation") {
      confirm = { summary_user_language: String(block.input?.summary_user_language || "") };
      results.push({ type: "tool_result", tool_use_id: block.id, content: "The summary is now shown to the person with buttons to confirm or correct." });
    } else {
      results.push({ type: "tool_result", tool_use_id: block.id, content: "Unknown tool.", is_error: true });
    }
  }
  return { profile: next, confirm, results };
}

const textOf = (content) => content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();

async function callClaude(key, payload) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("Anthropic API error", res.status, detail.slice(0, 300));
    const err = new Error("ai error");
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// Um turno da entrevista: o agente pode usar ferramentas e, se não tiver
// escrito nada para a pessoa, recebe o resultado e escreve a mensagem.
export async function interviewTurn(key, body) {
  const messages = cleanMessages(body.messages);
  if (!messages.length) messages.push({ role: "user", content: body.messages[body.messages.length - 1].content.trim() });
  let profile = cleanProfile(body.profile);

  const first = await callClaude(key, {
    model: MODEL,
    max_tokens: MAX_TOKENS.interview,
    system: interviewPrompt(body.lang, profile),
    tools: INTERVIEW_TOOLS,
    messages,
  });
  const content = first.content || [];
  const applied = applyTools(content, profile);
  profile = applied.profile;
  let reply = textOf(content);

  if (!reply && applied.results.length) {
    // Reenvia só os campos que a API aceita (a resposta pode trazer campos extras).
    const echoed = content
      .map((b) => (b.type === "text" ? { type: "text", text: b.text } : b.type === "tool_use" ? { type: "tool_use", id: b.id, name: b.name, input: b.input || {} } : null))
      .filter(Boolean);
    try {
      const second = await callClaude(key, {
        model: MODEL,
        max_tokens: 600,
        system: interviewPrompt(body.lang, profile),
        tools: INTERVIEW_TOOLS,
        tool_choice: { type: "none" },
        messages: [...messages, { role: "assistant", content: echoed }, { role: "user", content: applied.results }],
      });
      reply = textOf(second.content || []);
    } catch {
      // Reserva: pede só a próxima mensagem, sem ferramentas, com o perfil já salvo.
      const note = applied.confirm
        ? "(The summary is now shown to the person. Ask them to check it and confirm or correct.)"
        : "(Your notes were saved. Now write your next short message to the person.)";
      const last = messages[messages.length - 1];
      const plain = await callClaude(key, {
        model: MODEL,
        max_tokens: 600,
        system: interviewPrompt(body.lang, profile),
        messages: [...messages.slice(0, -1), { role: "user", content: last.content + "\n\n" + note }],
      });
      reply = textOf(plain.content || []);
    }
  }

  return {
    reply,
    profile,
    confirm: applied.confirm,
    truncated: first.stop_reason === "max_tokens",
    tools_used: content.filter((b) => b.type === "tool_use").map((b) => b.name),
  };
}

export async function cvTurn(key, body) {
  const data = await callClaude(key, {
    model: MODEL,
    max_tokens: MAX_TOKENS.cv,
    system: CV_PROMPT,
    tools: [CV_TOOL],
    tool_choice: { type: "tool", name: "write_cv" },
    messages: [{ role: "user", content: "Confirmed profile:\n" + JSON.stringify(cleanProfile(body.profile)) }],
  });
  const call = (data.content || []).find((b) => b.type === "tool_use" && b.name === "write_cv");
  if (!call || !call.input?.pt || !call.input?.en) throw Object.assign(new Error("cv format error"), { status: 0 });
  return { cv: call.input };
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
  if (problem) {
    console.error("Rejected request:", problem);
    return json(400, { error: problem });
  }

  try {
    const out = body.mode === "interview" ? await interviewTurn(key, body) : await cvTurn(key, body);
    return json(200, out);
  } catch (e) {
    return json(502, { error: e.message || "ai error", status: e.status });
  }
};

export const config = { path: "/api/agent" };
