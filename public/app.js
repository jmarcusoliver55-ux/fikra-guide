// Fikra Guide — lógica da página.
// Nenhum dado é salvo em servidor: tudo fica na memória desta aba.

(() => {
  const $ = (id) => document.getElementById(id);
  const API = "/api/agent";
  const MAX_MESSAGES = 40;

  const state = { lang: null, messages: [], profile: null, busy: false, cv: null };
  let t = window.I18N.en;

  // ---------- telas ----------
  function show(screen) {
    for (const s of document.querySelectorAll(".screen")) s.hidden = s.id !== "screen-" + screen;
    $("deleteAll").hidden = screen === "lang";
    window.scrollTo(0, 0);
  }

  function applyLanguage(lang) {
    state.lang = lang;
    t = window.I18N[lang];
    document.documentElement.lang = t.speech;
    document.documentElement.dir = t.dir;
    $("consentTitle").textContent = t.consentTitle;
    $("consentList").replaceChildren(...t.consent.map((p) => el("li", {}, p)));
    $("agreeText").textContent = t.agree;
    $("startBtn").textContent = t.start;
    $("input").placeholder = t.placeholder;
    $("sendBtn").textContent = t.send;
    $("micBtn").textContent = "🎤 " + t.mic;
    $("confirmTitle").textContent = t.confirmTitle;
    $("listenBtn").textContent = "🔊 " + t.listen;
    $("yesBtn").textContent = t.confirmYes;
    $("fixBtn").textContent = t.confirmFix;
    $("cvTitle").textContent = t.cvTitle;
    $("printBtn").textContent = t.print;
    $("linkedinTitle").textContent = t.linkedin;
    $("copyBtn").textContent = t.copy;
    $("deleteAll").textContent = t.deleteAll;
    $("tab-pt").textContent = window.CV_LABELS.pt.tab;
    $("tab-en").textContent = window.CV_LABELS.en.tab;
  }

  // ---------- utilidades ----------
  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    for (const c of children) if (c !== null && c !== undefined && c !== "") node.append(c);
    return node;
  }
  const setStatus = (msg) => ($("status").textContent = msg || "");

  function setBusy(b) {
    state.busy = b;
    $("sendBtn").disabled = b;
    $("yesBtn").disabled = b;
    $("input").disabled = b;
  }

  async function callAgent(payload) {
    const res = await fetch(API, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "error");
    return data;
  }

  // ---------- perfil ----------
  const PROFILE_RE = /<profile>([\s\S]*?)<\/profile>/gi;

  function extractProfile(text) {
    let match, last = null;
    PROFILE_RE.lastIndex = 0;
    while ((match = PROFILE_RE.exec(text))) last = match[1];
    const visible = text.replace(PROFILE_RE, "").trim();
    if (!last) return { visible, profile: null };
    try {
      return { visible, profile: JSON.parse(last.trim()) };
    } catch {
      return { visible, profile: null };
    }
  }

  // ---------- conversa ----------
  function addBubble(role, text) {
    const b = el("div", { class: "msg " + role }, text);
    $("messages").append(b);
    b.scrollIntoView({ block: "end", behavior: "smooth" });
  }

  async function sendUser(text, { hidden = false } = {}) {
    if (state.busy || !text.trim()) return;
    if (state.messages.length + 1 > MAX_MESSAGES) { setStatus(t.tooLong); return; }
    state.messages.push({ role: "user", content: text.trim() });
    if (!hidden) addBubble("user", text.trim());
    setBusy(true);
    setStatus(t.thinking);
    try {
      const { reply } = await callAgent({ mode: "interview", lang: state.lang, messages: state.messages });
      state.messages.push({ role: "assistant", content: reply });
      const { visible, profile } = extractProfile(reply);
      if (visible) addBubble("assistant", visible);
      if (profile) showConfirm(profile);
      setStatus("");
    } catch {
      state.messages.pop(); // permite reenviar
      setStatus(t.error);
    } finally {
      setBusy(false);
      $("input").focus();
    }
  }

  function showConfirm(profile) {
    state.profile = profile;
    $("confirmSummary").textContent = profile.summary_user_language || "";
    $("confirmCard").hidden = false;
    $("confirmCard").scrollIntoView({ block: "start", behavior: "smooth" });
  }

  // ---------- currículo ----------
  async function generateCv() {
    if (!state.profile || state.busy) return;
    setBusy(true);
    setStatus(t.generating);
    try {
      const { summary_user_language, ...profile } = state.profile;
      const { cv } = await callAgent({ mode: "cv", lang: state.lang, profile });
      state.cv = cv;
      renderCv("pt", cv.pt);
      renderCv("en", cv.en);
      $("linkedinText").value = cv.pt.linkedin_about || "";
      selectTab("pt");
      setStatus("");
      show("cv");
    } catch {
      setStatus(t.error);
    } finally {
      setBusy(false);
    }
  }

  function renderCv(lang, d) {
    const L = window.CV_LABELS[lang];
    const box = $("cv-" + lang);
    const parts = [];
    parts.push(el("h1", {}, d.name || ""));
    if (d.headline) parts.push(el("p", { class: "headline" }, d.headline));
    const meta = [d.city, d.contact].filter(Boolean).join(" · ");
    if (meta) parts.push(el("p", { class: "meta" }, meta));

    const section = (title, nodes) => {
      if (!nodes || !nodes.length) return;
      parts.push(el("h2", {}, title), ...nodes);
    };

    if (d.summary) section(L.summary, [el("p", {}, d.summary)]);

    section(L.experience, (d.experience || []).map((x) => {
      const sub = [x.place, x.country, x.period].filter(Boolean).join(" · ");
      const ul = (x.bullets || []).filter(Boolean).length
        ? el("ul", {}, ...x.bullets.filter(Boolean).map((b) => el("li", {}, b)))
        : null;
      return el("div", { class: "item" }, el("strong", {}, x.role || ""), sub ? el("span", { class: "sub" }, sub) : null, ul);
    }));

    section(L.education, (d.education || []).filter((x) => x.course).map((x) => {
      const sub = [x.institution, x.country, x.period].filter(Boolean).join(" · ");
      return el("div", { class: "item" }, el("strong", {}, x.course), sub ? el("span", { class: "sub" }, sub) : null);
    }));

    const langs = (d.languages || []).filter((x) => x.language);
    if (langs.length) section(L.languages, [el("ul", {}, ...langs.map((x) => el("li", {}, x.level ? `${x.language}: ${x.level}` : x.language)))]);

    const skills = (d.skills || []).filter(Boolean);
    if (skills.length) section(L.skills, [el("ul", {}, ...skills.map((s) => el("li", {}, s)))]);

    if (d.availability) section(L.availability, [el("p", {}, d.availability)]);

    parts.push(el("p", { class: "note" }, L.note));
    box.replaceChildren(...parts);
  }

  function selectTab(lang) {
    for (const l of ["pt", "en"]) {
      $("cv-" + l).hidden = l !== lang;
      $("tab-" + l).classList.toggle("active", l === lang);
      $("tab-" + l).setAttribute("aria-selected", String(l === lang));
    }
    if (state.cv) $("linkedinText").value = state.cv[lang].linkedin_about || "";
  }

  // ---------- voz ----------
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null;

  function toggleMic() {
    if (!SR) { setStatus(t.micUnsupported); return; }
    if (rec) { rec.stop(); return; }
    const before = $("input").value.trim();
    let heard = false;
    rec = new SR();
    rec.lang = t.speech;
    rec.interimResults = true;   // mostra o texto enquanto a pessoa fala
    rec.continuous = true;       // só para quando a pessoa tocar no microfone de novo
    rec.onstart = () => { $("micBtn").classList.add("on"); setStatus(t.listening); };
    rec.onresult = (e) => {
      heard = true;
      const said = Array.from(e.results).map((r) => r[0].transcript).join(" ").trim();
      $("input").value = (before + " " + said).trim();
    };
    rec.onerror = (e) => {
      const msg = {
        "language-not-supported": t.micUnsupported,
        "no-speech": t.micNoSpeech,
        "audio-capture": t.micNoDevice,
        "not-allowed": t.micBlocked,
        "service-not-allowed": t.micBlocked,
        "network": t.micNetwork,
      }[e.error];
      if (msg) setStatus(msg);
    };
    rec.onend = () => {
      $("micBtn").classList.remove("on");
      if ($("status").textContent === t.listening) setStatus(heard ? t.micDone : t.micNoSpeech);
      rec = null;
    };
    try { rec.start(); } catch { rec = null; setStatus(t.micUnsupported); }
  }

  function speak(text) {
    if (!("speechSynthesis" in window) || !text) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = t.speech;
    speechSynthesis.speak(u);
  }

  // ---------- apagar tudo ----------
  function deleteAll() {
    if (!confirm(t.deleteConfirm)) return;
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    location.reload(); // a memória da aba é descartada; nada foi salvo em servidor
  }

  // ---------- eventos ----------
  $("langButtons").replaceChildren(...Object.entries(window.I18N).map(([code, s]) => {
    const b = el("button", { type: "button", lang: s.speech, dir: s.dir }, s.name);
    b.addEventListener("click", () => { applyLanguage(code); show("consent"); });
    return b;
  }));

  $("agreeBox").addEventListener("change", (e) => ($("startBtn").disabled = !e.target.checked));
  $("startBtn").addEventListener("click", () => { show("chat"); sendUser(t.starter, { hidden: true }); });
  $("composer").addEventListener("submit", (e) => {
    e.preventDefault();
    const text = $("input").value;
    $("input").value = "";
    sendUser(text);
  });
  $("input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("composer").requestSubmit(); }
  });
  $("micBtn").addEventListener("click", toggleMic);
  $("listenBtn").addEventListener("click", () => speak($("confirmSummary").textContent));
  $("fixBtn").addEventListener("click", () => { $("confirmCard").hidden = true; setStatus(t.fixHint); $("input").focus(); });
  $("yesBtn").addEventListener("click", generateCv);
  $("tab-pt").addEventListener("click", () => selectTab("pt"));
  $("tab-en").addEventListener("click", () => selectTab("en"));
  $("printBtn").addEventListener("click", () => window.print());
  $("copyBtn").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText($("linkedinText").value); }
    catch { $("linkedinText").select(); document.execCommand("copy"); }
    $("copyBtn").textContent = t.copied;
    setTimeout(() => ($("copyBtn").textContent = t.copy), 1500);
  });
  $("deleteAll").addEventListener("click", deleteAll);

  show("lang");
})();
