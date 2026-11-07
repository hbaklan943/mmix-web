/* dock.js — a small dependency-free docking layout.

   The layout is a tree:
     { type: "row" | "col", children: [...], sizes: [fractions] }
     { type: "stack", panels: ["panel-id", ...], active: "panel-id" }

   Panels are existing DOM elements. The dock only moves them between
   containers, so their state (CodeMirror, scroll, inputs) survives.
   Drag a tab onto another stack's centre to join it as a tab, or onto one of
   its edges (or an edge of the whole window) to split. Layout is saved to
   localStorage. */
(function () {
  "use strict";

  const MIN_PX = 60;          // smallest size a split child can be dragged to
  const ROOT_EDGE_PX = 18;    // drop zone along the window edge
  const EDGE_FRACTION = 0.28; // outer part of a stack that means "split"

  let root, store, overlay, ghost;
  let panels = {};            // id -> { el, title, closable, badge }
  let defaultLayout = null;
  let storageKey = "dock-layout";
  let onLayout = null;
  let tree = null;
  const domOf = new WeakMap(); // tree node -> rendered element
  const nodeOf = new WeakMap(); // stack element -> tree node
  let loadedKnown = null;       // panel ids the saved layout knew about

  /* ---------- tree helpers ---------- */
  const clone = (x) => JSON.parse(JSON.stringify(x));

  function stackNodes(node, out = []) {
    if (!node) return out;
    if (node.type === "stack") out.push(node);
    else node.children.forEach((c) => stackNodes(c, out));
    return out;
  }
  function findStack(id) {
    return stackNodes(tree).find((s) => s.panels.includes(id)) || null;
  }
  function findParent(node, target, parent = null, index = -1) {
    if (node === target) return { parent, index };
    if (node.type === "stack") return null;
    for (let i = 0; i < node.children.length; i++) {
      const r = findParent(node.children[i], target, node, i);
      if (r) return r;
    }
    return null;
  }

  // Drop unknown / duplicate panels and empty nodes, collapse single-child
  // splits and merge nested splits of the same direction.
  function normalize(node, seen = new Set()) {
    if (!node || typeof node !== "object") return null;
    if (node.type === "stack") {
      const ids = (Array.isArray(node.panels) ? node.panels : []).filter((id) => panels[id] && !seen.has(id));
      ids.forEach((id) => seen.add(id));
      if (!ids.length) return null;
      return { type: "stack", panels: ids, active: ids.includes(node.active) ? node.active : ids[0] };
    }
    if ((node.type !== "row" && node.type !== "col") || !Array.isArray(node.children)) return null;
    const kids = [], sizes = [];
    node.children.forEach((c, i) => {
      const n = normalize(c, seen);
      if (!n) return;
      const s = node.sizes && node.sizes[i] > 0 ? node.sizes[i] : 1 / node.children.length;
      if (n.type === node.type) {
        const tot = n.sizes.reduce((a, b) => a + b, 0) || 1;
        n.children.forEach((cc, j) => { kids.push(cc); sizes.push((s * n.sizes[j]) / tot); });
      } else {
        kids.push(n);
        sizes.push(s);
      }
    });
    if (!kids.length) return null;
    if (kids.length === 1) return kids[0];
    const tot = sizes.reduce((a, b) => a + b, 0) || 1;
    return { type: node.type, children: kids, sizes: sizes.map((s) => s / tot) };
  }

  /* ---------- persistence ---------- */
  function save() {
    // `known`: panels that existed at save time, so panels added in a later
    // version of the app can be shown instead of looking "hidden".
    try { localStorage.setItem(storageKey, JSON.stringify({ v: 1, tree, known: Object.keys(panels) })); } catch (e) { /* private mode */ }
  }
  function load() {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || data.v !== 1) return null;
      const t = normalize(data.tree);
      // The editor must always be reachable.
      if (!t || !stackNodes(t).some((s) => s.panels.includes("panel-editor"))) return null;
      loadedKnown = Array.isArray(data.known) ? data.known : null;
      return t;
    } catch (e) {
      return null;
    }
  }

  /* ---------- rendering ---------- */
  function render() {
    for (const id in panels) store.appendChild(panels[id].el);
    root.textContent = "";
    if (tree) {
      const el = build(tree);
      el.style.flex = "1 1 0px";
      root.appendChild(el);
    }
    save();
    if (onLayout) onLayout();
  }

  function build(node) {
    if (node.type === "stack") return buildStack(node);
    const el = document.createElement("div");
    el.className = "dock-split dock-" + node.type;
    const kids = [];
    node.children.forEach((c, i) => {
      if (i > 0) el.appendChild(makeSplitter(node, i - 1, el, kids));
      const ch = build(c);
      ch.style.flex = `${node.sizes[i]} 1 0px`;
      kids.push(ch);
      el.appendChild(ch);
    });
    domOf.set(node, el);
    return el;
  }

  function buildStack(node) {
    const el = document.createElement("div");
    el.className = "dock-stack";
    const bar = document.createElement("div");
    bar.className = "dock-tabs";
    bar.setAttribute("role", "tablist");
    for (const id of node.panels) bar.appendChild(buildTab(node, id));
    const body = document.createElement("div");
    body.className = "dock-body";
    body.appendChild(panels[node.active].el);
    el.appendChild(bar);
    el.appendChild(body);
    domOf.set(node, el);
    nodeOf.set(el, node);
    return el;
  }

  function buildTab(node, id) {
    const p = panels[id];
    const tab = document.createElement("div");
    tab.className = "dock-tab" + (id === node.active ? " active" : "");
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", String(id === node.active));
    tab.dataset.panel = id;
    tab.title = "Drag to move this panel";
    const label = document.createElement("span");
    label.className = "dock-tab-label";
    label.textContent = p.title;
    tab.appendChild(label);
    if (p.badge) tab.appendChild(p.badge);
    if (p.closable) {
      const x = document.createElement("button");
      x.className = "dock-tab-close";
      x.title = "Hide panel (View menu shows it again)";
      x.textContent = "×";
      x.addEventListener("pointerdown", (e) => e.stopPropagation());
      x.addEventListener("click", (e) => { e.stopPropagation(); hide(id); });
      tab.appendChild(x);
    }
    tab.addEventListener("pointerdown", (e) => startDrag(e, id, node));
    return tab;
  }

  // Switch the visible tab of a stack without re-rendering everything.
  function select(node, id) {
    node.active = id;
    const el = domOf.get(node);
    if (!el || !el.isConnected) { render(); return; }
    el.querySelectorAll(".dock-tab").forEach((t) => {
      const on = t.dataset.panel === id;
      t.classList.toggle("active", on);
      t.setAttribute("aria-selected", String(on));
    });
    const body = el.querySelector(".dock-body");
    const cur = body.firstElementChild;
    if (cur !== panels[id].el) {
      if (cur) store.appendChild(cur);
      body.appendChild(panels[id].el);
    }
    save();
    if (onLayout) onLayout();
  }

  /* ---------- resizing ---------- */
  function makeSplitter(node, i, container, kids) {
    const sp = document.createElement("div");
    sp.className = "dock-splitter";
    sp.title = "Drag to resize";
    sp.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const horizontal = node.type === "row";
      const rect = container.getBoundingClientRect();
      const splitters = container.querySelectorAll(":scope > .dock-splitter").length;
      const total = (horizontal ? rect.width : rect.height) - splitters * sp.getBoundingClientRect()[horizontal ? "width" : "height"];
      const start = horizontal ? e.clientX : e.clientY;
      const a0 = node.sizes[i], b0 = node.sizes[i + 1];
      const minF = Math.min(MIN_PX / total, (a0 + b0) / 2);
      sp.classList.add("dragging");
      document.body.classList.add(horizontal ? "dock-resizing-x" : "dock-resizing-y");
      const move = (ev) => {
        const f = ((horizontal ? ev.clientX : ev.clientY) - start) / total;
        let a = a0 + f, b = b0 - f;
        if (a < minF) { b -= minF - a; a = minF; }
        if (b < minF) { a -= minF - b; b = minF; }
        node.sizes[i] = a;
        node.sizes[i + 1] = b;
        kids[i].style.flex = `${a} 1 0px`;
        kids[i + 1].style.flex = `${b} 1 0px`;
        if (onLayout) onLayout(true);
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        sp.classList.remove("dragging");
        document.body.classList.remove("dock-resizing-x", "dock-resizing-y");
        save();
        if (onLayout) onLayout();
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    });
    return sp;
  }

  /* ---------- drag & drop ---------- */
  function startDrag(e, id, fromNode) {
    if (e.button !== 0) return;
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY;
    let dragging = false, target = null;
    const move = (ev) => {
      if (!dragging) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
        dragging = true;
        ghost.textContent = panels[id].title;
        ghost.hidden = false;
        document.body.classList.add("dock-dragging");
      }
      ghost.style.left = ev.clientX + 14 + "px";
      ghost.style.top = ev.clientY + 12 + "px";
      target = hitTest(ev.clientX, ev.clientY, id, fromNode);
      showOverlay(target);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      ghost.hidden = true;
      overlay.hidden = true;
      document.body.classList.remove("dock-dragging");
      if (!dragging) { select(fromNode, id); return; }
      if (target) moveTo(id, fromNode, target);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function hitTest(x, y, id, fromNode) {
    const rr = root.getBoundingClientRect();
    if (x < rr.left || x > rr.right || y < rr.top || y > rr.bottom) return null;
    const near = [
      ["left", x - rr.left], ["right", rr.right - x], ["top", y - rr.top], ["bottom", rr.bottom - y],
    ].filter(([, d]) => d < ROOT_EDGE_PX).sort((a, b) => a[1] - b[1])[0];
    if (near) return { root: true, zone: near[0], rect: zoneRect(rr, near[0], 0.25) };

    const hit = document.elementFromPoint(x, y);
    const stackEl = hit && hit.closest(".dock-stack");
    const node = stackEl && nodeOf.get(stackEl);
    if (!node) return null;
    const sr = stackEl.getBoundingClientRect();
    const bar = stackEl.querySelector(".dock-tabs").getBoundingClientRect();
    let zone = "center";
    if (y > bar.bottom) {
      const fx = (x - sr.left) / sr.width, fy = (y - bar.bottom) / (sr.bottom - bar.bottom);
      const d = [["left", fx], ["right", 1 - fx], ["top", fy], ["bottom", 1 - fy]].sort((a, b) => a[1] - b[1])[0];
      if (d[1] < EDGE_FRACTION) zone = d[0];
    }
    // Dropping a panel onto its own stack only makes sense as a split, and
    // only if something else stays behind.
    if (node === fromNode && (zone === "center" || fromNode.panels.length === 1)) return null;
    return { node, zone, rect: zone === "center" ? sr : zoneRect(sr, zone, 0.5) };
  }

  function zoneRect(r, zone, f) {
    const w = r.width * f, h = r.height * f;
    switch (zone) {
      case "left": return { left: r.left, top: r.top, width: w, height: r.height };
      case "right": return { left: r.right - w, top: r.top, width: w, height: r.height };
      case "top": return { left: r.left, top: r.top, width: r.width, height: h };
      case "bottom": return { left: r.left, top: r.bottom - h, width: r.width, height: h };
      default: return r;
    }
  }

  function showOverlay(t) {
    if (!t) { overlay.hidden = true; return; }
    overlay.hidden = false;
    Object.assign(overlay.style, {
      left: t.rect.left + "px", top: t.rect.top + "px",
      width: t.rect.width + "px", height: t.rect.height + "px",
    });
  }

  function moveTo(id, fromNode, t) {
    fromNode.panels = fromNode.panels.filter((p) => p !== id);
    const fresh = { type: "stack", panels: [id], active: id };
    if (t.root) {
      const type = t.zone === "left" || t.zone === "right" ? "row" : "col";
      const before = t.zone === "left" || t.zone === "top";
      tree = { type, children: before ? [fresh, tree] : [tree, fresh], sizes: before ? [0.25, 0.75] : [0.75, 0.25] };
    } else if (t.zone === "center") {
      t.node.panels.push(id);
      t.node.active = id;
    } else {
      splitAt(t.node, t.zone, fresh);
    }
    tree = normalize(tree);
    render();
  }

  function splitAt(target, zone, fresh) {
    const type = zone === "left" || zone === "right" ? "row" : "col";
    const before = zone === "left" || zone === "top";
    const loc = findParent(tree, target);
    if (loc && loc.parent && loc.parent.type === type) {
      const p = loc.parent, half = p.sizes[loc.index] / 2;
      p.sizes[loc.index] = half;
      p.children.splice(before ? loc.index : loc.index + 1, 0, fresh);
      p.sizes.splice(before ? loc.index : loc.index + 1, 0, half);
      return;
    }
    const pair = { type, children: before ? [fresh, target] : [target, fresh], sizes: [0.5, 0.5] };
    if (loc && loc.parent) loc.parent.children[loc.index] = pair;
    else tree = pair;
  }

  /* ---------- public API ---------- */
  function hide(id) {
    const s = findStack(id);
    if (!s || !panels[id].closable) return;
    s.panels = s.panels.filter((p) => p !== id);
    tree = normalize(tree);
    render();
  }

  function placeNew(id) {
    const home = stackNodes(defaultLayout).find((d) => d.panels.includes(id));
    const buddy = home && home.panels.map(findStack).find(Boolean);
    const s = buddy || stackNodes(tree).find((n) => !n.panels.includes("panel-editor")) || stackNodes(tree)[0];
    s.panels.push(id);
  }

  function show(id) {
    if (!panels[id]) return;
    let s = findStack(id);
    if (!s && panels[id].split) {
      const [target, side] = panels[id].split.split(":");
      const t = findStack(target);
      if (t) {
        splitAt(t, side || "right", { type: "stack", panels: [id], active: id });
        tree = normalize(tree);
        render();
        return;
      }
    }
    if (!s) {
      // Put it back next to a panel it shared a stack with by default.
      const home = stackNodes(defaultLayout).find((d) => d.panels.includes(id));
      const buddy = home && home.panels.map(findStack).find(Boolean);
      s = buddy || stackNodes(tree).find((n) => !n.panels.includes("panel-editor")) || stackNodes(tree)[0];
      s.panels.push(id);
    }
    s.active = id;
    render();
  }

  function activate(id) {
    const s = findStack(id);
    if (!s) { show(id); return; }
    if (s.active !== id) select(s, id);
  }

  function reset() {
    tree = normalize(clone(defaultLayout));
    render();
  }

  function init(opts) {
    root = opts.root;
    store = opts.store;
    overlay = opts.overlay;
    ghost = opts.ghost;
    storageKey = opts.storageKey || storageKey;
    onLayout = opts.onLayout || null;
    panels = {};
    for (const el of store.querySelectorAll(".panel")) {
      panels[el.id] = {
        el,
        title: el.dataset.title || el.id,
        closable: el.id !== "panel-editor",
        badge: el.dataset.badge ? document.getElementById(el.dataset.badge) : null,
        // data-default-hidden: only shown on request (View menu, Help button)
        defaultHidden: !!el.dataset.defaultHidden,
        // data-dock-split="panel-id:side": where show() opens it if hidden
        split: el.dataset.dockSplit || null,
      };
    }
    defaultLayout = normalize(clone(opts.layout));
    const narrow = opts.narrowLayout && window.innerWidth < (opts.narrowWidth || 760);
    tree = load() || normalize(clone(narrow ? opts.narrowLayout : opts.layout));
    // Panels that are new since the layout was saved go to their default spot.
    if (loadedKnown) {
      for (const id of Object.keys(panels)) {
        if (!loadedKnown.includes(id) && !findStack(id) && !panels[id].defaultHidden) placeNew(id);
      }
    }
    render();
  }

  window.Dock = {
    init, activate, show, hide, reset,
    isVisible: (id) => !!findStack(id),
    panelList: () => Object.keys(panels).map((id) => ({ id, title: panels[id].title, visible: !!findStack(id), closable: panels[id].closable })),
  };
})();
