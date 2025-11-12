(function () {
  const $ = (sel) => document.querySelector(sel);
  const endpointInput = "#endpoint";
  const textInput = $("#text");
  const modelInput = $("#model");
  const encodingSelect = $("#encoding");
  const rateInput = $("#rate");
  const speakBtn = $("#speak");
  const player = $("#player");
  const download = $("#download");
  const status = $("#status");
  const metaEl = $("#meta");

  // Voice filters & selection
  const archInput = $("#arch");
  const langInput = $("#lang");
  const accInput = $("#acc");
  const genderSelect = $("#gender");
  const voiceSelect = $("#voice");
  const loadVoicesBtn = $("#load-voices");
  const voiceSample = $("#voice-sample");

  // Advanced settings controls
  const deepgramUrlInput = $("#deepgram_api_url");
  const advancedToggle = $("#advanced-toggle");
  const advancedPanel = $("#advanced");

  // Restore base URL
  const savedBase = localStorage.getItem("tts_base_url");
  $(endpointInput).value = savedBase || window.location.origin;

  $(endpointInput).addEventListener("change", () => {
    localStorage.setItem("tts_base_url", $(endpointInput).value.trim());
  });

  function setBusy(isBusy, msg = "") {
    speakBtn.disabled = isBusy;
    status.textContent = msg;
  }

  function baseUrl() {
    return (($(endpointInput).value || window.location.origin)).replace(/\/$/, "");
  }

  function deepgramBaseUrl() {
    const v = (deepgramUrlInput?.value || "").trim();
    if (v) return v.replace(/\/$/, "");
    return "https://api.deepgram.com";
  }

  function persistFilters() {
    localStorage.setItem("tts_filters", JSON.stringify({
      arch: archInput?.value || "",
      lang: langInput?.value || "",
      acc: accInput?.value || "",
      gender: genderSelect?.value || "",
    }));
  }

  function restoreFilters() {
    try {
      const s = localStorage.getItem("tts_filters");
      if (!s) return;
      const f = JSON.parse(s);
      if (archInput && f.arch) archInput.value = f.arch;
      if (langInput && f.lang) langInput.value = f.lang;
      if (accInput && f.acc) accInput.value = f.acc;
      if (genderSelect && typeof f.gender === "string") genderSelect.value = f.gender;
    } catch (_) {}
  }

  async function loadConfig() {
    try {
      const res = await fetch(`${baseUrl()}/api/config`);
      if (res.ok) {
        const cfg = await res.json();
        const saved = localStorage.getItem("deepgram_api_url");
        deepgramUrlInput.value = (saved || cfg.deepgram_api_url || "https://api.deepgram.com");
      } else {
        deepgramUrlInput.value = localStorage.getItem("deepgram_api_url") || "https://api.deepgram.com";
      }
    } catch {
      deepgramUrlInput.value = localStorage.getItem("deepgram_api_url") || "https://api.deepgram.com";
    }
  }

  if (deepgramUrlInput) {
    deepgramUrlInput.addEventListener("change", () => {
      localStorage.setItem("deepgram_api_url", deepgramUrlInput.value.trim());
    });
  }

  if (advancedToggle && advancedPanel) {
    advancedToggle.addEventListener("click", () => {
      advancedPanel.classList.toggle("hidden");
    });
  }

  function populateSelect(select, values, { placeholder, preserve, preferred } = {}) {
    if (!select) return;
    const prev = preserve ? select.value : "";
    select.innerHTML = "";
    if (placeholder) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = placeholder;
      select.appendChild(opt);
    }
    for (const v of values) {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = v;
      select.appendChild(opt);
    }
    if (preferred && values.includes(preferred)) {
      select.value = preferred;
    } else if (preserve && prev && Array.from(select.options).some(o => o.value === prev)) {
      select.value = prev;
    }
  }

  async function fetchVoices() {
    if (!archInput || !voiceSelect) return;
    persistFilters();
    const params = new URLSearchParams();
    if (archInput.value) params.set("architecture", archInput.value.trim());
    if (langInput && langInput.value) params.set("language", langInput.value.trim());
    if (accInput && accInput.value) params.set("accent", accInput.value.trim());
    if (genderSelect && genderSelect.value) params.set("gender", genderSelect.value.trim());
    const apiUrl = deepgramBaseUrl();
    if (apiUrl) params.set("api_url", apiUrl);

    const url = `${baseUrl()}/api/voices?${params.toString()}`;
    setBusy(true, "Loading voices...");
    voiceSelect.innerHTML = "";
    voiceSample.classList.add("hidden");
    voiceSample.removeAttribute("href");
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data = await res.json();
      const voices = (data && data.voices) || [];
      const facets = (data && data.facets) || {};

      // Populate dropdowns from facets
      const archs = Array.isArray(facets.architectures) ? facets.architectures : [];
      const langs = Array.isArray(facets.languages) ? facets.languages : [];
      const accs = Array.isArray(facets.accents) ? facets.accents : [];
      populateSelect(archInput, archs, { placeholder: "Any", preserve: true, preferred: "aura-2" });
      populateSelect(langInput, langs, { placeholder: "Any", preserve: true });
      populateSelect(accInput, accs, { placeholder: "Any", preserve: true });

      for (const v of voices) {
        const opt = document.createElement("option");
        // Prefer canonical_name as model identifier
        opt.value = v.canonical_name || v.name || "";
        const accent = v?.metadata?.accent ? ` – ${v.metadata.accent}` : "";
        opt.textContent = `${v.name || v.canonical_name}${accent}`;
        if (v?.metadata?.sample) opt.dataset.sample = v.metadata.sample;
        voiceSelect.appendChild(opt);
      }

      if (voices.length > 0) {
        // Default model to first voice
        modelInput.value = voiceSelect.value || modelInput.value;
        const sel = voiceSelect.selectedOptions[0];
        if (sel && sel.dataset.sample) {
          voiceSample.href = sel.dataset.sample;
          voiceSample.classList.remove("hidden");
        }
      }
      setBusy(false, voices.length ? `Loaded ${voices.length} voices` : "No voices found");
    } catch (e) {
      console.error(e);
      alert(`Failed to load voices: ${e.message || e}`);
      setBusy(false, "Error");
    }
  }

  if (loadVoicesBtn) loadVoicesBtn.addEventListener("click", fetchVoices);
  if (voiceSelect) voiceSelect.addEventListener("change", () => {
    modelInput.value = voiceSelect.value || modelInput.value;
    const sel = voiceSelect.selectedOptions[0];
    if (sel && sel.dataset.sample) {
      voiceSample.href = sel.dataset.sample;
      voiceSample.classList.remove("hidden");
    } else {
      voiceSample.classList.add("hidden");
      voiceSample.removeAttribute("href");
    }
  });

  async function speak() {
    const base = baseUrl();
    const dgUrl = deepgramBaseUrl();
    const url = `${base}/api/tts?${new URLSearchParams({ api_url: dgUrl }).toString()}`;
    const text = textInput.value.trim();
    if (!text) {
      alert("Please enter text to synthesize.");
      return;
    }

    setBusy(true, "Synthesizing...");
    download.classList.add("hidden");
    player.removeAttribute("src");
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          model: modelInput.value.trim() || "aura-2-thalia-en",
          encoding: "linear16",
          sample_rate: parseInt(rateInput.value, 10) || 16000,
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`${res.status} ${res.statusText} - ${errText}`);
      }

      const dgMeta = {
        requestId: res.headers.get("dg-request-id"),
        modelName: res.headers.get("dg-model-name"),
        modelUuid: res.headers.get("dg-model-uuid"),
        charCount: res.headers.get("dg-char-count"),
        projectId: res.headers.get("dg-project-id"),
        error: res.headers.get("dg-error"),
        speakUrl: res.headers.get("dg-speak-url"),
      };
      if (metaEl) {
        const rows = [
          ["Speak URL", dgMeta.speakUrl],
          ["Text", text],
          ["Request ID", dgMeta.requestId],
          ["Model", dgMeta.modelName],
          ["Model UUID", dgMeta.modelUuid],
          ["Characters", dgMeta.charCount],
          ["Project", dgMeta.projectId],
          ["Error", dgMeta.error],
        ].filter(([, v]) => v && String(v).trim() !== "");
        metaEl.innerHTML = rows.length
          ? `<ul>${rows.map(([k,v]) => `<li><strong>${k}:</strong> ${v}</li>`).join("")}</ul>`
          : "";
      }
      console.info("Deepgram metadata", dgMeta);

      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      player.src = objectUrl;
      player.play().catch(() => {});

      download.href = objectUrl;
      download.classList.remove("hidden");
      setBusy(false, "Done");
    } catch (e) {
      console.error(e);
      alert(`TTS failed: ${e.message || e}`);
      setBusy(false, "Error");
    }
  }

  speakBtn.addEventListener("click", speak);
  restoreFilters();
  loadConfig().then(fetchVoices).catch(() => fetchVoices());
  // Auto-load some voices on first load for convenience
  
})();
