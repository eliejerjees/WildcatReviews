const ROOT_CLASS = 'davidson-rmp-root';
const CELL_PROCESSED_ATTR = 'data-davidson-rmp-processed';
const LOOKUP_CACHE = new Map();
let modalEl = null;
let backdropEl = null;
let statusEl = null;
let tableObserverStarted = false;

function boot() {
  ensureStatus();
  updateStatus('RMP scanning');
  ensureModal();
  runScan();
  startObservers();
}

function ensureStatus() {
  if (statusEl) return;
  statusEl = document.createElement('div');
  statusEl.id = 'davidson-rmp-status';
  statusEl.textContent = 'RMP loading';
  document.documentElement.appendChild(statusEl);
}

function updateStatus(message) {
  if (statusEl) statusEl.textContent = message;
}

function ensureModal() {
  if (backdropEl) return;
  backdropEl = document.createElement('div');
  backdropEl.id = 'davidson-rmp-backdrop';
  backdropEl.hidden = true;
  backdropEl.addEventListener('click', event => {
    if (event.target === backdropEl) closeModal();
  });
  modalEl = document.createElement('div');
  modalEl.id = 'davidson-rmp-modal';
  modalEl.innerHTML = '<div class="davidson-rmp-loading">Loading…</div>';
  backdropEl.appendChild(modalEl);
  document.documentElement.appendChild(backdropEl);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !backdropEl.hidden) closeModal();
  });
}

function openModal(html) {
  ensureModal();
  modalEl.innerHTML = html;
  backdropEl.hidden = false;
}

function closeModal() {
  if (backdropEl) backdropEl.hidden = true;
}

function getRatingColor(value) {
  const rating = Number(value || 0);
  if (rating >= 5) return '#219653';
  if (rating >= 4) return '#8ece6f';
  if (rating >= 3) return '#f2c94c';
  if (rating >= 2) return '#f2994b';
  if (rating >= 1) return '#eb5758';
  return '#6b7280';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatPercent(value) {
  return value === -1 || value == null ? 'N/A' : `${Math.round(value)}%`;
}

function formatDate(value) {
  if (!value) return 'Unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}


function getNormalizedText(value) {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function getHeaderCellByText(table, targetText) {
  const headers = Array.from(table.querySelectorAll('thead th, [role="columnheader"]'));
  const normalizedTarget = targetText.toLowerCase();
  return headers.find((cell) => getNormalizedText(cell.innerText || cell.textContent || '').toLowerCase() === normalizedTarget)
    || headers.find((cell) => getNormalizedText(cell.innerText || cell.textContent || '').toLowerCase().includes(normalizedTarget))
    || null;
}

function rectCenterX(rect) {
  return rect.left + (rect.width / 2);
}

function getInstructorCells() {
  const results = [];
  const seen = new Set();
  const tables = Array.from(document.querySelectorAll('table[role="grid"], table.MuiTable-root'));

  tables.forEach((table) => {
    const headerCell = getHeaderCellByText(table, 'Instructor');
    if (!headerCell) return;

    const headerRect = headerCell.getBoundingClientRect();
    if (!headerRect.width) return;
    const minX = headerRect.left;
    const maxX = headerRect.right;

    const rows = Array.from(table.querySelectorAll('tbody tr'));
    rows.forEach((row) => {
      const cells = Array.from(row.querySelectorAll('td'));
      let bestCell = null;
      let bestDistance = Infinity;

      cells.forEach((cell) => {
        const rect = cell.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const centerX = rectCenterX(rect);
        const overlapsHeader = centerX >= minX && centerX <= maxX;
        const text = getNormalizedText(cell.innerText || cell.textContent || '');
        if (!text) return;
        if (/\bnotes?\b/i.test(text)) return;

        const looksLikeProfessorCell = /[A-Za-z][A-Za-z'’.-]+\s+[A-Z]\b/.test(text) && !/[0-9]/.test(text);
        if (!looksLikeProfessorCell && !overlapsHeader) return;

        const distance = Math.abs(centerX - rectCenterX(headerRect));
        if ((overlapsHeader || looksLikeProfessorCell) && distance < bestDistance) {
          bestCell = cell;
          bestDistance = distance;
        }
      });

      if (bestCell && !seen.has(bestCell)) {
        seen.add(bestCell);
        results.push(bestCell);
      }
    });
  });

  return results;
}

function normalizeDisplayName(name) {
  let text = (name || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.includes(',')) {
    const [last, first] = text.split(',').map(part => part.trim()).filter(Boolean);
    if (last && first) text = `${first} ${last}`;
  }
  return text;
}

function extractProfessorNamesFromCell(cell) {
  const raw = (cell.innerText || cell.textContent || '').replace(/\u2022/g, ' ');
  if (!raw) return [];

  const names = [];
  const regex = /([A-Za-z'’.-]+(?:\s+[A-Za-z'’.-]+)*)\s+([A-Z])\b/g;
  let match;
  while ((match = regex.exec(raw)) !== null) {
    const candidate = normalizeDisplayName(`${match[1]} ${match[2]}`);
    if (!candidate) continue;
    if (/\bnotes?\b/i.test(candidate)) continue;
    if (/\b(?:tba|staff)\b/i.test(candidate)) continue;
    names.push(candidate);
  }

  return Array.from(new Set(names));
}

async function lookupProfessor(name) {
  if (!LOOKUP_CACHE.has(name)) {
    LOOKUP_CACHE.set(name, new Promise(resolve => {
      chrome.runtime.sendMessage({ type: 'LOOKUP_PROFESSOR', professorName: name }, response => {
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(response || { success: false, error: 'No response from background script' });
      });
    }));
  }
  return LOOKUP_CACHE.get(name);
}

function buildModalHtml(professorName, data) {
  if (!data) {
    return `
      <button class="davidson-rmp-close" aria-label="Close">×</button>
      <div class="davidson-rmp-header">
        <h2>${escapeHtml(professorName)}</h2>
        <p>No Rate My Professors data found for Davidson College.</p>
      </div>
    `;
  }

  const ratingColor = getRatingColor(data.avgRating);
  const reviewHtml = (data.reviews?.length ? data.reviews : []).map(review => `
    <div class="davidson-rmp-review">
      <div class="davidson-rmp-review-meta">
        <span>${escapeHtml(formatDate(review.date))}</span>
        ${review.className ? `<span>${escapeHtml(review.className)}</span>` : ''}
        ${review.grade ? `<span>Grade: ${escapeHtml(review.grade)}</span>` : ''}
      </div>
      <p>${escapeHtml(review.comment)}</p>
    </div>
  `).join('');

  const tagHtml = (data.tags || []).slice(0, 4).map(tag => `
    <span class="davidson-rmp-tag">${escapeHtml(tag.tagName)}${tag.tagCount ? ` · ${tag.tagCount}` : ''}</span>
  `).join('');

  return `
    <button class="davidson-rmp-close" aria-label="Close">×</button>
    <div class="davidson-rmp-header">
      <h2>${escapeHtml(data.firstName)} ${escapeHtml(data.lastName)}</h2>
      <a href="${escapeHtml(data.profileUrl)}" target="_blank" rel="noopener noreferrer">Open on Rate My Professors ↗</a>
    </div>
    <div class="davidson-rmp-summary">
      <div class="davidson-rmp-score" style="background:${ratingColor}">
        <div class="davidson-rmp-score-main">${escapeHtml(data.avgRating ?? 'N/A')}</div>
        <div class="davidson-rmp-score-sub">/ 5</div>
      </div>
      <div class="davidson-rmp-metrics">
        <div><span>Difficulty</span><strong>${escapeHtml(data.avgDifficulty ?? 'N/A')}</strong></div>
        <div><span>Would take again</span><strong>${escapeHtml(formatPercent(data.wouldTakeAgainPercent))}</strong></div>
        <div><span>Ratings</span><strong>${escapeHtml(data.numRatings ?? '0')}</strong></div>
        <div><span>Department</span><strong>${escapeHtml(data.department || 'N/A')}</strong></div>
      </div>
    </div>
    ${tagHtml ? `<div class="davidson-rmp-tags">${tagHtml}</div>` : ''}
    <div class="davidson-rmp-reviews-section">
      <h3>Recent comments</h3>
      ${reviewHtml || '<p class="davidson-rmp-empty">No review excerpts available.</p>'}
    </div>
  `;
}

function attachModalHandlers() {
  const closeBtn = modalEl.querySelector('.davidson-rmp-close');
  if (closeBtn) closeBtn.addEventListener('click', closeModal);
}

async function createProfessorLink(name) {
  const linkEl = document.createElement('a');
  linkEl.className = 'davidson-rmp-link';
  linkEl.href = '#';
  linkEl.textContent = name;

  const dot = document.createElement('span');
  dot.className = 'davidson-rmp-dot';
  dot.style.background = '#6b7280';
  linkEl.prepend(dot);

  const response = await lookupProfessor(name);
  if (response?.success && response?.data) {
    const color = getRatingColor(response.data.avgRating);
    linkEl.style.color = color;
    dot.style.background = color;
  } else {
    linkEl.style.color = '#6b7280';
  }

  linkEl.addEventListener('click', async event => {
    event.preventDefault();
    openModal('<div class="davidson-rmp-loading">Loading…</div>');
    attachModalHandlers();
    const freshResponse = await lookupProfessor(name);
    if (!freshResponse?.success || !freshResponse?.data) {
      openModal(buildModalHtml(name, null));
      attachModalHandlers();
      return;
    }
    openModal(buildModalHtml(name, freshResponse.data));
    attachModalHandlers();
  });

  return linkEl;
}

async function buildInstructorLinks(cell, names) {
  const container = document.createElement('div');
  container.className = 'davidson-rmp-name-list';
  for (let i = 0; i < names.length; i += 1) {
    const link = await createProfessorLink(names[i]);
    container.appendChild(link);
    if (i < names.length - 1) {
      const sep = document.createElement('span');
      sep.className = 'davidson-rmp-sep';
      sep.textContent = ', ';
      container.appendChild(sep);
    }
  }
  cell.textContent = '';
  cell.appendChild(container);
}

async function runScan() {
  const cells = getInstructorCells();
  let matched = 0;
  for (const cell of cells) {
    if (cell.getAttribute(CELL_PROCESSED_ATTR) === 'true') continue;
    const names = extractProfessorNamesFromCell(cell);
    if (!names.length) continue;
    cell.setAttribute(CELL_PROCESSED_ATTR, 'true');
    cell.classList.add(ROOT_CLASS);
    await buildInstructorLinks(cell, names);
    matched += names.length;
  }
  updateStatus(matched ? `RMP linked ${matched}` : 'RMP active');
}

function debounce(fn, wait) {
  let timer = null;
  return () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(fn, wait);
  };
}

function startObservers() {
  if (tableObserverStarted) return;
  tableObserverStarted = true;
  const rerun = debounce(runScan, 300);
  const observer = new MutationObserver(rerun);
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('hashchange', () => setTimeout(runScan, 500));
}

boot();
