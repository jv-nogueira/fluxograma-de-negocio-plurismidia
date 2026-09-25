const IDEAL_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRPWNQ7rwTUNBgDEZjpcZXORDDaWnMXDzGM0udZCS2wPdD-PM_-FqhcvB2z1DduIVh43JBStqGmy5Lc/pub?gid=0&single=true&output=csv';
const ATUAL_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRPWNQ7rwTUNBgDEZjpcZXORDDaWnMXDzGM0udZCS2wPdD-PM_-FqhcvB2z1DduIVh43JBStqGmy5Lc/pub?gid=1647146284&single=true&output=csv';

const mainSvg = document.querySelector('#diagram');
const canvas = document.querySelector('#canvasWrap');
const emptyState = document.querySelector('#emptyState');
const status = document.querySelector('#status');
const statusText = document.querySelector('#statusText');
const searchInput = document.querySelector('#searchInput');
const tooltip = document.querySelector('#tooltip');
const details = document.querySelector('#details');

let graph = { nodes: [], edges: [] };
let view = { scale: 1, x: 0, y: 0 };
let drag = null;
let pinch = null;
let suppressNodeClick = false;
let selectedNodeElement = null;
let currentMode = 'atual';

function showToast(message) {
  const toast = document.querySelector('#toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3500);
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, char => ({ '&': '&', '<': '<', '>': '>', '"': '"', "'": '&#039;' }[char]));
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && quoted && next === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if ((char === ',' || char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(value);
      value = '';
      if (char !== ',') {
        rows.push(row);
        row = [];
      }
    } else {
      value += char;
    }
  }
  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }
  if (!rows.length) return [];
  const headers = rows.shift().map(header => header.trim().toLowerCase());
  return rows
    .filter(item => item.some(cell => cell.trim()))
    .map(item => Object.fromEntries(headers.map((header, i) => [header, (item[i] || '').trim()])));
}

function cleanLabel(label) {
  return label.replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]*>/g, '').replace(/"/g, '"').replace(/&#039;/g, "'");
}

function cleanDecisionLabel(label) {
  const trimmed = label.trim();
  if (trimmed.startsWith('SIM -->')) return trimmed.substring(7).trim();
  if (trimmed.startsWith('NÃO -->')) return trimmed.substring(8).trim();
  if (trimmed.startsWith('NAO -->')) return trimmed.substring(8).trim();
  return label;
}

function getEdgeLabel(label) {
  const trimmed = label.trim();
  if (trimmed.startsWith('SIM -->')) return 'Sim';
  if (trimmed.startsWith('NÃO -->')) return 'Não';
  if (trimmed.startsWith('NAO -->')) return 'Não';
  return '';
}

function makeGraph(rows) {
  const nodes = rows
    .filter(row => row.id && row.fluxo)
    .map(row => ({ id: row.id, label: cleanLabel(cleanDecisionLabel(row.fluxo)), row }));

  const ids = new Set(nodes.map(node => node.id));
  const edges = [];

  nodes.forEach(node => {
    const from = node.row.pai;
    if (from && ids.has(from)) {
      const label = getEdgeLabel(node.row.fluxo);
      edges.push({ from, to: node.id, label });
    }
  });

  return { nodes, edges };
}

function textLines(text, maxChars = 31) {
  const explicitLines = text.split('\n');
  const lines = [];
  explicitLines.forEach(explicitLine => {
    const words = explicitLine.split(/\s+/);
    let line = '';
    words.forEach(word => {
      if ((line + ' ' + word).trim().length > maxChars && line) {
        lines.push(line);
        line = word;
      } else {
        line = (line + ' ' + word).trim();
      }
    });
    if (line) lines.push(line);
    else lines.push('');
  });
  return lines;
}

function layoutGraph() {
  const incoming = new Map(graph.nodes.map(node => [node.id, []]));
  const children = new Map(graph.nodes.map(node => [node.id, []]));
  graph.edges.forEach(edge => {
    incoming.get(edge.to)?.push(edge.from);
    children.get(edge.from)?.push(edge.to);
  });
  const gapX = 70;
  const gapY = 220;
  const nodeW = 238;
  const positions = new Map();
  const roots = graph.nodes.filter(node => !(incoming.get(node.id) || []).length);
  const visited = new Set();

  const measure = (id, stack = new Set()) => {
    if (stack.has(id)) return 1;
    const nextStack = new Set(stack);
    nextStack.add(id);
    const branches = (children.get(id) || []).filter(child => !visited.has(child));
    return branches.length ? branches.reduce((total, child) => total + measure(child, nextStack), 0) : 1;
  };

  const place = (id, left, depth, stack = new Set()) => {
    if (stack.has(id) || visited.has(id)) return left;
    visited.add(id);
    const node = graph.nodes.find(item => item.id === id);
    const lines = textLines(node.label);
    const height = Math.max(54, lines.length * 18 + 20);
    const branches = (children.get(id) || []).filter(child => !visited.has(child));
    const width = Math.max(1, branches.reduce((total, child) => total + measure(child), 0));
    const childStart = branches.length ? left : left + 0.5;
    let childCursor = childStart;
    branches.forEach(child => {
      const childWidth = measure(child);
      place(child, childCursor, depth + 1, new Set([...stack, id]));
      childCursor += childWidth;
    });
    const center = branches.length ? (childStart + childCursor - 1) / 2 : left;
    positions.set(id, { x: center * (nodeW + gapX), y: depth * gapY, width: nodeW, height, lines, depth });
    return left + width;
  };

  let cursor = 0;
  roots.forEach(root => { cursor = place(root.id, cursor, 0); });
  graph.nodes.filter(node => !visited.has(node.id)).forEach(node => { cursor = place(node.id, cursor, 0); });

  if (positions.size > 0) {
    const center = [...positions.values()].reduce((sum, position) => sum + position.x, 0) / positions.size;
    positions.forEach(position => { position.x -= center; });
  }
  return positions;
}

function fit() {
  if (!mainSvg) return;
  const positions = layoutGraph();
  const all = [...positions.values()];
  if (all.length === 0) return;

  const minX = Math.min(...all.map(p => p.x - p.width / 2));
  const maxX = Math.max(...all.map(p => p.x + p.width / 2));
  const minY = Math.min(...all.map(p => p.y - p.height / 2));
  const maxY = Math.max(...all.map(p => p.y + p.height / 2));

  const margin = 60;
  const vbX = minX - margin;
  const vbY = minY - margin;
  const vbW = (maxX - minX) + margin * 2;
  const vbH = (maxY - minY) + margin * 2;

  mainSvg.setAttribute('viewBox', `${vbX} ${vbY} ${vbW} ${vbH}`);
  view.scale = 1;
  view.x = 0;
  view.y = 0;
  applyTransform();
}

function render() {
  if (!graph.nodes.length || !mainSvg) return;
  const positions = layoutGraph();

  mainSvg.innerHTML = `<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#8c9991"/></marker></defs>`;
  const edgeLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  const nodeLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  mainSvg.append(edgeLayer, nodeLayer);

  graph.edges.forEach(edge => {
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    if (!from || !to) return;
    const startX = from.x;
    const startY = from.y + from.height / 2;
    const endX = to.x;
    const endY = to.y - to.height / 2;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('class', 'edge');
    path.setAttribute('marker-end', 'url(#arrow)');
    path.setAttribute('d', `M ${startX} ${startY} C ${startX} ${startY + 45}, ${endX} ${endY - 45}, ${endX} ${endY}`);
    edgeLayer.append(path);
    if (edge.label) {
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('class', 'edge-label');
      label.setAttribute('x', (startX + endX) / 2 + (startX < endX ? 10 : -28));
      label.setAttribute('y', (startY + endY) / 2);
      label.setAttribute('text-anchor', startX < endX ? 'start' : 'end');
      label.setAttribute('style', 'fill:#d4eaf2;font-weight:700;paint-order:stroke;stroke:#111416;stroke-width:5px;stroke-linejoin:round;');
      label.textContent = edge.label;
      edgeLayer.append(label);
    }
  });

  graph.nodes.forEach(node => {
    const p = positions.get(node.id);
    if (!p) return;
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const isCategory = node.id === '1' || graph.edges.some(edge => edge.from === '1' && edge.to === node.id);
    const hasDecisionPaths = graph.edges.some(edge => edge.from === node.id && edge.label);
    const type = isCategory ? 'root' : hasDecisionPaths ? 'action' : 'question';
    group.setAttribute('class', `node ${type}`);
    group.dataset.id = node.id;
    group.setAttribute('transform', `translate(${p.x - p.width / 2}, ${p.y - p.height / 2})`);
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('width', p.width);
    rect.setAttribute('height', p.height);
    rect.setAttribute('rx', 7);
    group.append(rect);
    p.lines.forEach((line, i) => {
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', p.width / 2);
      text.setAttribute('y', 21 + i * 18);
      text.setAttribute('text-anchor', 'middle');
      text.textContent = line;
      group.append(text);
    });
    group.addEventListener('click', () => { if (!suppressNodeClick) selectNode(node.id, group); suppressNodeClick = false; });
    group.addEventListener('mouseenter', () => {
      if (!tooltip) return;
      tooltip.textContent = node.label;
      tooltip.style.display = 'block';

      const rectEl = rect.getBoundingClientRect();
      tooltip.style.left = `${rectEl.right}px`;
      tooltip.style.top = `${rectEl.top - tooltip.offsetHeight}px`;
    });
    group.addEventListener('mouseleave', () => { if (tooltip) tooltip.style.display = 'none'; });
    nodeLayer.append(group);
  });
}

function positionDetails() {
  if (!selectedNodeElement || !details || !details.classList.contains('open')) return;
  const ctm = selectedNodeElement.getScreenCTM();
  if (!ctm) return;
  const nodeWidth = 238;
  const nodeRight = ctm.e + nodeWidth;
  const nodeTop = ctm.f;
  const panel = details.getBoundingClientRect();
  const gap = 16;
  const left = nodeRight + gap + panel.width <= window.innerWidth ? nodeRight + gap : ctm.e - panel.width - gap;
  const top = Math.max(16, Math.min(nodeTop, window.innerHeight - panel.height - 16));
  details.style.left = `${Math.max(16, Math.min(left, window.innerWidth - panel.width - 16))}px`;
  details.style.right = 'auto';
  details.style.top = `${top}px`;
}

function selectNode(id, element) {
  document.querySelectorAll('.node').forEach(node => node.classList.toggle('selected', node.dataset.id === id));
  const node = graph.nodes.find(item => item.id === id);
  if (!node || !details) return;
  selectedNodeElement = element;
  const titleEl = document.querySelector('#detailTitle');
  const bodyEl = document.querySelector('#detailBody');
  const linksEl = document.querySelector('#detailLinks');
  if (titleEl) titleEl.textContent = node.label.split('\n')[0];
  if (bodyEl) bodyEl.innerHTML = node.label.replace(/\n/g, '<br>');
  const outgoing = graph.edges.filter(edge => edge.from === id);
  if (linksEl) {
    linksEl.innerHTML = outgoing.length
      ? `<div class="path">Próximos caminhos<br>${outgoing.map(edge => `${escapeHtml(edge.label || 'Próximo')} → ${escapeHtml(graph.nodes.find(item => item.id === edge.to)?.label.split('\n')[0] || edge.to)}`).join('<br>')}</div>`
      : '';
  }
  details.classList.add('open');
  positionDetails();
}

function applyTransform() {
  if (!mainSvg) return;

  if (view.scale <= 1) {
    view.scale = 1;
    view.x = 0;
    view.y = 0;
  } else if (canvas) {
    const rect = canvas.getBoundingClientRect();
    // Limites generosos baseados no tamanho da tela multiplicados pelo zoom
    const limitX = rect.width * view.scale;
    const limitY = rect.height * view.scale;

    view.x = Math.max(-limitX, Math.min(rect.width, view.x));
    view.y = Math.max(-limitY, Math.min(rect.height, view.y));
  }

  mainSvg.style.transformOrigin = '0 0';
  mainSvg.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;

  const label = document.querySelector('#zoomLabel');
  if (label && !label.classList.contains('editing')) {
    label.textContent = `${Math.round(view.scale * 10 + 90)}%`;
  }

  positionDetails();
}

function setZoomCentered(next, cx, cy) {
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const centerX = cx ?? rect.width / 2;
  const centerY = cy ?? rect.height / 2;

  const newScale = Math.max(1, next);
  if (newScale === 1) {
    view.x = 0;
    view.y = 0;
    view.scale = 1;
  } else {
    const scaleRatio = newScale / view.scale;
    view.x = centerX - (centerX - view.x) * scaleRatio;
    view.y = centerY - (centerY - view.y) * scaleRatio;
    view.scale = newScale;
  }
  applyTransform();
}

function editZoomLabel() {
  const label = document.querySelector('#zoomLabel');
  if (!label) return;
  label.classList.add('editing');
  const input = document.createElement('input');
  input.type = 'number';
  input.min = '100';
  input.max = '1000';
  input.value = Math.round(view.scale * 10);
  input.className = 'zoom-input';
  label.textContent = '';
  label.appendChild(input);
  input.focus();
  input.select();
  const commit = () => {
    const value = parseFloat(input.value);
    if (!isNaN(value) && value >= 10) { setZoomCentered(value / 10); }
    label.classList.remove('editing');
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    else if (e.key === 'Escape') { e.preventDefault(); label.classList.remove('editing'); applyTransform(); }
  });
}

async function loadCsv(url) {
  const button = document.querySelector('#loadButton');
  if (button) button.disabled = true;
  if (statusText) statusText.textContent = 'Carregando planilha...';
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    graph = makeGraph(parseCsv(await response.text()));
    if (!graph.nodes.length) throw new Error('Nenhum nó encontrado');
    const nodeCount = document.querySelector('#nodeCount');
    const edgeCount = document.querySelector('#edgeCount');
    if (nodeCount) nodeCount.textContent = graph.nodes.length;
    if (edgeCount) edgeCount.textContent = graph.edges.length;
    if (searchInput) searchInput.disabled = false;
    if (emptyState) emptyState.classList.add('hidden');
    if (status) status.classList.add('loaded');
    if (statusText) statusText.textContent = 'Planilha sincronizada';
    render();
    fit();
  } catch (error) {
    if (status) status.classList.remove('loaded');
    if (statusText) statusText.textContent = 'Falha ao carregar';
    showToast(`Não foi possível carregar o CSV: ${error.message}`);
  } finally {
    if (button) button.disabled = false;
  }
}

function switchMode(mode) {
  currentMode = mode;
  document.querySelectorAll('.mode-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.mode === mode));
  loadCsv(mode === 'atual' ? ATUAL_URL : IDEAL_URL);
}

document.querySelector('#loadButton')?.addEventListener('click', () => loadCsv(currentMode === 'atual' ? ATUAL_URL : IDEAL_URL));
document.querySelector('#zoomLabel')?.addEventListener('click', editZoomLabel);
document.querySelector('#fitButton')?.addEventListener('click', fit);
document.querySelector('#zoomInButton')?.addEventListener('click', () => setZoomCentered(view.scale + 1.0));
document.querySelector('#zoomOutButton')?.addEventListener('click', () => setZoomCentered(view.scale - 1.0));
document.querySelector('#closeDetails')?.addEventListener('click', () => details?.classList.remove('open'));
document.querySelector('#modeAtual')?.addEventListener('click', () => switchMode('atual'));
document.querySelector('#modeIdeal')?.addEventListener('click', () => switchMode('ideal'));

if (searchInput) {
  searchInput.addEventListener('input', event => {
    const query = event.target.value.toLowerCase();
    document.querySelectorAll('.node').forEach(node => {
      const item = graph.nodes.find(value => value.id === node.dataset.id);
      node.style.opacity = query && item && !item.label.toLowerCase().includes(query) ? '.18' : '1';
    });
  });
}

document.addEventListener('keydown', event => {
  if (!event.ctrlKey || event.altKey || event.metaKey) return;
  if (event.key === '+' || event.key === '=') { event.preventDefault(); setZoomCentered(view.scale + 1.0); }
  else if (event.key === '-') { event.preventDefault(); setZoomCentered(view.scale - 1.0); }
});

if (canvas) {
  canvas.addEventListener('wheel', event => {
    event.preventDefault();
    if (event.ctrlKey) {
      const rect = canvas.getBoundingClientRect();
      const zoomChange = event.deltaY < 0 ? 1.0 : -1.0;
      setZoomCentered(view.scale + zoomChange, event.clientX - rect.left, event.clientY - rect.top);
    } else {
      if (view.scale > 1) {
        view.x -= event.deltaX * 0.5;
        view.y -= event.deltaY * 0.5;
        applyTransform();
      }
    }
  }, { passive: false });

  canvas.addEventListener('selectstart', event => event.preventDefault());

  canvas.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    drag = { x: event.clientX - view.x, y: event.clientY - view.y, startX: event.clientX, startY: event.clientY, moved: false };
    suppressNodeClick = false;
    canvas.setPointerCapture(event.pointerId);
  });

  canvas.addEventListener('pointermove', event => {
    if (!drag) return;
    if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 4) drag.moved = true;
    if (view.scale > 1) {
      view.x = event.clientX - drag.x;
      view.y = event.clientY - drag.y;
      applyTransform();
    }
  });

  canvas.addEventListener('pointerup', () => {
    if (drag) suppressNodeClick = drag.moved;
    drag = null;
  });

  canvas.addEventListener('pointercancel', () => { drag = null; suppressNodeClick = true; });

  let lastPinchDist = 0;
  canvas.addEventListener('touchstart', event => {
    if (event.touches.length === 2) {
      event.preventDefault();
      const t1 = event.touches[0];
      const t2 = event.touches[1];
      lastPinchDist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
      pinch = { scale: view.scale };
      drag = null;
    } else if (event.touches.length === 1 && !drag) {
      const touch = event.touches[0];
      drag = { x: touch.clientX - view.x, y: touch.clientY - view.y, startX: touch.clientX, startY: touch.clientY, moved: false };
      suppressNodeClick = false;
    }
  }, { passive: false });

  canvas.addEventListener('touchmove', event => {
    if (event.touches.length === 2 && pinch) {
      event.preventDefault();
      const t1 = event.touches[0];
      const t2 = event.touches[1];
      const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
      const centerX = (t1.clientX + t2.clientX) / 2;
      const centerY = (t1.clientY + t2.clientY) / 2;
      const scale = pinch.scale * (dist / (lastPinchDist || 1));
      const rect = canvas.getBoundingClientRect();
      setZoomCentered(scale, centerX - rect.left, centerY - rect.top);
    } else if (event.touches.length === 1 && drag) {
      event.preventDefault();
      const touch = event.touches[0];
      if (Math.hypot(touch.clientX - drag.startX, touch.clientY - drag.startY) > 4) drag.moved = true;
      if (view.scale > 1) {
        view.x = touch.clientX - drag.x;
        view.y = touch.clientY - drag.y;
        applyTransform();
      }
    }
  }, { passive: false });

  canvas.addEventListener('touchend', event => {
    if (event.touches.length < 2) { pinch = null; lastPinchDist = 0; }
    if (drag) { suppressNodeClick = drag.moved; drag = null; }
  });

  canvas.addEventListener('touchcancel', () => { pinch = null; drag = null; suppressNodeClick = true; });
}

loadCsv(ATUAL_URL);