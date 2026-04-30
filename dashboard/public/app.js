/* ============================================================
   RIFF Dashboard — vanilla SPA
   ============================================================ */
(() => {
  "use strict";

  // ----------------------------------------------------------
  // State
  // ----------------------------------------------------------
  const state = {
    project: null,
    phases: [],
    currentPhaseId: null,
    currentPhase: null,
    viewLevel: null, // null → use profile default; set to "technical" / "simple" / "eli5" to override
    activeTab: "explanation",
    skippedExpanded: false,
    eventSource: null,
    genSource: null,
    bootstrapDismissed: false,
  };

  const COLUMN_ORDER = ["todo", "in-progress", "done", "blocked", "skipped"];
  const COLUMN_LABELS = {
    todo: "Todo",
    "in-progress": "In progress",
    done: "Done",
    blocked: "Blocked",
    skipped: "Skipped",
  };

  // ----------------------------------------------------------
  // DOM helpers
  // ----------------------------------------------------------
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const k of Object.keys(attrs)) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k === "class") node.className = v;
        else if (k === "text") node.textContent = v;
        else if (k === "html") node.innerHTML = v;
        else if (k.startsWith("on") && typeof v === "function") {
          node.addEventListener(k.slice(2).toLowerCase(), v);
        } else if (k === "dataset" && typeof v === "object") {
          for (const dk of Object.keys(v)) node.dataset[dk] = v[dk];
        } else {
          node.setAttribute(k, v);
        }
      }
    }
    if (children) {
      const arr = Array.isArray(children) ? children : [children];
      for (const c of arr) {
        if (c == null || c === false) continue;
        node.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
      }
    }
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // ----------------------------------------------------------
  // Theme
  // ----------------------------------------------------------
  function initTheme() {
    const stored = localStorage.getItem("theme") || "dark";
    document.documentElement.setAttribute("data-theme", stored);
    $("#theme-toggle").addEventListener("click", () => {
      const cur = document.documentElement.getAttribute("data-theme");
      const next = cur === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      try {
        localStorage.setItem("theme", next);
      } catch (e) {
        // ignore
      }
    });
  }

  // ----------------------------------------------------------
  // Minimal markdown renderer (paragraphs, headings, bold,
  // italic, code spans, fenced code blocks, lists)
  // ----------------------------------------------------------
  function renderMarkdown(src) {
    if (!src) return "";
    const lines = String(src).replace(/\r\n/g, "\n").split("\n");
    const out = [];
    let i = 0;

    const inlineFmt = (s) => {
      // Escape, then re-introduce inline formatting
      let t = escapeHtml(s);
      // Code spans
      t = t.replace(/`([^`]+)`/g, "<code>$1</code>");
      // Bold then italic
      t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
      t = t.replace(/\*([^*]+)\*/g, "<em>$1</em>");
      t = t.replace(/(^|[\s(])_([^_]+)_(?=[\s).,!?]|$)/g, "$1<em>$2</em>");
      // Auto-link bare URLs
      t = t.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
      return t;
    };

    while (i < lines.length) {
      const line = lines[i];

      // Fenced code
      if (/^```/.test(line)) {
        const buf = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i])) {
          buf.push(lines[i]);
          i++;
        }
        i++; // skip closing fence
        out.push("<pre><code>" + escapeHtml(buf.join("\n")) + "</code></pre>");
        continue;
      }

      // Headings
      const h = line.match(/^(#{1,6})\s+(.*)$/);
      if (h) {
        const level = Math.min(h[1].length, 6);
        out.push(`<h${level}>${inlineFmt(h[2])}</h${level}>`);
        i++;
        continue;
      }

      // Lists
      if (/^\s*[-*+]\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
          items.push(lines[i].replace(/^\s*[-*+]\s+/, ""));
          i++;
        }
        out.push("<ul>" + items.map((it) => "<li>" + inlineFmt(it) + "</li>").join("") + "</ul>");
        continue;
      }

      if (/^\s*\d+\.\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
          items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
          i++;
        }
        out.push("<ol>" + items.map((it) => "<li>" + inlineFmt(it) + "</li>").join("") + "</ol>");
        continue;
      }

      // Blank line
      if (/^\s*$/.test(line)) {
        i++;
        continue;
      }

      // Paragraph (greedy until blank or block start)
      const buf = [line];
      i++;
      while (
        i < lines.length &&
        !/^\s*$/.test(lines[i]) &&
        !/^```/.test(lines[i]) &&
        !/^(#{1,6})\s+/.test(lines[i]) &&
        !/^\s*[-*+]\s+/.test(lines[i]) &&
        !/^\s*\d+\.\s+/.test(lines[i])
      ) {
        buf.push(lines[i]);
        i++;
      }
      // Each line is its own visual line (preserves "one sentence per line" prompt output)
      out.push("<p>" + buf.map((l) => inlineFmt(l)).join("<br>") + "</p>");
    }

    return out.join("\n");
  }

  // Parse "## Metadata" key: value pairs from EXPLAIN-POST.md
  function extractMetadata(src) {
    if (!src) return null;
    const text = String(src);
    // Find "## Metadata" header (or # / ###), capture everything after to end.
    // Conventional: metadata block is ALWAYS last in EXPLAIN-POST files.
    const re = /(?:^|\n)#{1,3}\s*Metadata\s*\n([\s\S]+)$/i;
    const m = text.match(re);
    if (!m) return null;
    const block = m[1];
    const pairs = [];
    const lines = block.split("\n");
    for (const raw of lines) {
      const line = raw.replace(/^\s*[-*+]\s+/, "").trim();
      if (!line) continue;
      // Match `**Key**: value` or `Key: value`
      const kv = line.match(/^(?:\*\*([^*]+)\*\*|([^:]+))\s*:\s*(.+)$/);
      if (kv) {
        const key = (kv[1] || kv[2] || "").trim();
        const value = (kv[3] || "").trim().replace(/^`(.*)`$/, "$1");
        if (key) pairs.push([key, value]);
      }
    }
    return pairs.length ? pairs : null;
  }

  // Strip a top-level metadata section from the rendered body
  function stripMetadataSection(src) {
    if (!src) return src;
    return src.replace(/(^|\n)#{1,3}\s*Metadata\s*\n[\s\S]*?(?=\n#{1,3}\s|$)/i, "$1");
  }

  // ----------------------------------------------------------
  // API
  // ----------------------------------------------------------
  async function api(path, opts) {
    const res = await fetch(path, opts);
    if (!res.ok) throw new Error(`${path}: ${res.status}`);
    return res.json();
  }

  async function loadProject() {
    try {
      state.project = await api("/api/project");
    } catch (e) {
      state.project = { name: "RIFF", root: "", profile: {} };
    }
    renderTopbar();
  }

  async function loadPhases() {
    try {
      const data = await api("/api/phases");
      state.phases = Array.isArray(data?.phases) ? data.phases : [];
    } catch (e) {
      state.phases = [];
    }
    renderKanban();
  }

  async function loadPhase(id, level) {
    state.currentPhase = null;
    renderDetail();
    try {
      const url = level
        ? `/api/phase/${encodeURIComponent(id)}?level=${encodeURIComponent(level)}`
        : `/api/phase/${encodeURIComponent(id)}`;
      state.currentPhase = await api(url);
    } catch (e) {
      state.currentPhase = { id, error: e.message };
    }
    renderDetail();
  }

  async function loadBootstrapStatus() {
    try {
      const s = await api("/api/bootstrap-status");
      handleBootstrapStatus(s);
    } catch (e) {
      // backend may not implement; ignore
    }
  }

  // ----------------------------------------------------------
  // Top bar
  // ----------------------------------------------------------
  function renderTopbar() {
    const name = state.project?.name || "RIFF";
    $("#project-name").textContent = name;
    const root = state.project?.root || "";
    const rootEl = $("#project-root");
    if (root) {
      rootEl.textContent = root;
      rootEl.title = root;
    } else {
      rootEl.textContent = "";
    }
  }

  // ----------------------------------------------------------
  // Kanban
  // ----------------------------------------------------------
  function groupPhases(phases) {
    const groups = {};
    for (const status of COLUMN_ORDER) groups[status] = [];
    for (const p of phases) {
      const s = COLUMN_ORDER.includes(p.status) ? p.status : "todo";
      groups[s].push(p);
    }
    return groups;
  }

  function priorityClass(p) {
    if (!p) return "p2";
    return String(p).toLowerCase();
  }

  const PRIORITY_MAP = {
    P0: { label: "Critical", title: "Critique, à faire maintenant" },
    P1: { label: "High", title: "Priorité haute" },
    P2: { label: "Medium", title: "Priorité normale" },
    P3: { label: "Low", title: "Priorité basse" },
  };
  const STATUS_MAP = {
    todo: { label: "todo", title: "Pas encore commencé" },
    "in-progress": { label: "in-progress", title: "En cours de travail" },
    done: { label: "done", title: "Terminé" },
    blocked: { label: "blocked", title: "Bloqué, en attente de quelque chose" },
    skipped: { label: "skipped", title: "Pas fait, ignoré" },
  };

  function badge(text, classes, title) {
    return el(
      "span",
      title ? { class: `badge ${classes}`, title } : { class: `badge ${classes}` },
      text
    );
  }

  function buildCard(phase) {
    const prioInfo = phase.priority ? PRIORITY_MAP[phase.priority] : null;
    const top = el("div", { class: "card-top" }, [
      el("span", { class: "card-id mono" }, phase.id || ""),
      prioInfo
        ? badge(prioInfo.label, `badge-priority ${priorityClass(phase.priority)}`, prioInfo.title)
        : null,
    ]);

    const title = el("div", { class: "card-title" }, phase.title || phase.slug || "Untitled");

    const previewText = phase.explain_preview || phase.description || "";
    const hasContent = !!previewText;
    const explain = el(
      "div",
      { class: "card-explain" + (hasContent ? "" : " placeholder") },
      hasContent ? previewText : "Pending explanation"
    );

    const card = el(
      "div",
      {
        class: "card",
        role: "button",
        tabindex: "0",
        "data-id": phase.id,
        onClick: () => navigateToPhase(phase.id),
        onKeydown: (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            navigateToPhase(phase.id);
          }
        },
      },
      [top, title, explain]
    );
    return card;
  }

  function buildColumn(status, phases) {
    const collapsed = status === "skipped" && !state.skippedExpanded && phases.length > 0;

    const header = el(
      "div",
      {
        class: "column-header",
        onClick: () => {
          if (status === "skipped") {
            state.skippedExpanded = !state.skippedExpanded;
            renderKanban();
          }
        },
      },
      [
        el("span", { class: "column-title" }, [
          el("span", { class: `column-dot ${status}` }),
          COLUMN_LABELS[status] || status,
        ]),
        el("span", { class: "column-count mono" }, String(phases.length)),
      ]
    );

    const cards = el("div", { class: "column-cards" });
    if (phases.length === 0) {
      cards.appendChild(el("div", { class: "column-empty" }, "No phases"));
    } else if (status === "skipped" && !state.skippedExpanded) {
      cards.appendChild(
        el("div", { class: "column-empty" }, `${phases.length} skipped — click header to expand`)
      );
    } else {
      for (const p of phases) cards.appendChild(buildCard(p));
    }

    return el("div", { class: "column" + (collapsed ? " collapsed" : "") }, [header, cards]);
  }

  function renderKanban() {
    const root = $("#kanban");
    clear(root);
    const groups = groupPhases(state.phases);
    for (const status of COLUMN_ORDER) {
      root.appendChild(buildColumn(status, groups[status]));
    }
  }

  // ----------------------------------------------------------
  // Detail view
  // ----------------------------------------------------------
  function renderDetailHeader() {
    const phase = state.currentPhase;
    if (!phase) return;
    $("#detail-title").textContent = phase.title || phase.slug || phase.id || "Phase";

    const badges = $("#detail-badges");
    clear(badges);
    badges.appendChild(el("span", { class: "card-id mono" }, phase.id || ""));
    if (phase.status) {
      const s = STATUS_MAP[phase.status] || { label: phase.status, title: "" };
      badges.appendChild(badge(s.label, `badge-status ${phase.status}`, s.title));
    }
    if (phase.priority) {
      const p = PRIORITY_MAP[phase.priority] || { label: phase.priority, title: "" };
      badges.appendChild(badge(p.label, `badge-priority ${priorityClass(phase.priority)}`, p.title));
    }
  }

  function buildTabs(phase) {
    const tabs = ["explanation", "raw"];

    if (!tabs.includes(state.activeTab)) state.activeTab = "explanation";

    const labels = {
      explanation: "Explanation",
      raw: "Raw files",
    };

    const nav = $("#detail-tabs");
    clear(nav);
    for (const t of tabs) {
      nav.appendChild(
        el(
          "button",
          {
            class: "tab" + (state.activeTab === t ? " active" : ""),
            type: "button",
            onClick: () => {
              state.activeTab = t;
              renderDetailBody();
              renderDetailTabs();
              renderDetailActions();
            },
          },
          labels[t]
        )
      );
    }
  }

  function renderDetailTabs() {
    if (!state.currentPhase) return;
    buildTabs(state.currentPhase);
  }

  function renderDetailActions() {
    const wrap = $("#detail-actions");
    clear(wrap);
    const phase = state.currentPhase;
    if (!phase) return;
    if (state.activeTab !== "explanation") return;

    const isDone = phase.status === "done";
    const kind = isDone ? "post" : "pre";

    const currentLevel = phase.current_level || phase.level || "simple";
    const allLevels = ["simple", "technical", "eli5"];
    const labelMap = { simple: "Simple", technical: "Technical", eli5: "ELI5" };

    for (const level of allLevels) {
      const isActive = level === currentLevel;
      const btn = el(
        "button",
        {
          class: "btn level-btn" + (isActive ? " btn-active" : ""),
          type: "button",
          disabled: isActive,
          title: isActive ? "Niveau actif" : `Voir au niveau ${labelMap[level]}`,
          onClick: isActive
            ? undefined
            : async () => {
                state.viewLevel = level;
                await loadPhase(phase.id, level);
                const p = state.currentPhase;
                const hasContent = (p?.explain && p.explain.trim()) || (p?.explain_post && p.explain_post.trim());
                if (!hasContent) {
                  triggerGeneration(phase.id, level, kind);
                }
              },
        },
        labelMap[level]
      );
      wrap.appendChild(btn);
    }
  }

  function chooseExplainBody(phase) {
    const isDone = phase.status === "done";
    if (isDone && (phase.explain_post || phase.has_explain_post)) {
      return phase.explain_post || phase.description || "";
    }
    return phase.explain || phase.description || "";
  }

  function renderExplanationBody() {
    const phase = state.currentPhase;
    const body = $("#detail-body");
    clear(body);
    if (!phase) {
      body.appendChild(el("div", { class: "empty-state" }, "Loading…"));
      return;
    }
    if (phase.error) {
      body.appendChild(el("div", { class: "empty-state" }, `Error: ${phase.error}`));
      return;
    }

    const raw = chooseExplainBody(phase);
    if (state.generating) {
      body.appendChild(el("div", { class: "empty-state" }, "Génération en cours…"));
      return;
    }
    if (!raw || !raw.trim()) {
      body.appendChild(
        el("div", { class: "empty-state" }, "No explanation yet. Use a button above to generate one.")
      );
      return;
    }
    const md = el("div", { class: "md" });
    md.innerHTML = renderMarkdown(raw);
    body.appendChild(md);
  }

  function renderMetadataBody() {
    const phase = state.currentPhase;
    const body = $("#detail-body");
    clear(body);
    const src = phase?.explain_post || phase?.metadata_raw || "";
    let pairs = extractMetadata(src);
    if (!pairs && phase?.metadata && typeof phase.metadata === "object") {
      pairs = Object.entries(phase.metadata).map(([k, v]) => [k, String(v)]);
    }
    if (!pairs || !pairs.length) {
      body.appendChild(el("div", { class: "empty-state" }, "No metadata available."));
      return;
    }
    const table = el("table", { class: "kv-table" });
    const tbody = el("tbody");
    for (const [k, v] of pairs) {
      tbody.appendChild(el("tr", null, [el("th", null, k), el("td", null, v)]));
    }
    table.appendChild(tbody);
    body.appendChild(table);
  }

  function renderRawBody() {
    const phase = state.currentPhase;
    const body = $("#detail-body");
    clear(body);
    const files = Array.isArray(phase?.files) ? phase.files : phase?.raw_files || [];
    const list = Array.isArray(files) ? files : [];

    if (!list.length) {
      // Fallback: show whatever raw content we have
      const fallback = phase?.explain || phase?.explain_post || phase?.description || "";
      if (fallback) {
        const wrap = el("div", { class: "raw-files" }, [
          el("div", { class: "raw-file" }, [
            el("div", { class: "raw-file-header" }, [
              el("span", null, "content"),
              el("span", { class: "fg-subtle" }, ""),
            ]),
            el("pre", { class: "raw-file-body" }, fallback),
          ]),
        ]);
        body.appendChild(wrap);
        return;
      }
      body.appendChild(el("div", { class: "empty-state" }, "No raw files available."));
      return;
    }

    const wrap = el("div", { class: "raw-files" });
    for (const f of list) {
      const path = f.path || f.name || "file";
      const content = f.content || f.body || "";
      const size = typeof f.size === "number" ? `${f.size} B` : "";
      wrap.appendChild(
        el("div", { class: "raw-file" }, [
          el("div", { class: "raw-file-header" }, [
            el("span", { class: "mono" }, path),
            size ? el("span", { class: "fg-subtle mono" }, size) : null,
          ]),
          el("pre", { class: "raw-file-body" }, content),
        ])
      );
    }
    body.appendChild(wrap);
  }

  function renderDetailBody() {
    if (!state.currentPhase) {
      const body = $("#detail-body");
      clear(body);
      body.appendChild(el("div", { class: "empty-state" }, "Loading…"));
      return;
    }
    if (state.activeTab === "metadata") return renderMetadataBody();
    if (state.activeTab === "raw") return renderRawBody();
    return renderExplanationBody();
  }

  function renderDetail() {
    if (!state.currentPhase) {
      $("#detail-title").textContent = "Loading…";
      clear($("#detail-badges"));
      clear($("#detail-tabs"));
      clear($("#detail-actions"));
      const body = $("#detail-body");
      clear(body);
      body.appendChild(el("div", { class: "empty-state" }, "Loading phase…"));
      return;
    }
    renderDetailHeader();
    renderDetailTabs();
    renderDetailActions();
    renderDetailBody();
  }

  // ----------------------------------------------------------
  // Routing
  // ----------------------------------------------------------
  function showKanban() {
    state.currentPhaseId = null;
    state.currentPhase = null;
    state.viewLevel = null;
    state.activeTab = "explanation";
    $("#detail-view").classList.add("hidden");
    document.body.style.overflow = "";
  }

  function showDetail() {
    $("#detail-view").classList.remove("hidden");
    document.body.style.overflow = "hidden";
  }

  function navigateToPhase(id) {
    if (!id) return;
    history.pushState({ phaseId: id }, "", `/phase/${encodeURIComponent(id)}`);
    state.currentPhaseId = id;
    showDetail();
    renderDetail();
    loadPhase(id);
  }

  function navigateHome() {
    history.pushState({}, "", "/");
    showKanban();
  }

  function handleRoute() {
    const m = location.pathname.match(/^\/phase\/([^/]+)/);
    if (m) {
      state.currentPhaseId = decodeURIComponent(m[1]);
      showDetail();
      renderDetail();
      loadPhase(state.currentPhaseId);
    } else {
      showKanban();
    }
  }

  window.addEventListener("popstate", handleRoute);

  // ----------------------------------------------------------
  // SSE: live events
  // ----------------------------------------------------------
  function subscribeEvents() {
    if (state.eventSource) return;
    if (typeof EventSource === "undefined") return;

    let es;
    try {
      es = new EventSource("/api/events");
    } catch (e) {
      return;
    }
    state.eventSource = es;

    const refetchPhases = () => {
      loadPhases();
      if (state.currentPhaseId) loadPhase(state.currentPhaseId, state.viewLevel);
    };

    es.addEventListener("phase_changed", refetchPhases);
    es.addEventListener("roadmap_changed", refetchPhases);
    es.addEventListener("state_changed", refetchPhases);
    es.addEventListener("bootstrap_status", (ev) => {
      try {
        const data = JSON.parse(ev.data);
        handleBootstrapStatus(data);
      } catch (e) {
        // ignore
      }
    });

    // Generic message fallback
    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        if (data && data.type) {
          if (
            data.type === "phase_changed" ||
            data.type === "roadmap_changed" ||
            data.type === "state_changed"
          ) {
            refetchPhases();
          } else if (data.type === "bootstrap_status") {
            handleBootstrapStatus(data);
          }
        }
      } catch (e) {
        // ignore non-JSON
      }
    };

    es.onerror = () => {
      // EventSource auto-reconnects; nothing to do
    };
  }

  // ----------------------------------------------------------
  // Bootstrap progress
  // ----------------------------------------------------------
  function handleBootstrapStatus(s) {
    if (!s) return;
    const banner = $("#bootstrap-banner");
    const modal = $("#bootstrap-modal");
    const running = !!s.running;

    if (running) {
      const total = s.total || 0;
      const done = s.done || 0;
      const failed = s.failed || 0;
      const current = s.current || "";

      $("#bootstrap-banner-text").textContent = `Bootstrap: ${done}/${total}${
        current ? ` — ${current}` : ""
      }`;
      if (!state.bootstrapDismissed) banner.classList.remove("hidden");

      $("#bootstrap-current").textContent = current || "Preparing…";
      $("#bootstrap-counts").textContent = `${done} done · ${failed} failed · ${total} total`;
      const pct = total ? Math.min(100, Math.round((done / total) * 100)) : 0;
      $("#bootstrap-bar").style.width = pct + "%";
      if (!state.bootstrapDismissed) modal.classList.remove("hidden");
    } else {
      banner.classList.add("hidden");
      modal.classList.add("hidden");
      state.bootstrapDismissed = false;
    }
  }

  // ----------------------------------------------------------
  // Generation modal (SSE streaming)
  // ----------------------------------------------------------
  function openGenModal(/* level, kind */) {
    // Modal removed — generation happens silently with an inline loading state.
    state.generating = true;
    renderDetail();
  }

  function closeGenModal() {
    state.generating = false;
    if (state.genSource) {
      try {
        state.genSource.close();
      } catch (e) {
        // ignore
      }
      state.genSource = null;
    }
  }

  function appendGenChunk(text) {
    const pre = $("#gen-stream");
    pre.textContent += text;
    pre.scrollTop = pre.scrollHeight;
  }

  function triggerGeneration(phaseId, level, kind) {
    if (!phaseId || !level) return;
    if (state.genSource) {
      try {
        state.genSource.close();
      } catch (e) {
        // ignore
      }
      state.genSource = null;
    }

    openGenModal(level, kind);

    const url = `/api/phase/${encodeURIComponent(phaseId)}/generate?level=${encodeURIComponent(
      level
    )}&kind=${encodeURIComponent(kind)}`;

    let es;
    try {
      es = new EventSource(url);
    } catch (e) {
      $("#gen-status").innerHTML = `<span class="fg-muted small">Failed to start: ${escapeHtml(
        e.message
      )}</span>`;
      return;
    }
    state.genSource = es;

    const handleDone = () => {
      $("#gen-status").innerHTML = `<span class="fg-muted small">Done.</span>`;
      try {
        es.close();
      } catch (e) {
        // ignore
      }
      state.genSource = null;
      // Switch the active view to the freshly generated level so subsequent renders
      // (and any concurrent phase_changed broadcasts) all resolve to it.
      state.viewLevel = level;
      setTimeout(() => closeGenModal(), 600);
      if (state.currentPhaseId) loadPhase(state.currentPhaseId, level);
      loadPhases();
    };

    es.addEventListener("chunk", (ev) => {
      try {
        const data = JSON.parse(ev.data);
        if (data && typeof data.text === "string") appendGenChunk(data.text);
      } catch (e) {
        appendGenChunk(ev.data || "");
      }
    });

    es.addEventListener("done", handleDone);

    es.onmessage = (ev) => {
      // Generic JSON fallback
      try {
        const data = JSON.parse(ev.data);
        if (data?.type === "chunk" && typeof data.text === "string") {
          appendGenChunk(data.text);
        } else if (data?.type === "done") {
          handleDone();
        } else if (typeof data === "string") {
          appendGenChunk(data);
        }
      } catch (e) {
        if (typeof ev.data === "string") appendGenChunk(ev.data);
      }
    };

    es.onerror = () => {
      $("#gen-status").innerHTML = `<span class="fg-muted small">Stream error or closed.</span>`;
    };
  }

  // ----------------------------------------------------------
  // Wire up
  // ----------------------------------------------------------
  function wireEvents() {
    $("#back-btn").addEventListener("click", navigateHome);

    // Backdrop click closes the detail modal
    $("#detail-view").addEventListener("click", (e) => {
      if (e.target === e.currentTarget) {
        navigateHome();
      }
    });

    $("#bootstrap-banner-dismiss").addEventListener("click", () => {
      state.bootstrapDismissed = true;
      $("#bootstrap-banner").classList.add("hidden");
      $("#bootstrap-modal").classList.add("hidden");
    });

    $("#bootstrap-modal-dismiss").addEventListener("click", () => {
      state.bootstrapDismissed = true;
      $("#bootstrap-modal").classList.add("hidden");
    });

    $("#gen-dismiss").addEventListener("click", closeGenModal);

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (!$("#gen-modal").classList.contains("hidden")) {
          closeGenModal();
        } else if (
          !$("#bootstrap-modal").classList.contains("hidden") &&
          !state.bootstrapDismissed
        ) {
          state.bootstrapDismissed = true;
          $("#bootstrap-modal").classList.add("hidden");
        } else if (state.currentPhaseId) {
          navigateHome();
        }
      }
    });

    // Project-name click → home
    $(".topbar-left").addEventListener("click", (e) => {
      // Only if user clicked the name area, not selected text
      const tgt = e.target;
      if (tgt && (tgt.id === "project-name" || tgt.classList.contains("logo-dot"))) {
        navigateHome();
      }
    });
  }

  // ----------------------------------------------------------
  // Init
  // ----------------------------------------------------------
  async function init() {
    initTheme();
    wireEvents();

    // Initial parallel fetch
    await Promise.all([loadProject(), loadPhases(), loadBootstrapStatus()]);

    handleRoute();
    subscribeEvents();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
