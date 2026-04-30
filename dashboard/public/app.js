/* ============================================================
   RIFF Dashboard — vanilla SPA (multi-project, two-level)
   ============================================================
   Layout:
     overview (#/)             → grid of project cards
     project  (#/projects/:slug)            → kanban
     phase    (#/projects/:slug/phase/:id)  → kanban + modal open
   ============================================================ */
(() => {
  "use strict";

  // ----------------------------------------------------------
  // State
  // ----------------------------------------------------------
  const state = {
    view: "overview",            // "overview" | "project"
    currentProjectSlug: null,
    currentPhaseId: null,
    currentPhase: null,
    viewLevel: null,             // null → use profile default; else override
    activeTab: "explanation",
    skippedExpanded: false,

    projects: [],                // overview list
    project: null,               // current project full payload
    profile: null,
    frameworkRoot: null,

    bootstrapStatus: null,
    bootstrapDismissed: false,

    eventSource: null,
    genSource: null,
    generating: false,

    switcherOpen: false,
    confirmCallback: null,
  };

  const COLUMN_ORDER = ["todo", "in-progress", "done", "blocked", "skipped"];
  const COLUMN_LABELS = {
    todo: "Todo",
    "in-progress": "In progress",
    done: "Done",
    blocked: "Blocked",
    skipped: "Skipped",
  };

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

  const LS_LAST_PROJECT = "riff:lastProjectSlug";

  // ----------------------------------------------------------
  // DOM helpers
  // ----------------------------------------------------------
  const $ = (sel) => document.querySelector(sel);

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
    while (node && node.firstChild) node.removeChild(node.firstChild);
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function timeAgo(ms) {
    if (!ms) return "";
    const diff = Date.now() - ms;
    if (diff < 0) return "just now";
    if (diff < 60_000) return "just now";
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return `${Math.floor(diff / 86_400_000)}d ago`;
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
  // Markdown renderer (paragraphs, headings, bold, italic,
  // code spans, fenced code blocks, lists). Single newline → <br>
  // is intentional: casual French prompts depend on visual breaks.
  // ----------------------------------------------------------
  function renderMarkdown(src) {
    if (!src) return "";
    const lines = String(src).replace(/\r\n/g, "\n").split("\n");
    const out = [];
    let i = 0;

    const inlineFmt = (s) => {
      let t = escapeHtml(s);
      t = t.replace(/`([^`]+)`/g, "<code>$1</code>");
      t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
      t = t.replace(/\*([^*]+)\*/g, "<em>$1</em>");
      t = t.replace(/(^|[\s(])_([^_]+)_(?=[\s).,!?]|$)/g, "$1<em>$2</em>");
      t = t.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
      return t;
    };

    while (i < lines.length) {
      const line = lines[i];
      if (/^```/.test(line)) {
        const buf = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i])) {
          buf.push(lines[i]);
          i++;
        }
        i++;
        out.push("<pre><code>" + escapeHtml(buf.join("\n")) + "</code></pre>");
        continue;
      }
      const h = line.match(/^(#{1,6})\s+(.*)$/);
      if (h) {
        const level = Math.min(h[1].length, 6);
        out.push(`<h${level}>${inlineFmt(h[2])}</h${level}>`);
        i++;
        continue;
      }
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
      if (/^\s*$/.test(line)) {
        i++;
        continue;
      }
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
      out.push("<p>" + buf.map((l) => inlineFmt(l)).join("<br>") + "</p>");
    }
    return out.join("\n");
  }

  // ----------------------------------------------------------
  // API
  // ----------------------------------------------------------
  async function api(path, opts) {
    const res = await fetch(path, opts);
    let body = null;
    try {
      body = await res.json();
    } catch (e) {
      body = null;
    }
    if (!res.ok) {
      const msg = body && body.error ? body.error : `${path}: ${res.status}`;
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    return body;
  }

  async function loadOverview() {
    try {
      const data = await api("/api/projects");
      state.projects = Array.isArray(data?.projects) ? data.projects : [];
      state.profile = data?.profile ?? null;
      state.frameworkRoot = data?.framework_root ?? null;
    } catch (e) {
      state.projects = [];
    }
    if (state.view === "overview") renderOverview();
    renderSwitcherMenu();
  }

  async function loadProject(slug) {
    state.project = null;
    state.bootstrapStatus = null;
    state.bootstrapDismissed = false;
    if (state.view === "project") renderProject();
    try {
      const data = await api(`/api/projects/${encodeURIComponent(slug)}`);
      state.project = data;
      state.bootstrapStatus = data?.bootstrap_status ?? null;
      handleBootstrapStatus(state.bootstrapStatus);
    } catch (e) {
      state.project = { error: e.message, slug };
    }
    if (state.view === "project") renderProject();
  }

  async function loadPhase(slug, id, level) {
    state.currentPhase = null;
    renderDetail();
    try {
      const url = level
        ? `/api/projects/${encodeURIComponent(slug)}/phase/${encodeURIComponent(id)}?level=${encodeURIComponent(level)}`
        : `/api/projects/${encodeURIComponent(slug)}/phase/${encodeURIComponent(id)}`;
      state.currentPhase = await api(url);
    } catch (e) {
      state.currentPhase = { id, error: e.message };
    }
    renderDetail();
  }

  async function addProjectByPath(path) {
    return api("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
  }

  async function removeProjectBySlug(slug) {
    return api(`/api/projects/${encodeURIComponent(slug)}`, { method: "DELETE" });
  }

  // ----------------------------------------------------------
  // Topbar (project switcher)
  // ----------------------------------------------------------
  function renderTopbar() {
    const bar = $("#project-bar");
    if (state.view === "project") {
      bar.classList.remove("hidden");
      const proj = currentProjectMeta();
      $("#switcher-label").textContent = proj?.name ?? state.currentProjectSlug ?? "project";
    } else {
      bar.classList.add("hidden");
      closeSwitcher();
    }
  }

  function currentProjectMeta() {
    if (!state.currentProjectSlug) return null;
    return state.projects.find((p) => p.slug === state.currentProjectSlug) ?? null;
  }

  function renderSwitcherMenu() {
    const menu = $("#switcher-menu");
    clear(menu);
    if (!state.projects.length) {
      menu.appendChild(el("div", { class: "switcher-empty fg-muted small" }, "No projects"));
      return;
    }
    for (const p of state.projects) {
      const isCurrent = p.slug === state.currentProjectSlug;
      const dead = !p.exists;
      const item = el(
        "button",
        {
          class: "switcher-item" + (isCurrent ? " current" : "") + (dead ? " dead" : ""),
          type: "button",
          role: "menuitem",
          onClick: () => {
            closeSwitcher();
            if (dead) return;
            navigateToProject(p.slug);
          },
        },
        [
          el("span", { class: "switcher-item-name" }, p.name || p.slug),
          dead ? el("span", { class: "switcher-item-tag fg-subtle small" }, "missing") : null,
        ],
      );
      menu.appendChild(item);
    }
    menu.appendChild(
      el(
        "button",
        {
          class: "switcher-item all-projects",
          type: "button",
          role: "menuitem",
          onClick: () => {
            closeSwitcher();
            navigateToOverview();
          },
        },
        [
          el("span", { class: "switcher-item-icon" }, [
            el("svg", { width: "12", height: "12", html: '<use href="#icon-arrow-left" />' }),
          ]),
          el("span", null, "All projects"),
        ],
      ),
    );
  }

  function openSwitcher() {
    if (state.switcherOpen) return;
    state.switcherOpen = true;
    renderSwitcherMenu();
    $("#switcher-menu").classList.remove("hidden");
    $("#switcher-trigger").setAttribute("aria-expanded", "true");
  }

  function closeSwitcher() {
    if (!state.switcherOpen) return;
    state.switcherOpen = false;
    $("#switcher-menu").classList.add("hidden");
    $("#switcher-trigger").setAttribute("aria-expanded", "false");
  }

  function toggleSwitcher() {
    state.switcherOpen ? closeSwitcher() : openSwitcher();
  }

  // ----------------------------------------------------------
  // Overview
  // ----------------------------------------------------------
  function renderOverview() {
    const sub = $("#overview-subtitle");
    sub.textContent = state.frameworkRoot ? `framework: ${state.frameworkRoot}` : "";

    const grid = $("#overview-grid");
    clear(grid);
    if (!state.projects.length) {
      grid.appendChild(
        el(
          "div",
          { class: "overview-empty" },
          "No projects yet. Click “+ Add project” below to register one.",
        ),
      );
      return;
    }
    for (const p of state.projects) grid.appendChild(buildProjectCard(p));
  }

  function buildProjectCard(p) {
    const dead = !p.exists;

    const total = p.progress?.total ?? 0;
    const done = p.progress?.done ?? 0;
    const inProg = p.progress?.in_progress ?? 0;
    const todo = p.progress?.todo ?? 0;
    const blocked = p.progress?.blocked ?? 0;

    const pct = total ? Math.round((done / total) * 100) : 0;

    const header = el("div", { class: "proj-header" }, [
      el("span", { class: "proj-name" }, p.name || p.slug),
      el(
        "button",
        {
          class: "proj-remove icon-btn-sm",
          type: "button",
          title: "Remove from registry",
          "aria-label": "Remove project",
          onClick: (e) => {
            e.stopPropagation();
            askConfirm(
              `Remove ${p.name || p.slug} from the dashboard registry? The project files on disk are not touched.`,
              () => doRemoveProject(p.slug),
            );
          },
        },
        [el("svg", { width: "12", height: "12", html: '<use href="#icon-x" />' })],
      ),
    ]);

    const path = el("div", { class: "proj-path mono fg-subtle", title: p.root }, p.root || "");

    let body;
    if (dead) {
      body = el("div", { class: "proj-dead" }, [
        el("span", { class: "badge badge-dead" }, "Path missing"),
      ]);
    } else {
      const active = p.active_phase
        ? el("div", { class: "proj-active" }, [
            el("span", { class: "card-id mono" }, String(p.active_phase.id)),
            el("span", { class: "proj-active-title" }, p.active_phase.title || p.active_phase.slug || ""),
          ])
        : el("div", { class: "proj-active fg-muted" }, "Complete");

      const counts = [];
      if (done) counts.push({ k: "done", v: done });
      if (inProg) counts.push({ k: "in-progress", v: inProg });
      if (todo) counts.push({ k: "todo", v: todo });
      if (blocked) counts.push({ k: "blocked", v: blocked });

      const countsRow = el(
        "div",
        { class: "proj-counts" },
        counts.map((c) =>
          el("span", { class: "proj-count" }, [
            el("span", { class: `column-dot ${c.k}` }),
            el("span", { class: "fg-muted" }, String(c.v)),
          ]),
        ),
      );

      const bar = el("div", { class: "proj-bar" }, [
        el("div", { class: "proj-bar-fill", style: `width:${pct}%` }),
      ]);
      const barRow = el("div", { class: "proj-bar-row" }, [
        bar,
        el("span", { class: "proj-bar-label mono fg-muted small" }, `${done}/${total}`),
      ]);

      body = el("div", { class: "proj-body" }, [active, barRow, countsRow]);
    }

    const footer = el("div", { class: "proj-footer fg-subtle small" }, [
      p.last_modified_ms ? el("span", null, `modified ${timeAgo(p.last_modified_ms)}`) : el("span", null, ""),
    ]);

    const card = el(
      "div",
      {
        class: "proj-card" + (dead ? " dead" : ""),
        role: dead ? null : "button",
        tabindex: dead ? null : "0",
        "data-slug": p.slug,
        onClick: dead ? undefined : () => navigateToProject(p.slug),
        onKeydown: dead
          ? undefined
          : (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                navigateToProject(p.slug);
              }
            },
      },
      [header, path, body, footer],
    );
    return card;
  }

  // ----------------------------------------------------------
  // Project (kanban)
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

  function badge(text, classes, title) {
    return el(
      "span",
      title ? { class: `badge ${classes}`, title } : { class: `badge ${classes}` },
      text,
    );
  }

  function buildPhaseCard(phase) {
    const prioInfo = phase.priority ? PRIORITY_MAP[phase.priority] : null;
    const top = el("div", { class: "card-top" }, [
      el("span", { class: "card-id mono" }, String(phase.id ?? "")),
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
      hasContent ? previewText : "Pending explanation",
    );

    return el(
      "div",
      {
        class: "card",
        role: "button",
        tabindex: "0",
        "data-id": String(phase.id),
        onClick: () => navigateToPhase(phase.id),
        onKeydown: (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            navigateToPhase(phase.id);
          }
        },
      },
      [top, title, explain],
    );
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
            renderProject();
          }
        },
      },
      [
        el("span", { class: "column-title" }, [
          el("span", { class: `column-dot ${status}` }),
          COLUMN_LABELS[status] || status,
        ]),
        el("span", { class: "column-count mono" }, String(phases.length)),
      ],
    );

    const cards = el("div", { class: "column-cards" });
    if (phases.length === 0) {
      cards.appendChild(el("div", { class: "column-empty" }, "No phases"));
    } else if (status === "skipped" && !state.skippedExpanded) {
      cards.appendChild(
        el("div", { class: "column-empty" }, `${phases.length} skipped — click header to expand`),
      );
    } else {
      for (const p of phases) cards.appendChild(buildPhaseCard(p));
    }

    return el("div", { class: "column" + (collapsed ? " collapsed" : "") }, [header, cards]);
  }

  function renderProject() {
    const root = $("#kanban");
    clear(root);
    if (!state.project) {
      root.appendChild(el("div", { class: "empty-state" }, "Loading project…"));
      return;
    }
    if (state.project.error) {
      root.appendChild(
        el("div", { class: "empty-state" }, `Error: ${state.project.error}`),
      );
      return;
    }
    const phases = Array.isArray(state.project.phases) ? state.project.phases : [];
    const groups = groupPhases(phases);
    for (const status of COLUMN_ORDER) {
      root.appendChild(buildColumn(status, groups[status]));
    }
  }

  // ----------------------------------------------------------
  // Detail (phase modal)
  // ----------------------------------------------------------
  function renderDetailHeader() {
    const phase = state.currentPhase;
    if (!phase) return;
    $("#detail-title").textContent = phase.title || phase.slug || phase.id || "Phase";

    const badges = $("#detail-badges");
    clear(badges);
    badges.appendChild(el("span", { class: "card-id mono" }, String(phase.id ?? "")));
    if (phase.status) {
      const s = STATUS_MAP[phase.status] || { label: phase.status, title: "" };
      badges.appendChild(badge(s.label, `badge-status ${phase.status}`, s.title));
    }
    if (phase.priority) {
      const p = PRIORITY_MAP[phase.priority] || { label: phase.priority, title: "" };
      badges.appendChild(badge(p.label, `badge-priority ${priorityClass(phase.priority)}`, p.title));
    }
  }

  function buildTabs() {
    const tabs = ["explanation", "raw"];
    if (!tabs.includes(state.activeTab)) state.activeTab = "explanation";
    const labels = { explanation: "Explanation", raw: "Raw files" };

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
          labels[t],
        ),
      );
    }
  }

  function renderDetailTabs() {
    if (!state.currentPhase) return;
    buildTabs();
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
                await loadPhase(state.currentProjectSlug, phase.id, level);
                const p = state.currentPhase;
                const hasContent =
                  (p?.explain && p.explain.trim()) || (p?.explain_post && p.explain_post.trim());
                if (!hasContent) {
                  triggerGeneration(state.currentProjectSlug, phase.id, level, kind);
                }
              },
        },
        labelMap[level],
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
    if (state.generating) {
      body.appendChild(el("div", { class: "empty-state" }, "Génération en cours…"));
      return;
    }
    const raw = chooseExplainBody(phase);
    if (!raw || !raw.trim()) {
      body.appendChild(
        el("div", { class: "empty-state" }, "No explanation yet. Use a button above to generate one."),
      );
      return;
    }
    const md = el("div", { class: "md" });
    md.innerHTML = renderMarkdown(raw);
    body.appendChild(md);
  }

  function renderRawBody() {
    const phase = state.currentPhase;
    const body = $("#detail-body");
    clear(body);
    const files = Array.isArray(phase?.files) ? phase.files : phase?.raw_files || [];
    const list = Array.isArray(files) ? files : [];

    if (!list.length) {
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
        ]),
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
  // Routing (hash-based)
  // ----------------------------------------------------------
  function parseHash() {
    const raw = (location.hash || "").replace(/^#\/?/, "");
    if (!raw) return { view: "overview" };
    const m = raw.match(/^projects\/([^/]+)(?:\/phase\/([^/]+))?$/);
    if (!m) return { view: "overview" };
    return {
      view: "project",
      slug: decodeURIComponent(m[1]),
      phaseId: m[2] ? Number(decodeURIComponent(m[2])) : null,
    };
  }

  function setHash(hash) {
    if (location.hash === hash) {
      handleRoute();
      return;
    }
    location.hash = hash;
  }

  function navigateToOverview() {
    try {
      localStorage.removeItem(LS_LAST_PROJECT);
    } catch (e) {
      // ignore
    }
    setHash("");
  }

  function navigateToProject(slug) {
    try {
      localStorage.setItem(LS_LAST_PROJECT, slug);
    } catch (e) {
      // ignore
    }
    setHash(`#/projects/${encodeURIComponent(slug)}`);
  }

  function navigateToPhase(id) {
    if (!state.currentProjectSlug || id == null) return;
    setHash(
      `#/projects/${encodeURIComponent(state.currentProjectSlug)}/phase/${encodeURIComponent(id)}`,
    );
  }

  function closeDetail() {
    if (!state.currentProjectSlug) {
      navigateToOverview();
      return;
    }
    setHash(`#/projects/${encodeURIComponent(state.currentProjectSlug)}`);
  }

  async function handleRoute() {
    const route = parseHash();

    if (route.view === "overview") {
      state.view = "overview";
      state.currentProjectSlug = null;
      state.currentPhaseId = null;
      state.currentPhase = null;
      state.bootstrapDismissed = false;
      hideBootstrapBanner();
      $("#overview-view").classList.remove("hidden");
      $("#kanban-view").classList.add("hidden");
      $("#detail-view").classList.add("hidden");
      document.body.style.overflow = "";
      renderTopbar();
      await loadOverview();
      return;
    }

    // Project view (with optional phase modal).
    const projectChanged = route.slug !== state.currentProjectSlug;
    state.view = "project";
    $("#overview-view").classList.add("hidden");
    $("#kanban-view").classList.remove("hidden");

    if (projectChanged) {
      state.currentProjectSlug = route.slug;
      state.currentPhaseId = null;
      state.currentPhase = null;
      state.viewLevel = null;
      state.activeTab = "explanation";
      state.skippedExpanded = false;
      state.bootstrapDismissed = false;
      hideBootstrapBanner();
    }

    renderTopbar();

    if (projectChanged) {
      await loadProject(route.slug);
    }

    if (route.phaseId != null && Number.isFinite(route.phaseId)) {
      state.currentPhaseId = route.phaseId;
      $("#detail-view").classList.remove("hidden");
      document.body.style.overflow = "hidden";
      renderDetail();
      loadPhase(state.currentProjectSlug, route.phaseId);
    } else {
      state.currentPhaseId = null;
      state.currentPhase = null;
      state.viewLevel = null;
      state.activeTab = "explanation";
      $("#detail-view").classList.add("hidden");
      document.body.style.overflow = "";
    }
  }

  window.addEventListener("hashchange", handleRoute);

  // ----------------------------------------------------------
  // SSE: live events (single global stream, filtered by project)
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

    const handlePhaseChanged = (ev) => {
      let data = null;
      try {
        data = JSON.parse(ev.data);
      } catch (e) {
        return;
      }
      const slug = data?.project;
      // Refresh overview card if visible
      if (state.view === "overview") {
        loadOverview();
        return;
      }
      // Project view: only act on events for the current project
      if (slug && slug === state.currentProjectSlug) {
        loadProject(slug);
        if (state.currentPhaseId != null) {
          loadPhase(slug, state.currentPhaseId, state.viewLevel);
        }
      }
    };

    const handleRoadmapChanged = (ev) => {
      let data = null;
      try {
        data = JSON.parse(ev.data);
      } catch (e) {
        // ignore
      }
      const slug = data?.project;
      if (state.view === "overview") {
        loadOverview();
      } else if (slug && slug === state.currentProjectSlug) {
        loadProject(slug);
      }
    };

    const handleBootstrap = (ev) => {
      let data = null;
      try {
        data = JSON.parse(ev.data);
      } catch (e) {
        return;
      }
      const slug = data?.project;
      const status = data?.status ?? data;
      // Only update the banner for the active project
      if (state.view === "project" && slug === state.currentProjectSlug) {
        state.bootstrapStatus = status;
        handleBootstrapStatus(status);
      }
      // Overview: refresh card list to reflect new generated previews
      if (state.view === "overview") {
        loadOverview();
      }
    };

    es.addEventListener("phase_changed", handlePhaseChanged);
    es.addEventListener("roadmap_changed", handleRoadmapChanged);
    es.addEventListener("state_changed", handleRoadmapChanged);
    es.addEventListener("bootstrap_status", handleBootstrap);

    es.onerror = () => {
      // EventSource auto-reconnects
    };
  }

  // ----------------------------------------------------------
  // Bootstrap banner
  // ----------------------------------------------------------
  function handleBootstrapStatus(s) {
    if (!s) {
      hideBootstrapBanner();
      return;
    }
    const banner = $("#bootstrap-banner");
    if (!s.running) {
      banner.classList.add("hidden");
      state.bootstrapDismissed = false;
      return;
    }
    const total = s.total || 0;
    const done = s.done || 0;
    const current = s.current || "";
    $("#bootstrap-banner-text").textContent = `Bootstrap: ${done}/${total}${current ? ` — ${current}` : ""}`;
    if (!state.bootstrapDismissed) banner.classList.remove("hidden");
  }

  function hideBootstrapBanner() {
    $("#bootstrap-banner").classList.add("hidden");
  }

  // ----------------------------------------------------------
  // Generation streaming (silent: inline placeholder, no modal)
  // ----------------------------------------------------------
  function triggerGeneration(slug, phaseId, level, kind) {
    if (!slug || !phaseId || !level) return;
    if (state.genSource) {
      try {
        state.genSource.close();
      } catch (e) {
        // ignore
      }
      state.genSource = null;
    }

    state.generating = true;
    renderDetail();

    const url = `/api/projects/${encodeURIComponent(slug)}/phase/${encodeURIComponent(phaseId)}/generate?level=${encodeURIComponent(level)}&kind=${encodeURIComponent(kind)}`;

    let es;
    try {
      es = new EventSource(url);
    } catch (e) {
      state.generating = false;
      renderDetail();
      return;
    }
    state.genSource = es;

    const finish = () => {
      state.generating = false;
      try {
        es.close();
      } catch (e) {
        // ignore
      }
      state.genSource = null;
      // Keep the explicitly-requested level sticky against incoming broadcasts.
      state.viewLevel = level;
      if (state.currentPhaseId != null) loadPhase(slug, state.currentPhaseId, level);
    };

    es.addEventListener("done", finish);
    es.addEventListener("error", finish);
    // chunks ignored on purpose: the banner shows progress, generation stays inline-silent.
  }

  // ----------------------------------------------------------
  // Add / remove project flows
  // ----------------------------------------------------------
  function showAddForm() {
    $("#add-project-toggle").classList.add("hidden");
    $("#add-project-form").classList.remove("hidden");
    $("#add-project-error").classList.add("hidden");
    $("#add-project-input").value = "";
    setTimeout(() => $("#add-project-input").focus(), 30);
  }

  function hideAddForm() {
    $("#add-project-form").classList.add("hidden");
    $("#add-project-toggle").classList.remove("hidden");
    $("#add-project-error").classList.add("hidden");
    $("#add-project-input").value = "";
  }

  async function submitAddProject() {
    const input = $("#add-project-input");
    const errEl = $("#add-project-error");
    const path = input.value.trim();
    errEl.classList.add("hidden");
    if (!path) {
      errEl.textContent = "Enter an absolute path.";
      errEl.classList.remove("hidden");
      return;
    }
    try {
      await addProjectByPath(path);
      hideAddForm();
      await loadOverview();
    } catch (e) {
      errEl.textContent = e.message || "failed";
      errEl.classList.remove("hidden");
    }
  }

  async function doRemoveProject(slug) {
    try {
      await removeProjectBySlug(slug);
    } catch (e) {
      // surface at the next overview render via a transient hint
    }
    if (state.currentProjectSlug === slug) {
      navigateToOverview();
      return;
    }
    await loadOverview();
  }

  // ----------------------------------------------------------
  // Confirm modal
  // ----------------------------------------------------------
  function askConfirm(message, onOk) {
    state.confirmCallback = onOk || null;
    $("#confirm-message").textContent = message;
    $("#confirm-modal").classList.remove("hidden");
  }

  function closeConfirm() {
    $("#confirm-modal").classList.add("hidden");
    state.confirmCallback = null;
  }

  // ----------------------------------------------------------
  // Wire up
  // ----------------------------------------------------------
  function wireEvents() {
    $("#back-btn").addEventListener("click", closeDetail);

    // Backdrop click closes the detail modal
    $("#detail-view").addEventListener("click", (e) => {
      if (e.target === e.currentTarget) closeDetail();
    });

    $("#bootstrap-banner-dismiss").addEventListener("click", () => {
      state.bootstrapDismissed = true;
      $("#bootstrap-banner").classList.add("hidden");
    });

    // Project switcher
    $("#switcher-trigger").addEventListener("click", (e) => {
      e.stopPropagation();
      toggleSwitcher();
    });
    document.addEventListener("click", (e) => {
      if (!state.switcherOpen) return;
      const menu = $("#switcher-menu");
      const trigger = $("#switcher-trigger");
      if (menu.contains(e.target) || trigger.contains(e.target)) return;
      closeSwitcher();
    });

    // Back to overview
    $("#back-to-overview").addEventListener("click", navigateToOverview);

    // Add project
    $("#add-project-toggle").addEventListener("click", showAddForm);
    $("#add-project-cancel").addEventListener("click", hideAddForm);
    $("#add-project-form").addEventListener("submit", (e) => {
      e.preventDefault();
      submitAddProject();
    });

    // Confirm modal
    $("#confirm-cancel").addEventListener("click", closeConfirm);
    $("#confirm-dismiss").addEventListener("click", closeConfirm);
    $("#confirm-modal").addEventListener("click", (e) => {
      if (e.target === e.currentTarget || e.target.classList.contains("modal-backdrop")) {
        closeConfirm();
      }
    });
    $("#confirm-ok").addEventListener("click", () => {
      const cb = state.confirmCallback;
      closeConfirm();
      if (typeof cb === "function") cb();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (!$("#confirm-modal").classList.contains("hidden")) {
        closeConfirm();
        return;
      }
      if (state.switcherOpen) {
        closeSwitcher();
        return;
      }
      if (state.currentPhaseId != null) {
        closeDetail();
        return;
      }
      if (state.view === "project") {
        navigateToOverview();
      }
    });
  }

  // ----------------------------------------------------------
  // Init
  // ----------------------------------------------------------
  async function init() {
    initTheme();
    wireEvents();

    // Load overview first so the switcher menu has data even on a deep-link.
    await loadOverview();

    // Honor localStorage last-project on cold start when no explicit hash.
    // Use history.replaceState (no hashchange event) so handleRoute runs once below.
    if (!location.hash || location.hash === "#" || location.hash === "#/") {
      try {
        const last = localStorage.getItem(LS_LAST_PROJECT);
        if (last && state.projects.find((p) => p.slug === last && p.exists)) {
          history.replaceState(null, "", `#/projects/${encodeURIComponent(last)}`);
        }
      } catch (e) {
        // ignore
      }
    }

    await handleRoute();
    subscribeEvents();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
