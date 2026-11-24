// Fikra Guide — lógica da página.
// Nenhum dado é salvo em servidor: tudo fica na memória desta aba.

(() => {
  const $ = (id) => document.getElementById(id);
  const API = "/api/agent";
  const MAX_MESSAGES = 60;            // igual ao limite do servidor
  const WARN_AT = MAX_MESSAGES - 6;   // mostra as opções antes de chegar ao limite

  const state = { lang: null, messages: [], profile: {}, busy: false, cv: null, call: false };
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
    const set = (id, text) => ($(id).textContent = text);
    set("consentTitle", t.consentTitle);
    $("consentList").replaceChildren(...t.consent.map((p) => el("li", {}, p)));
    set("agreeText", t.agree);
    set("startBtn", t.start);
    set("consentListen", "🔊 " + t.listen);
    $("input").placeholder = t.placeholder;
    set("sendBtn", t.send);
    set("callBtn", "📞 " + t.call);
    set("hangUpBtn", t.hangUp);
    set("recCancel", "✖ " + t.cancel);
    set("recSend", "➤ " + t.sendAudio);
    set("finishBtn", "✅ " + t.finish);
    set("confirmTitle", t.confirmTitle);
    set("listenBtn", "🔊 " + t.listen);
    set("yesBtn", t.confirmYes);
    set("fixBtn", t.confirmFix);
    set("limitText", t.limitTitle);
    set("limitFinish", "✅ " + t.finish);
    set("limitRestart", t.restart);
    set("cvTitle", t.cvTitle);
    set("printBtn", t.print);
    set("linkedinTitle", t.linkedin);
    set("copyBtn", t.copy);
    set("deleteAll", t.deleteAll);
    set("tab-pt", window.CV_LABELS.pt.tab);
    set("tab-en", window.CV_LABELS.en.tab);
    $("micBtn").setAttribute("aria-label", t.mic);
    renderMic();
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
    for (const id of ["sendBtn", "yesBtn", "finishBtn", "limitFinish", "micBtn"]) $(id).disabled = b;
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

  // ---------- fala (texto para voz) ----------
  const canSpeak = "speechSynthesis" in window;

  function pickVoice() {
    if (!canSpeak) return null;
    const voices = speechSynthesis.getVoices();
    const wanted = [t.speech.toLowerCase(), t.speech.slice(0, 2).toLowerCase(), ...(t.voiceFallback ? [t.voiceFallback] : [])];
    for (const w of wanted) {
      const v = voices.find((x) => x.lang.toLowerCase().replace("_", "-").startsWith(w));
      if (v) return v;
    }
    return null;
  }

  // Fala o texto e chama onDone uma única vez quando termina (com reserva de tempo,
  // porque alguns navegadores não avisam o fim da fala).
  function speak(text, onDone) {
    let done = false;
    const finish = () => { if (!done) { done = true; clearTimeout(timer); onDone && onDone(); } };
    const timer = setTimeout(finish, 4000 + (text || "").length * 90);
    if (!canSpeak || !text) { finish(); return; }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = pickVoice();
    if (v) { u.voice = v; u.lang = v.lang; } else { u.lang = t.speech; }
    u.onend = finish;
    u.onerror = finish;
    speechSynthesis.speak(u);
  }
  const stopSpeaking = () => canSpeak && speechSynthesis.cancel();

  // ---------- escuta (voz para texto) ----------
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

  // Junta os trechos reconhecidos sem repetir: no Android o navegador às vezes
  // devolve o mesmo trecho mais de uma vez, ou o texto acumulado de novo.
  function collect(results) {
    let text = "";
    for (const r of results) {
      const s = (r[0]?.transcript || "").trim();
      if (!s) continue;
      const a = text.toLowerCase(), b = s.toLowerCase();
      if (!text || b.startsWith(a)) text = s;
      else if (a.endsWith(b) || a.includes(b)) continue;
      else text = text + " " + s;
    }
    return text.trim();
  }

  const MIC_ERRORS = () => ({
    "language-not-supported": t.micUnsupported,
    "no-speech": t.micNoSpeech,
    "audio-capture": t.micNoDevice,
    "not-allowed": t.micBlocked,
    "service-not-allowed": t.micBlocked,
    "network": t.micNetwork,
  });

  // Abre o microfone. onEnd(texto, erro) é chamado UMA vez, quando termina.
  // Depois disso, qualquer resultado atrasado é ignorado (evita texto voltando).
  function listen({ continuous, onPreview, onEnd }) {
    const rec = new SR();
    let results = [], error = null, closed = false, cancelled = false;
    rec.lang = t.speech;
    rec.interimResults = true;
    rec.continuous = continuous;
    rec.onresult = (e) => {
      if (closed) return;
      results = Array.from(e.results);
      onPreview && onPreview(collect(results));
    };
    rec.onerror = (e) => { error = e.error; };
    rec.onend = () => {
      if (closed) return;
      closed = true;
      onEnd(cancelled ? "" : collect(results), cancelled ? null : error);
    };
    try { rec.start(); } catch { closed = true; onEnd("", "start-failed"); }
    return {
      stop() { try { rec.stop(); } catch { /* já parado */ } },
      cancel() { cancelled = true; try { rec.abort(); } catch { /* já parado */ } },
    };
  }

  // ---------- áudio estilo WhatsApp: toca, fala, toca de novo e envia ----------
  let note = null;

  function renderMic() {
    const recording = !!note;
    $("micBtn").textContent = recording ? "⏹" : "🎤";
    $("micBtn").classList.toggle("on", recording);
    $("recBar").hidden = !recording;
    $("composer").classList.toggle("recording", recording);
  }

  function startNote() {
    if (!SR) { setStatus(t.micUnsupported); return; }
    if (state.busy) return;
    stopSpeaking();
    setStatus("");
    $("recPreview").textContent = t.recording;
    note = listen({
      continuous: true,
      onPreview: (text) => ($("recPreview").textContent = text || t.recording),
      onEnd: (text, error) => {
        const wasSending = note && note.sending;
        note = null;
        renderMic();
        if (!wasSending) { if (error && error !== "aborted") setStatus(MIC_ERRORS()[error] || ""); return; }
        if (text) sendUser(text, { audio: true });
        else setStatus(MIC_ERRORS()[error] || t.micNoSpeech);
      },
    });
    renderMic();
  }

  function sendNote() { if (note) { note.sending = true; note.stop(); } }
  function cancelNote() { if (note) { note.cancel(); } }

  // ---------- conversa por voz (como uma chamada) ----------
  let callRec = null;
  let silentTries = 0;

  function renderCall() {
    $("callBar").hidden = !state.call;
    $("callBtn").hidden = state.call || !SR;
    $("micBtn").hidden = state.call;
  }

  function startCall() {
    if (!SR) { setStatus(t.micUnsupported); return; }
    cancelNote();
    state.call = true;
    silentTries = 0;
    renderCall();
    const last = [...state.messages].reverse().find((m) => m.role === "assistant");
    if (!$("confirmCard").hidden) speak(t.confirmTitle + " " + $("confirmSummary").textContent + " " + t.sayYes, callListen);
    else if (last) speak(last.content, callListen);
    else callListen();
  }

  function endCall() {
    state.call = false;
    if (callRec) { callRec.cancel(); callRec = null; }
    stopSpeaking();
    $("callStatus").textContent = "";
    renderCall();
    setStatus("");
  }

  function isYes(text) {
    const s = text.toLowerCase().replace(/[.,!?¡¿،]/g, " ").trim();
    return (t.yesWords || []).some((w) => s === w || s.startsWith(w + " "));
  }

  function callListen() {
    if (!state.call || state.busy) return;
    $("callStatus").textContent = "🎤 " + t.callListening;
    callRec = listen({
      continuous: false, // termina sozinho quando a pessoa faz uma pausa
      onPreview: (text) => ($("callStatus").textContent = "🎤 " + (text || t.callListening)),
      onEnd: (text, error) => {
        callRec = null;
        if (!state.call) return;
        if (text) {
          silentTries = 0;
          $("callStatus").textContent = t.thinking;
          if (!$("confirmCard").hidden && isYes(text)) { addBubble("user", "🎤 " + text); generateCv(); }
          else sendUser(text, { audio: true });
          return;
        }
        if (error && !["no-speech", "aborted"].includes(error)) {
          $("callStatus").textContent = MIC_ERRORS()[error] || t.micNoSpeech;
          return;
        }
        silentTries += 1;
        if (silentTries < 3) callListen();
        else $("callStatus").textContent = t.tapToTalk;
      },
    });
  }

  // Depois de cada resposta do agente durante a chamada: fala e volta a ouvir.
  function callSay(text) {
    if (!state.call) return;
    $("callStatus").textContent = "🔊 " + t.speaking;
    speak(text, callListen);
  }

  // ---------- conversa ----------
  function addBubble(role, text) {
    const b = el("div", { class: "msg " + role }, text);
    if (role === "assistant" && canSpeak) {
      const again = el("button", { type: "button", class: "replay", "aria-label": t.listen }, "🔊");
      again.addEventListener("click", () => speak(text));
      b.append(again);
    }
    $("messages").append(b);
    b.scrollIntoView({ block: "end", behavior: "smooth" });
  }

  function updateControls() {
    $("finishBtn").hidden = !state.profile.name || !$("confirmCard").hidden;
    $("limitCard").hidden = state.messages.length < WARN_AT;
  }

  async function sendUser(text, { hidden = false, audio = false } = {}) {
    text = (text || "").trim();
    if (state.busy || !text) return;
    if (state.messages.length + 1 > MAX_MESSAGES) { updateControls(); setStatus(t.tooLong); return; }
    state.messages.push({ role: "user", content: text });
    if (!hidden) addBubble("user", (audio ? "🎤 " : "") + text);
    setBusy(true);
    setStatus(t.thinking);
    let spoken = "";
    try {
      const data = await callAgent({ mode: "interview", lang: state.lang, messages: state.messages, profile: state.profile });
      if (data.profile) state.profile = data.profile;
      if (data.reply) {
        state.messages.push({ role: "assistant", content: data.reply });
        addBubble("assistant", data.reply);
        spoken = data.reply;
      }
      if (data.confirm) {
        showConfirm(data.confirm.summary_user_language);
        spoken = [spoken, t.confirmTitle, data.confirm.summary_user_language, t.sayYes].filter(Boolean).join(" ");
      }
      setStatus("");
    } catch {
      state.messages.pop();
      if (!hidden && !audio) $("input").value = text;  // texto digitado volta para reenviar
      setStatus(t.error);
      spoken = t.error;
    } finally {
      setBusy(false);
      updateControls();
    }
    if (state.call) callSay(spoken);
  }

  function showConfirm(summary) {
    $("confirmSummary").textContent = summary || "";
    $("confirmCard").hidden = false;
    updateControls();
    $("confirmCard").scrollIntoView({ block: "start", behavior: "smooth" });
  }

  // ---------- currículo ----------
  async function generateCv() {
    if (!state.profile.name || state.busy) return;
    setBusy(true);
    setStatus(t.generating);
    if (state.call) { $("callStatus").textContent = t.generating; }
    try {
      const { cv } = await callAgent({ mode: "cv", lang: state.lang, profile: state.profile });
      state.cv = cv;
      renderCv("pt", cv.pt);
      renderCv("en", cv.en);
      selectTab("pt");
      setStatus("");
      const wasCall = state.call;
      endCall();
      show("cv");
      if (wasCall) speak(t.cvReady);
    } catch {
      setStatus(t.error);
      if (state.call) callSay(t.error);
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

    section(L.experience, (d.experience || []).filter((x) => x.role).map((x) => {
      const sub = [x.place, x.country, x.period].filter(Boolean).join(" · ");
      const bullets = (x.bullets || []).filter(Boolean);
      const ul = bullets.length ? el("ul", {}, ...bullets.map((b) => el("li", {}, b))) : null;
      return el("div", { class: "item" }, el("strong", {}, x.role), sub ? el("span", { class: "sub" }, sub) : null, ul);
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

  // ---------- apagar tudo ----------
  function deleteAll() {
    if (!confirm(t.deleteConfirm)) return;
    endCall();
    cancelNote();
    location.reload(); // a memória da aba é descartada; nada foi salvo em servidor
  }

  // ---------- eventos ----------
  $("langButtons").replaceChildren(...Object.entries(window.I18N).map(([code, s]) => {
    const b = el("button", { type: "button", lang: s.speech, dir: s.dir }, s.name);
    b.addEventListener("click", () => { applyLanguage(code); show("consent"); });
    return b;
  }));
  if (canSpeak) speechSynthesis.getVoices(); // carrega a lista de vozes

  $("consentListen").addEventListener("click", () => speak([t.consentTitle, ...t.consent, t.agree].join(". ")));
  $("agreeBox").addEventListener("change", (e) => ($("startBtn").disabled = !e.target.checked));
  $("startBtn").addEventListener("click", () => { show("chat"); renderCall(); sendUser(t.starter, { hidden: true }); });
  $("composer").addEventListener("submit", (e) => {
    e.preventDefault();
    const text = $("input").value;
    $("input").value = "";
    sendUser(text);
  });
  $("input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("composer").requestSubmit(); }
  });
  $("micBtn").addEventListener("click", () => (note ? sendNote() : startNote()));
  $("recSend").addEventListener("click", sendNote);
  $("recCancel").addEventListener("click", cancelNote);
  $("callBtn").addEventListener("click", startCall);
  $("hangUpBtn").addEventListener("click", endCall);
  $("callStatus").addEventListener("click", () => { if (state.call && !callRec && !state.busy) { silentTries = 0; callListen(); } });
  $("finishBtn").addEventListener("click", () => sendUser(t.finishNow, { hidden: true }));
  $("limitFinish").addEventListener("click", () => sendUser(t.finishNow, { hidden: true }));
  $("limitRestart").addEventListener("click", deleteAll);
  $("listenBtn").addEventListener("click", () => speak($("confirmSummary").textContent));
  $("fixBtn").addEventListener("click", () => { $("confirmCard").hidden = true; updateControls(); setStatus(t.fixHint); $("input").focus(); });
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
