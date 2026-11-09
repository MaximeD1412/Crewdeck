// design/components.js: Crewdeck's library of Composants (classic script, no module).
// One custom element per Composant, in light DOM; its root carries data-name="<Composant>/<Variant>".
// A mockup shows, it does not work: no logic, no data loaded, no re-render.
(() => {
  const define = (name, render) => customElements.define(name, class extends HTMLElement {
    connectedCallback() {
      if (this.rendered) return;
      this.rendered = true;
      render(this);
    }
  });

  const cap = (s) => s ? s[0].toUpperCase() + s.slice(1) : s;
  const pascal = (s) => (s || "").split("-").map(cap).join("");
  const h = (tag, props = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === "class") n.className = v;
      else if (k === "name") n.dataset.name = v;
      else if (k === "text") n.textContent = v;
      else n.setAttribute(k, v === true ? "" : v);
    }
    for (const k of kids.flat()) if (k != null && k !== false) n.append(k);
    return n;
  };
  const a = (el, n, d) => el.hasAttribute(n) ? el.getAttribute(n) : d;
  // The element's children for a slot (moved, never copied); rest() the others, text included.
  const take = (el, slot) => [...el.children].filter((c) => c.getAttribute("slot") === slot);
  const rest = (el) => [...el.childNodes].filter((c) => !(c.nodeType === 1 && c.hasAttribute("slot")));

  // 00 Icons -----------------------------------------------------------------
  const P = {
    inbox: '<path d="M3 13h5l1 3h6l1-3h5"/><path d="M5 5h14l2 8v6H3v-6z"/>',
    bulb: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9V16h7v-2.1A6 6 0 0 0 12 3z"/>',
    pen: '<path d="M4 20l4-1 11-11-3-3L5 16z"/><path d="M14 7l3 3"/>',
    loop: '<path d="M4 12a8 8 0 0 1 14-5.3L20 9"/><path d="M20 4v5h-5"/><path d="M20 12a8 8 0 0 1-14 5.3L4 15"/><path d="M4 20v-5h5"/>',
    more: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
    send: '<path d="M12 19V5M5 12l7-7 7 7"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="1"/>',
    play: '<path d="M7 5l12 7-12 7z"/>',
    pause: '<path d="M8 5v14M16 5v14"/>',
    check: '<path d="M5 12l5 5 9-10"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    "chevron-right": '<path d="M9 6l6 6-6 6"/>',
    "chevron-down": '<path d="M6 9l6 6 6-6"/>',
    "arrow-left": '<path d="M19 12H5M11 6l-6 6 6 6"/>',
    block: '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>',
    gauge: '<path d="M4 18a8 8 0 1 1 16 0"/><path d="M12 18l4-6"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    doc: '<path d="M6 3h8l4 4v14H6z"/><path d="M9 12h6M9 16h6"/>',
    bolt: '<path d="M13 3L4 14h7l-1 7 9-11h-7z"/>',
    contract: '<path d="M9 11l3 3 8-8"/><path d="M20 12v7H4V5h11"/>',
    server: '<rect x="3" y="4" width="18" height="7" rx="1"/><rect x="3" y="13" width="18" height="7" rx="1"/><path d="M7 7.5h.01M7 16.5h.01"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3"/>',
    branch: '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="7" r="2"/><path d="M6 7v10M18 9c0 5-6 4-11 8"/>',
    pr: '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="19" r="2"/><path d="M6 7v10M18 17V9a3 3 0 0 0-3-3h-4M13 3l-2 3 2 3"/>',
    merge: '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="12" r="2"/><path d="M6 7v10M6 8c1 3 5 4 10 4"/>',
    github: '<path d="M9 19c-4 1.5-4-2-6-2.5M15 21v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12 12 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="1"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    folder: '<path d="M3 6h6l2 2h10v11H3z"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="1"/><path d="M5 15V4h11"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="1"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v4M12 17.5v.01"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/>',
    terminal: '<path d="M4 6l6 6-6 6M12 19h8"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6"/>',
    layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
    sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
    bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 21h4"/>',
    spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    ticket: '<path d="M3 7h18v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4z"/><path d="M14 7v10"/>',
    expand: '<path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="1"/><circle cx="9" cy="10" r="2"/><path d="M21 17l-5-5-9 8"/>',
    tree: '<path d="M5 4v16M5 8h6M5 16h6"/><rect x="11" y="5" width="8" height="6" rx="1"/><rect x="11" y="13" width="8" height="6" rx="1"/>',
    mark: '<path d="M4 16l8-8 8 8"/><path d="M4 21h16"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
    wifi: '<path d="M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 19.5v.01"/>',
  };
  const icon = (name, cls = "icon") => {
    const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    s.setAttribute("viewBox", "0 0 24 24");
    s.setAttribute("fill", "none");
    s.setAttribute("stroke", "currentColor");
    s.setAttribute("stroke-width", "2");
    s.setAttribute("stroke-linecap", "round");
    s.setAttribute("stroke-linejoin", "round");
    s.setAttribute("aria-hidden", "true");
    s.setAttribute("class", cls);
    s.innerHTML = P[name] || P.info;
    return s;
  };

  // <ui-icon name="inbox"></ui-icon>
  define("ui-icon", (el) => {
    const s = icon(a(el, "name"), `icon ${a(el, "size") === "sm" ? "icon--sm" : ""}`);
    s.dataset.name = `Icon/${pascal(a(el, "name"))}`;
    el.append(s);
  });

  // 01 Shell and navigation ----------------------------------------------------
  const NAV = [
    ["a-toi", "À toi", "inbox", true],
    ["idees", "Idées", "bulb", true],
    ["conceptions", "Conceptions", "pen", true],
    ["boucle", "Boucle", "loop", true],
    ["planning", "Planning", "calendar"],
    ["statistiques", "Statistiques", "chart"],
    ["projets", "Projets", "folder"],
    ["runner", "Runner et Comptes IA", "server"],
    ["parametres", "Paramètres", "settings"],
  ];
  const RUNNER = {
    online: ["go", "Runner en ligne", "Claude Code, Codex"],
    offline: ["halt", "Runner hors ligne", "depuis 14:02"],
    resync: ["caution", "Resynchronisation…", "Actions sensibles indisponibles"],
  };

  // <ui-app-shell screen="À toi" current="a-toi" decisions="6" runner="online|offline|resync" variant="bare">
  //   page… <… slot="banner"> <… slot="panel"> <… slot="overlay">
  define("ui-app-shell", (el) => {
    const variant = a(el, "variant", "default");
    const current = a(el, "current");
    const runner = a(el, "runner", "online");
    const decisions = a(el, "decisions");
    const counts = { "a-toi": decisions, idees: a(el, "ideas"), conceptions: a(el, "designs"), boucle: a(el, "loops") };
    const screen = a(el, "screen", "Page");
    const [rTone, rLabel, rDetail] = RUNNER[runner];
    const banner = take(el, "banner"), panel = take(el, "panel"), overlay = take(el, "overlay");
    const page = rest(el);
    const root = h("div", { class: `shell shell--${variant}${panel.length ? " shell--with-panel" : ""}${overlay.length ? " shell--with-overlay" : ""}`, name: `AppShell/${cap(variant)}` });
    const brand = () => h("div", { class: "shell-brand" }, h("span", { class: "shell-mark" }, icon("mark")), "Crewdeck");

    if (variant === "bare") {
      root.append(
        h("header", { class: "shell-bare-top", "aria-label": "Cadre / En-tête", name: "Cadre / En-tête" }, brand()),
        h("main", { class: "shell-page", "aria-label": `${screen} / Contenu`, name: `${screen} / Contenu` }, ...page),
        ...overlay.map((o) => h("div", { class: "shell-overlay" }, o)),
      );
      el.append(root);
      return;
    }

    const navLinks = (phone) => NAV.filter((n) => !phone || n[3]).map(([id, label, ic]) =>
      h("a", { href: "#", class: "shell-link", "aria-current": id === current ? "page" : null },
        icon(ic), h("span", { class: "shell-link-label" }, label),
        counts[id] && counts[id] !== "0" && (!phone || id === "a-toi") ? h("span", { class: phone ? "shell-tab-badge" : "shell-count" }, counts[id]) : null));
    const moreCurrent = !NAV.find((n) => n[0] === current && n[3]);

    root.append(
      h("nav", { class: "shell-side", "aria-label": "Cadre / Menu", name: "Cadre / Menu" },
        brand(),
        h("div", { class: "shell-nav" }, ...navLinks(false).slice(0, 4), h("hr"), ...navLinks(false).slice(4)),
        h("div", { class: "shell-foot" },
          h("div", { class: `shell-status shell-status--${rTone}` }, h("span", { class: `dot dot--${rTone}` }), h("b", { text: rLabel }), h("span", { text: rDetail })),
          runner === "online" ? h("div", { class: "shell-live" }, h("span", { class: "dot dot--accent dot--pulse" }), "En direct") : null,
          h("a", { href: "#", class: "shell-me" }, h("span", { class: "avatar", text: "MD" }), h("span", { text: "maximed1412" })))),
      h("header", { class: "shell-top", "aria-label": "Cadre / En-tête", name: "Cadre / En-tête" },
        brand(),
        h("span", { class: `shell-top-status shell-top-status--${rTone}` }, h("span", { class: `dot dot--${rTone}` }), runner === "online" ? "En direct" : rLabel)),
      h("div", { class: "shell-body" },
        banner.length ? h("div", { class: "shell-banners" }, ...banner) : null,
        h("main", { class: "shell-page", "aria-label": `${screen} / Contenu`, name: `${screen} / Contenu` }, ...page)),
      ...panel.map((p) => h("aside", { class: "shell-panel", "aria-label": "Cadre / Panneau", name: "Cadre / Panneau" }, p)),
      h("nav", { class: "shell-tabs", "aria-label": "Cadre / Barre du bas", name: "Cadre / Barre du bas" },
        ...navLinks(true),
        h("a", { href: "#", class: "shell-link", "aria-current": moreCurrent ? "page" : null }, icon("more"), h("span", { class: "shell-link-label" }, "Plus"))),
      ...overlay.map((o) => h("div", { class: "shell-overlay" }, o)),
    );
    el.append(root);
  });

  // <ui-page-header title="À toi" count="6 Décisions" back="Idées" screen="À toi">actions…</ui-page-header>
  define("ui-page-header", (el) => {
    const title = a(el, "title");
    const screen = a(el, "screen", title);
    const kids = rest(el);
    const sub = take(el, "sub");
    el.append(h("header", { class: "page-header", "aria-label": `${screen} / En-tête`, name: "PageHeader/Default" },
      a(el, "back") ? h("a", { href: "#", class: "page-back" }, icon("arrow-left", "icon icon--sm"), a(el, "back")) : null,
      h("div", { class: "page-header-row" },
        h("div", { class: "page-header-titles" },
          h("h1", { class: "page-title", text: title }),
          a(el, "count") ? h("span", { class: "page-count", text: a(el, "count") }) : null),
        kids.length ? h("div", { class: "page-actions" }, ...kids) : null),
      ...sub.map((s) => h("div", { class: "page-sub" }, s))));
  });

  // <ui-project-filter><ui-chip selected count="6">Tous les Projets</ui-chip>…</ui-project-filter>
  define("ui-project-filter", (el) => {
    el.append(h("div", { class: "chips", role: "group", "aria-label": "Filtrer par Projet", name: "ProjectFilter/Default" }, ...el.childNodes));
  });

  define("ui-chip", (el) => {
    const sel = el.hasAttribute("selected");
    el.append(h("button", { type: "button", class: `chip${sel ? " chip--selected" : ""}`, "aria-pressed": sel ? "true" : "false", name: `Chip/${sel ? "Selected" : "Default"}` },
      ...el.childNodes, a(el, "count") ? h("span", { class: "chip-count", text: a(el, "count") }) : null));
  });

  // <ui-tabs><ui-tab selected count="3">Analysées</ui-tab>…</ui-tabs>
  define("ui-tabs", (el) => {
    el.append(h("div", { class: "tabs", role: "tablist", name: "Tabs/Default" }, ...el.childNodes));
  });
  define("ui-tab", (el) => {
    const sel = el.hasAttribute("selected");
    el.append(h("button", { type: "button", role: "tab", class: `tab${sel ? " tab--selected" : ""}`, "aria-selected": sel ? "true" : "false" },
      ...el.childNodes, a(el, "count") ? h("span", { class: "tab-count", text: a(el, "count") }) : null));
  });

  // 02 Actions -------------------------------------------------------------------
  // <ui-button variant="primary|secondary|ghost|danger" size="sm" icon="plus" state="disabled|loading">Label</ui-button>
  define("ui-button", (el) => {
    const variant = a(el, "variant", "secondary");
    const state = a(el, "state");
    const b = h("button", { type: "button", class: `button button--${variant}${a(el, "size") === "sm" ? " button--sm" : ""}${a(el, "wide") != null ? " button--wide" : ""}${state ? ` is-${state}` : ""}`, name: `Button/${cap(variant)}` });
    if (state === "disabled" || state === "loading") b.disabled = true;
    if (state === "loading") b.append(h("span", { class: "spinner", "aria-hidden": "true" }));
    else if (a(el, "icon")) b.append(icon(a(el, "icon"), "icon icon--sm"));
    b.append(...el.childNodes);
    el.append(b);
  });

  // <ui-icon-button icon="x" label="Fermer"></ui-icon-button>
  define("ui-icon-button", (el) => {
    el.append(h("button", { type: "button", class: `icon-button${a(el, "variant") ? ` icon-button--${a(el, "variant")}` : ""}`, "aria-label": a(el, "label"), title: a(el, "label"), name: "IconButton/Default" }, icon(a(el, "icon"))));
  });

  // 03 Signals -------------------------------------------------------------------
  // <ui-status-badge tone="go">Mergé</ui-status-badge>
  define("ui-status-badge", (el) => {
    const tone = a(el, "tone", "neutral");
    el.append(h("span", { class: `badge badge--${tone}`, name: `StatusBadge/${cap(tone)}` }, ...el.childNodes));
  });

  // <ui-status-dot tone="go" pulse></ui-status-dot>
  define("ui-status-dot", (el) => {
    const tone = a(el, "tone", "go");
    el.append(h("span", { class: `dot dot--${tone}${el.hasAttribute("pulse") ? " dot--pulse" : ""}`, name: `StatusDot/${cap(tone)}`, "aria-hidden": "true" }));
  });

  // <ui-banner tone="caution" icon="refresh" title="Resynchronisation…">text <ui-button slot="actions">…</ui-button></ui-banner>
  define("ui-banner", (el) => {
    const tone = a(el, "tone", "accent");
    const acts = take(el, "actions");
    el.append(h("div", { class: `banner banner--${tone}`, role: "status", name: `Banner/${cap(tone)}` },
      icon(a(el, "icon", "info")),
      h("div", { class: "banner-body" }, h("b", { class: "banner-title", text: a(el, "title") }), h("span", { class: "banner-text" }, ...rest(el))),
      acts.length ? h("div", { class: "banner-actions" }, ...acts) : null));
  });

  // <ui-empty icon="inbox" title="Rien ne t’attend">text <ui-button>…</ui-button></ui-empty>
  define("ui-empty", (el) => {
    const acts = take(el, "actions");
    el.append(h("div", { class: "empty", name: "Empty/Default" },
      h("span", { class: "empty-icon" }, icon(a(el, "icon", "inbox"))),
      h("b", { class: "empty-title", text: a(el, "title") }),
      h("p", { class: "empty-text" }, ...rest(el)),
      acts.length ? h("div", { class: "empty-actions" }, ...acts) : null));
  });

  // 04 Rows and cards ------------------------------------------------------------
  // <ui-card title="Boucles en cours" count="2" label="À toi / Boucles en cours" flush>…<… slot="actions"></ui-card>
  define("ui-card", (el) => {
    const acts = take(el, "actions");
    const label = a(el, "label");
    el.append(h(label ? "section" : "div", { class: `card${el.hasAttribute("flush") ? " card--flush" : ""}`, "aria-label": label, name: "Card/Default" },
      a(el, "title") ? h("div", { class: "card-head" },
        h("h2", { class: "section-label" }, a(el, "title"), a(el, "count") ? h("span", { class: "section-count", text: a(el, "count") }) : null),
        acts.length ? h("div", { class: "card-actions" }, ...acts) : null) : null,
      h("div", { class: "card-body" }, ...rest(el))));
  });

  // <ui-decision-row tone="halt" icon="block" kind="Ticket bloqué" title="#42 …" meta="Crewdeck · Code · il y a 4 min">context<ui-button slot="actions">…</ui-button></ui-decision-row>
  define("ui-decision-row", (el) => {
    const tone = a(el, "tone", "accent");
    const acts = take(el, "actions");
    el.append(h("article", { class: `row row--decision row--${tone}`, name: `DecisionRow/${cap(tone)}` },
      h("span", { class: "row-rail" }),
      h("span", { class: "row-icon" }, icon(a(el, "icon", "info"))),
      h("div", { class: "row-main" },
        h("div", { class: "row-title" }, a(el, "kind") ? h("span", { class: "row-kind", text: `${a(el, "kind")} · ` }) : null, a(el, "title")),
        h("div", { class: "row-meta", text: a(el, "meta") }),
        rest(el).some((n) => n.textContent.trim()) ? h("div", { class: "row-context" }, ...rest(el)) : null),
      acts.length ? h("div", { class: "row-actions" }, ...acts) : null,
      icon("chevron-right", "icon icon--sm row-chevron")));
  });

  const IDEA = { "a-trier": ["neutral", "À trier"], analysee: ["accent", "Analysée"], retenue: ["go", "Retenue"], fusionnee: ["neutral", "Fusionnée"], rejetee: ["halt", "Rejetée"], "en-analyse": ["caution", "En analyse"] };
  // <ui-idea-row title="…" meta="…" state="analysee" impact="fort" effort="faible">summary</ui-idea-row>
  define("ui-idea-row", (el) => {
    const state = a(el, "state", "analysee");
    const [tone, label] = IDEA[state];
    const acts = take(el, "actions");
    const facts = [a(el, "impact") && `Impact ${a(el, "impact")}`, a(el, "effort") && `Effort ${a(el, "effort")}`, a(el, "duplicates") && a(el, "duplicates")].filter(Boolean);
    el.append(h("article", { class: `row row--plain${el.hasAttribute("selected") ? " row--selected" : ""}`, name: `IdeaRow/${pascal(state)}` },
      h("span", { class: "row-rail" }),
      h("span", { class: "row-icon" }, icon(state === "en-analyse" ? "spark" : "bulb")),
      h("div", { class: "row-main" },
        h("div", { class: "row-title" }, a(el, "title")),
        h("div", { class: "row-meta", text: a(el, "meta") }),
        rest(el).some((n) => n.textContent.trim()) ? h("div", { class: "row-context" }, ...rest(el)) : null,
        facts.length ? h("div", { class: "row-facts" }, ...facts.map((f) => h("span", { class: "fact", text: f }))) : null),
      h("div", { class: "row-actions" }, h("span", { class: `badge badge--${tone}`, name: `StatusBadge/${cap(tone)}`, text: label }), ...acts)));
  });

  const TICKET = { pret: ["neutral", "Prêt"], "en-cours": ["accent", "En cours"], "en-review": ["accent", "En review"], checks: ["accent", "Checks"], bloque: ["halt", "Bloqué"], "revue-visuelle": ["caution", "Revue visuelle"], interrompu: ["caution", "Interrompu"], merge: ["go", "Mergé"], attente: ["neutral", "En attente"] };
  // <ui-ticket-row number="42" title="…" meta="…" state="en-cours"></ui-ticket-row>
  define("ui-ticket-row", (el) => {
    const state = a(el, "state", "pret");
    const [tone, label] = TICKET[state];
    const acts = take(el, "actions");
    el.append(h("article", { class: `row row--ticket row--${tone}`, name: `TicketRow/${pascal(state)}` },
      h("span", { class: "row-rail" }),
      h("span", { class: "row-number", text: `#${a(el, "number")}` }),
      h("div", { class: "row-main" },
        h("div", { class: "row-title" }, a(el, "title")),
        a(el, "meta") ? h("div", { class: "row-meta", text: a(el, "meta") }) : null,
        rest(el).some((n) => n.textContent.trim()) ? h("div", { class: "row-context" }, ...rest(el)) : null),
      h("div", { class: "row-actions" }, h("span", { class: `badge badge--${tone}`, name: `StatusBadge/${cap(tone)}`, text: a(el, "label", label) }), ...acts)));
  });

  // <ui-agent-row projet="Personal OS" ticket="#53 Export du planning" step="en review" engine="Codex · gpt-5.5" since="depuis 6 min" tone="accent"></ui-agent-row>
  define("ui-agent-row", (el) => {
    const tone = a(el, "tone", "go");
    el.append(h("div", { class: "agent", name: "AgentRow/Default" },
      h("span", { class: `dot dot--${tone}${tone === "go" ? " dot--pulse" : ""}` }),
      h("div", { class: "agent-main" },
        h("div", { class: "agent-title" }, h("b", { text: a(el, "projet") }), a(el, "ticket") ? ` · ${a(el, "ticket")}` : ""),
        h("div", { class: "agent-meta" }, h("span", { class: `step step--${tone}`, text: a(el, "step") }), [a(el, "engine"), a(el, "since")].filter(Boolean).join(" · "))),
      ...take(el, "actions")));
  });

  // <ui-list-row icon="folder" title="…" meta="…">trailing…</ui-list-row>
  define("ui-list-row", (el) => {
    const tone = a(el, "tone");
    el.append(h("div", { class: `list-row${tone ? ` list-row--${tone}` : ""}${el.hasAttribute("link") ? " list-row--link" : ""}`, name: "ListRow/Default" },
      a(el, "icon") ? h("span", { class: "row-icon" }, icon(a(el, "icon"))) : null,
      h("div", { class: "row-main" },
        h("div", { class: "row-title" }, a(el, "title")),
        a(el, "meta") ? h("div", { class: "row-meta", text: a(el, "meta") }) : null,
        ...take(el, "below")),
      h("div", { class: "list-row-trail" }, ...rest(el)),
      el.hasAttribute("link") ? icon("chevron-right", "icon icon--sm list-row-chevron") : null));
  });

  // <ui-process-track><ui-step state="done" label="PRD" meta="approuvé le 3 nov."></ui-step>…</ui-process-track>
  define("ui-process-track", (el) => {
    el.append(h("ol", { class: `track${a(el, "direction") === "vertical" ? " track--vertical" : ""}`, name: "ProcessTrack/Default" }, ...el.childNodes));
  });
  const STEP_ICON = { done: "check", current: null, halt: "x", off: "pause", todo: null, caution: "alert" };
  define("ui-step", (el) => {
    const state = a(el, "state", "todo");
    const mark = h("span", { class: "track-mark" });
    if (STEP_ICON[state]) mark.append(icon(STEP_ICON[state], "icon icon--sm"));
    else if (state === "current") mark.append(h("span", { class: "track-pulse" }));
    el.append(h("li", { class: `track-step track-step--${state}`, "aria-current": state === "current" ? "step" : null },
      mark, h("div", { class: "track-text" }, h("b", { text: a(el, "label") }), a(el, "meta") ? h("span", { text: a(el, "meta") }) : null, ...el.childNodes)));
  });

  // <ui-usage-meter label="Claude · 5 h" value="100" detail="16:40" tone="caution"></ui-usage-meter>
  define("ui-usage-meter", (el) => {
    const v = Number(a(el, "value", "0"));
    const tone = a(el, "tone", v >= 100 ? "halt" : v >= 80 ? "caution" : "accent");
    const variant = tone === "accent" ? "Default" : cap(tone);
    const bar = h("i", { class: `meter-fill meter-fill--${tone}` });
    bar.style.width = `${Math.min(v, 100)}%`;
    const proj = a(el, "projection");
    const pm = proj ? h("i", { class: "meter-projection" }) : null;
    if (pm) pm.style.left = `${Math.min(Number(proj), 100)}%`;
    el.append(h("div", { class: "meter", name: `UsageMeter/${variant}` },
      h("div", { class: "meter-head" }, h("span", { text: a(el, "label") }), h("span", { class: "meter-value", text: `${v} %${a(el, "detail") ? ` · ${a(el, "detail")}` : ""}` })),
      h("div", { class: "meter-track", role: "meter", "aria-valuenow": v, "aria-valuemin": 0, "aria-valuemax": 100, "aria-label": a(el, "label") }, bar, pm),
      rest(el).some((n) => n.textContent.trim()) ? h("p", { class: "meter-note" }, ...rest(el)) : null));
  });

  // <ui-stat label="Délai Idée → merge" value="3,4" unit="j" detail="médiane, 30 jours"></ui-stat>
  define("ui-stat", (el) => {
    el.append(h("div", { class: "stat", name: "Stat/Default" },
      h("span", { class: "stat-label", text: a(el, "label") }),
      h("span", { class: "stat-value" }, a(el, "value"), a(el, "unit") ? h("small", { text: ` ${a(el, "unit")}` }) : null),
      a(el, "detail") ? h("span", { class: "stat-detail", text: a(el, "detail") }) : null,
      ...el.childNodes));
  });

  const CHECK = { passed: ["go", "check"], failed: ["halt", "x"], running: ["accent", null], pending: ["neutral", "clock"] };
  // <ui-check-row name="Tests" state="passed" detail="412 tests · 2 min 10 s"></ui-check-row>
  define("ui-check-row", (el) => {
    const state = a(el, "state", "passed");
    const [tone, ic] = CHECK[state];
    el.append(h("div", { class: `check check--${tone}`, name: `CheckRow/${cap(state)}` },
      h("span", { class: "check-mark" }, ic ? icon(ic, "icon icon--sm") : h("span", { class: "spinner" })),
      h("b", { text: a(el, "name") }),
      h("span", { class: "check-detail", text: a(el, "detail") }),
      ...el.childNodes));
  });

  // <ui-key-value><ui-kv label="Projet">Personal OS</ui-kv>…</ui-key-value>
  define("ui-key-value", (el) => {
    el.append(h("dl", { class: "kv", name: "KeyValue/Default" }, ...el.childNodes));
  });
  define("ui-kv", (el) => {
    el.append(h("dt", { text: a(el, "label") }), h("dd", {}, ...el.childNodes));
  });

  // <ui-code-block>curl -fsSL … | sh</ui-code-block>
  define("ui-code-block", (el) => {
    el.append(h("div", { class: "code", name: "CodeBlock/Default" },
      h("code", {}, ...el.childNodes),
      h("button", { type: "button", class: "code-copy", "aria-label": "Copier" }, icon("copy", "icon icon--sm"), h("span", { text: "Copier" }))));
  });

  // <ui-capture src="…" label="Maquette · 390"></ui-capture>
  define("ui-capture", (el) => {
    el.append(h("figure", { class: `capture${a(el, "size") ? ` capture--${a(el, "size")}` : ""}`, name: "Capture/Default" },
      h("img", { src: a(el, "src"), alt: a(el, "label") }),
      h("figcaption", {}, a(el, "label"), ...el.childNodes)));
  });

  // <ui-ticket-tree><ui-tree-node number="40" title="…" state="merge" depth="0"></ui-tree-node>…</ui-ticket-tree>
  define("ui-ticket-tree", (el) => {
    el.append(h("ul", { class: "tree", name: "TicketTree/Default" }, ...el.childNodes));
  });
  define("ui-tree-node", (el) => {
    const state = a(el, "state", "pret");
    const [tone, label] = TICKET[state];
    const li = h("li", { class: `tree-node tree-node--${tone}${el.hasAttribute("critical") ? " tree-node--critical" : ""}` },
      h("span", { class: "tree-indent" }, ...Array.from({ length: Number(a(el, "depth", "0")) }, () => h("i"))),
      h("span", { class: "row-number", text: `#${a(el, "number")}` }),
      h("span", { class: "tree-title" }, a(el, "title"), a(el, "blocked-by") ? h("small", { text: `bloqué par ${a(el, "blocked-by")}` }) : null),
      h("span", { class: `badge badge--${tone}`, text: label }));
    el.append(li);
  });

  // <ui-timeline weeks="S46,S47,…" today="1"><ui-timeline-row label="…" start="0" span="3" tone="go" meta="…"></ui-timeline-row></ui-timeline>
  define("ui-timeline", (el) => {
    const weeks = a(el, "weeks", "").split(",");
    const today = Number(a(el, "today", "-1"));
    const cols = `repeat(${weeks.length}, minmax(0, 1fr))`;
    const head = h("div", { class: "timeline-head" }, h("span"), h("div", { class: "timeline-weeks" }, ...weeks.map((w, i) => h("span", { class: i === today ? "is-today" : "", text: w }))));
    head.lastChild.style.gridTemplateColumns = cols;
    const rows = [...el.children];
    rows.forEach((r) => r.setAttribute("data-cols", weeks.length));
    el.append(h("div", { class: "timeline", name: "Timeline/Default", style: `--weeks: ${weeks.length}` }, head, ...rows));
  });
  define("ui-timeline-row", (el) => {
    const tone = a(el, "tone", "accent");
    const n = Number(a(el, "data-cols", "6"));
    const track = h("div", { class: "timeline-track" });
    track.style.gridTemplateColumns = `repeat(${n}, minmax(0, 1fr))`;
    const bar = h("span", { class: `timeline-bar timeline-bar--${tone}`, text: a(el, "meta") });
    bar.style.gridColumn = `${Number(a(el, "start", "0")) + 1} / span ${a(el, "span", "1")}`;
    track.append(bar);
    el.append(h("div", { class: "timeline-row" }, h("span", { class: "timeline-label" }, h("b", { text: a(el, "label") }), a(el, "detail") ? h("small", { text: a(el, "detail") }) : null), track));
  });

  // 05 Session (US-9) -------------------------------------------------------------
  const SESSION = { active: ["go", "active"], waiting: ["caution", "attend ta réponse"], stopped: ["neutral", "arrêtée"] };
  // <ui-session title="Concevoir · Agenda partagé" meta="Personal OS · Conception · Claude Code" state="active">messages… <ui-composer></ui-composer></ui-session>
  define("ui-session", (el) => {
    const state = a(el, "state", "active");
    const [tone, label] = SESSION[state];
    const composer = [...el.children].filter((c) => c.tagName === "UI-COMPOSER" || c.getAttribute("slot") === "footer");
    const kids = rest(el).filter((n) => !composer.includes(n));
    el.append(h("section", { class: `session session--${state}`, "aria-label": "Session / Conversation", name: "Session/Default" },
      h("header", { class: "session-head", "aria-label": "Session / En-tête" },
        h("ui-icon-button", { icon: "arrow-left", label: "Retour", class: "session-back" }),
        h("div", { class: "session-titles" },
          h("div", { class: "session-title" }, h("span", { class: `dot dot--${tone}${state === "active" ? " dot--pulse" : ""}` }), h("b", { text: a(el, "title") })),
          h("div", { class: "session-meta" }, h("span", { text: label }), ` · ${a(el, "meta")}`)),
        h("div", { class: "session-head-actions" },
          state === "stopped" ? h("ui-button", { size: "sm", icon: "play", variant: "secondary" }, "Reprendre") : h("ui-button", { size: "sm", icon: "stop", variant: "secondary" }, "Arrêter"),
          h("ui-icon-button", { icon: "expand", label: "Agrandir", class: "only-wide" }),
          h("ui-icon-button", { icon: "x", label: "Fermer", class: "only-wide" }))),
      h("div", { class: "session-crypto" }, icon("lock", "icon icon--sm"), "Chiffrée de bout en bout entre ton Runner et ce navigateur"),
      h("div", { class: "session-stream" }, ...kids),
      ...composer));
  });

  // <ui-message from="agent|pilote">text</ui-message>
  define("ui-message", (el) => {
    const from = a(el, "from", "agent");
    el.append(h("div", { class: `message message--${from}`, name: `Message/${cap(from)}` }, ...el.childNodes));
  });

  // <ui-tool-call tool="Read" target="docs/product/prd.md" detail="281 lignes"></ui-tool-call>
  define("ui-tool-call", (el) => {
    el.append(h("div", { class: "tool", name: "ToolCall/Default" },
      icon("chevron-right", "icon icon--sm"), h("b", { text: a(el, "tool") }), h("code", { text: a(el, "target") }), h("span", { class: "tool-detail", text: a(el, "detail") })));
  });

  // <ui-question title="…"><ui-option selected detail="…">Label</ui-option>…</ui-question>
  define("ui-question", (el) => {
    const acts = take(el, "actions");
    el.append(h("div", { class: "ask ask--question", role: "group", "aria-label": a(el, "title"), name: "Question/Default" },
      h("div", { class: "ask-head" }, icon("info", "icon icon--sm"), h("span", { text: a(el, "kicker", "Question") })),
      h("b", { class: "ask-title", text: a(el, "title") }),
      h("div", { class: "ask-options" }, ...rest(el)),
      h("div", { class: "ask-actions" }, ...(acts.length ? acts : [h("ui-button", { variant: "primary", size: "sm" }, "Répondre")]))));
  });
  define("ui-option", (el) => {
    const sel = el.hasAttribute("selected");
    el.append(h("label", { class: `option${sel ? " option--selected" : ""}` },
      h("span", { class: "option-mark" }, sel ? icon("check", "icon icon--sm") : null),
      h("span", { class: "option-text" }, h("b", {}, ...el.childNodes), a(el, "detail") ? h("span", { text: a(el, "detail") }) : null)));
  });

  // <ui-permission-request tool="Bash">git push origin …</ui-permission-request>
  define("ui-permission-request", (el) => {
    const acts = take(el, "actions");
    el.append(h("div", { class: "ask ask--permission", name: "PermissionRequest/Default" },
      h("div", { class: "ask-head" }, icon("shield", "icon icon--sm"), h("span", { text: "Demande de permission" })),
      h("b", { class: "ask-title", text: a(el, "title", `${a(el, "tool")} veut exécuter :`) }),
      h("code", { class: "ask-code" }, ...rest(el)),
      h("div", { class: "ask-actions" }, ...(acts.length ? acts : [
        h("ui-button", { variant: "primary", size: "sm" }, "Autoriser"),
        h("ui-button", { size: "sm" }, "Autoriser pour la session"),
        h("ui-button", { variant: "ghost", size: "sm" }, "Refuser")]))));
  });

  // <ui-composer placeholder="Écrire à l’agent" state="dictating|disabled">transcript</ui-composer>
  define("ui-composer", (el) => {
    const state = a(el, "state");
    const dict = state === "dictating";
    const text = rest(el);
    el.append(h("div", { class: `composer${dict ? " composer--dictating" : ""}${state === "disabled" ? " composer--disabled" : ""}`, name: `Composer/${dict ? "Dictating" : "Default"}` },
      h("div", { class: "composer-box" },
        text.some((n) => n.textContent.trim()) ? h("p", { class: "composer-text" }, ...text) : h("p", { class: "composer-placeholder", text: a(el, "placeholder", "Écrire à l’agent") }),
        h("div", { class: "composer-tools" },
          dict ? h("span", { class: "composer-rec" }, h("span", { class: "dot dot--halt dot--pulse" }), "Dictée en cours · 0:07") : h("span", { class: "composer-hint", text: a(el, "hint", "Entrée envoie · Maj+Entrée va à la ligne") }),
          h("button", { type: "button", class: `composer-mic${dict ? " is-on" : ""}`, "aria-label": dict ? "Arrêter la dictée" : "Dicter" }, icon(dict ? "stop" : "mic")),
          h("button", { type: "button", class: "composer-send", "aria-label": "Envoyer", disabled: state === "disabled" ? "" : null }, icon("send"))))));
  });

  // 06 Forms ----------------------------------------------------------------------
  // <ui-text-field label="…" value="…" placeholder="…" help="…" state="error" multiline></ui-text-field>
  define("ui-text-field", (el) => {
    const state = a(el, "state");
    const id = `f-${Math.random().toString(36).slice(2, 8)}`;
    const ml = el.hasAttribute("multiline");
    const input = h(ml ? "textarea" : "input", { id, class: "field-input", placeholder: a(el, "placeholder"), disabled: state === "disabled" ? "" : null, "aria-invalid": state === "error" ? "true" : null, rows: ml ? a(el, "rows", "3") : null });
    if (ml) input.textContent = a(el, "value", ""); else if (a(el, "value")) input.value = a(el, "value");
    if (ml && a(el, "value")) input.setAttribute("data-value", "");
    const trail = rest(el);
    el.append(h("div", { class: `field${state ? ` field--${state}` : ""}`, name: `TextField/${state === "error" ? "Error" : "Default"}` },
      a(el, "label") ? h("label", { for: id, class: "field-label", text: a(el, "label") }) : null,
      h("div", { class: "field-control" }, input, trail.length ? h("div", { class: "field-trail" }, ...trail) : null),
      a(el, "help") ? h("span", { class: "field-help", text: a(el, "help") }) : null));
  });

  // <ui-select label="Moteur" value="Claude Code" help="…"></ui-select>
  define("ui-select", (el) => {
    el.append(h("div", { class: "field", name: "Select/Default" },
      a(el, "label") ? h("span", { class: "field-label", text: a(el, "label") }) : null,
      h("button", { type: "button", class: "field-input select", "aria-haspopup": "listbox" }, h("span", { text: a(el, "value") }), ...rest(el), icon("chevron-down", "icon icon--sm")),
      a(el, "help") ? h("span", { class: "field-help", text: a(el, "help") }) : null));
  });

  // <ui-toggle label="…" checked help="…" state="disabled"></ui-toggle>
  define("ui-toggle", (el) => {
    const on = el.hasAttribute("checked");
    el.append(h("label", { class: `toggle${a(el, "state") === "disabled" ? " is-disabled" : ""}`, name: `Toggle/${on ? "On" : "Off"}` },
      h("span", { class: "toggle-text" }, a(el, "label") ? h("b", { text: a(el, "label") }) : null, a(el, "help") ? h("span", { text: a(el, "help") }) : null),
      h("button", { type: "button", role: "switch", class: `switch${on ? " switch--on" : ""}`, "aria-checked": on ? "true" : "false", "aria-label": a(el, "label") || a(el, "aria"), disabled: a(el, "state") === "disabled" ? "" : null }, h("i"))));
  });

  // <ui-checkbox checked>Label</ui-checkbox>
  define("ui-checkbox", (el) => {
    const on = el.hasAttribute("checked");
    el.append(h("label", { class: `check-input${on ? " is-on" : ""}${a(el, "state") === "disabled" ? " is-disabled" : ""}`, name: "Checkbox/Default" },
      h("span", { class: "check-box", role: "checkbox", "aria-checked": on ? "true" : "false" }, on ? icon("check", "icon icon--sm") : null),
      h("span", { class: "check-label" }, ...el.childNodes)));
  });

  // <ui-radio checked>Label</ui-radio>
  define("ui-radio", (el) => {
    const on = el.hasAttribute("checked");
    el.append(h("label", { class: `radio${on ? " is-on" : ""}`, name: "Radio/Default" },
      h("span", { class: "radio-mark", role: "radio", "aria-checked": on ? "true" : "false" }),
      h("span", { class: "check-label" }, ...el.childNodes)));
  });

  // <ui-setting-row label="…" help="…" origin="compte|projet">control</ui-setting-row>
  define("ui-setting-row", (el) => {
    const origin = a(el, "origin");
    el.append(h("div", { class: "setting", name: `SettingRow/${origin === "projet" ? "Changed" : "Inherited"}` },
      h("div", { class: "setting-text" },
        h("b", { text: a(el, "label") }),
        a(el, "help") ? h("span", { text: a(el, "help") }) : null,
        origin ? h("span", { class: `origin origin--${origin}` }, origin === "projet" ? "Modifié pour ce Projet" : "Hérité du compte", origin === "projet" ? h("a", { href: "#", text: "Revenir au compte" }) : null) : null),
      h("div", { class: "setting-control" }, ...el.childNodes)));
  });

  // 07 Overlays ---------------------------------------------------------------------
  // <ui-dialog title="…">body <ui-button slot="actions">…</ui-button></ui-dialog>
  define("ui-dialog", (el) => {
    const acts = take(el, "actions");
    el.append(h("div", { class: "dialog", role: "dialog", "aria-modal": "true", "aria-label": a(el, "title"), name: "Dialog/Default" },
      h("div", { class: "dialog-head" }, h("h2", { class: "dialog-title", text: a(el, "title") }), h("ui-icon-button", { icon: "x", label: "Fermer" })),
      h("div", { class: "dialog-body" }, ...rest(el)),
      acts.length ? h("div", { class: "dialog-actions" }, ...acts) : null));
  });

  // <ui-confirm-dialog title="Démarrer la Boucle de Personal OS ?" action="Démarrer la Boucle" icon="play">consequences…</ui-confirm-dialog>
  define("ui-confirm-dialog", (el) => {
    const state = a(el, "state");
    el.append(h("div", { class: "dialog dialog--confirm", role: "alertdialog", "aria-modal": "true", "aria-label": a(el, "title"), name: "ConfirmDialog/Default" },
      h("div", { class: "confirm-seal" }, icon("shield", "icon icon--sm"), "Confirmé par Crewdeck · Action sensible"),
      h("div", { class: "dialog-head" }, h("h2", { class: "dialog-title", text: a(el, "title") })),
      h("div", { class: "dialog-body" }, ...rest(el)),
      h("div", { class: "dialog-actions" },
        h("ui-button", { variant: "ghost" }, "Annuler"),
        h("ui-button", { variant: a(el, "tone") === "danger" ? "danger" : "primary", icon: a(el, "icon", "check"), state: state === "disabled" ? "disabled" : null }, a(el, "action")))));
  });
})();
