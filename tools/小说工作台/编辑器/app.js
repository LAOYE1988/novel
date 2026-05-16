/* ============ State ============ */
const API_BASE = '';
const STORAGE_KEY = 'novel_workbench';
const MAX_HISTORY_PER_AGENT = 100;
let state = loadState();
let currentChapterId = null;
let currentAgentId = null;
let agentConfigs = [];
let agentHistories = {};  /* per-agent conversation history for current novel */
let chapterBackup = {};
let dragChapterId = null;
let novelList = [];

function getHistoryKey() {
  return 'novel_workbench_history_' + state.novelName;
}

function loadAgentHistories() {
  try {
    const raw = localStorage.getItem(getHistoryKey());
    if (raw) {
      agentHistories = JSON.parse(raw);
      return;
    }
  } catch(e) {}
  agentHistories = {};
}

function saveAgentHistories() {
  try {
    localStorage.setItem(getHistoryKey(), JSON.stringify(agentHistories));
  } catch(e) {}
}

function trimAgentHistories() {
  for (const agentId in agentHistories) {
    const h = agentHistories[agentId];
    if (h.length > MAX_HISTORY_PER_AGENT) {
      agentHistories[agentId] = h.slice(h.length - MAX_HISTORY_PER_AGENT);
    }
  }
}

function buildHistoryBackupContent() {
  let md = `# 对话记录 - ${state.novelName}\n\n`;
  const now = new Date();
  md += `生成时间：${now.toLocaleString()}\n\n---\n\n`;
  for (const agentId in agentHistories) {
    const h = agentHistories[agentId];
    if (!h || h.length === 0) continue;
    const agent = agentConfigs.find(a => a.id === agentId);
    const name = agent ? agent.name : agentId;
    md += `## ${name}\n\n`;
    h.forEach(msg => {
      const role = msg.role === 'user' ? '🧑 用户' : msg.role === 'agent' ? '🤖 Agent' : '⚠️ 错误';
      md += `**${role}** (${msg.time || ''})\n\n${msg.content}\n\n`;
    });
    md += `---\n\n`;
  }
  return md;
}

async function backupChatHistory() {
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  const content = buildHistoryBackupContent();
  await api('/api/chat/history/save', {
    method: 'POST',
    body: JSON.stringify({ novel: state.novelName, content, date: dateStr })
  });
}

async function loadChatHistoryFromBackup() {
  /* History is primarily stored in localStorage per novel key.
     Backup files on disk are for the user's reference only. */
  const data = await api('/api/chat/history/load', {
    method: 'POST',
    body: JSON.stringify({ novel: state.novelName })
  });
  if (data && data.files && data.files.length > 0) {
    /* If localStorage has no history at all, rebuild from the latest backup */
    if (Object.keys(agentHistories).length === 0 || !Object.values(agentHistories).some(h => h.length > 0)) {
      const latest = data.files[0];
      if (latest) {
        const md = latest.content;
        const sections = md.split(/^## /m);
        sections.forEach(section => {
          if (!section.trim()) return;
          const lines = section.split('\n');
          const agentName = lines[0].trim();
          const cfg = agentConfigs.find(a => a.name === agentName);
          if (!cfg) return;
          const history = [];
          let currentRole = null;
          let currentTime = '';
          let currentContent = '';
          for (let i = 1; i < lines.length; i++) {
            const l = lines[i];
            const roleMatch = l.match(/^\*\*(.+?)\*\* \(([^)]*)\)/);
            if (roleMatch) {
              if (currentRole && currentContent.trim()) {
                const roleMap = { '🧑 用户': 'user', '🤖 Agent': 'agent', '⚠️ 错误': 'error' };
                history.push({ role: roleMap[currentRole] || 'user', content: currentContent.trim(), time: currentTime });
              }
              currentRole = roleMatch[1];
              currentTime = roleMatch[2];
              currentContent = '';
            } else {
              currentContent += l + '\n';
            }
          }
          if (currentRole && currentContent.trim()) {
            const roleMap = { '🧑 用户': 'user', '🤖 Agent': 'agent', '⚠️ 错误': 'error' };
            history.push({ role: roleMap[currentRole] || 'user', content: currentContent.trim(), time: currentTime });
          }
          if (history.length > 0) {
            agentHistories[cfg.id] = history;
          }
        });
      }
    }
  }
}

function defaultState() {
  return {
    novelName: '我的第一本小说',
    volumes: [
      { id: 'v1', name: '第一卷', chapters: [
        { id: 'c1', name: '第一章', content: '' }
      ]}
    ],
    chapterOrder: ['c1'],
    trash: [],
    versionHistory: {},
    settings: {
      人物: '',
      世界观: '',
      关系图: '',
      场景: '',
      伏笔: ''
    },
    outlines: {
      总纲: '',
      分卷: '',
      逐章细纲: ''
    },
    styleSample: '',
    personCards: [],
    sceneCards: []
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s.volumes) return s;
    }
  } catch(e) {}
  return defaultState();
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch(e) {}
}

async function api(path, opts = {}) {
  try {
    const r = await fetch(API_BASE + path, {
      headers: { 'Content-Type': 'application/json' },
      ...opts,
    });
    return await r.json();
  } catch (e) {
    return { error: e.message, ok: false };
  }
}

/* ============ Layout ============ */
function initLayout() {
  const container = document.getElementById('main');
  const allPanels = Array.from(container.querySelectorAll(':scope > .panel'));
  const allDividers = Array.from(container.querySelectorAll(':scope > .divider'));

  allDividers.forEach(div => {
    let startX, startW1;
    const panel1 = div.previousElementSibling;
    const panel2 = div.nextElementSibling;
    if (!allPanels.includes(panel1) || !allPanels.includes(panel2)) return;

    const otherPanels = allPanels.filter(p => p !== panel1 && p !== panel2);
    const otherDividers = allDividers.filter(d => d !== div);

    function getOtherFixedWidth() {
      let w = 0;
      otherPanels.forEach(p => w += p.offsetWidth);
      otherDividers.forEach(d => w += d.offsetWidth);
      return w;
    }

    div.addEventListener('mousedown', e => {
      e.preventDefault();
      startX = e.clientX;
      if (panel1.classList.contains('collapsed')) {
        panel1.classList.remove('collapsed');
        const btn1 = panel1.querySelector('.collapse-btn');
        if (btn1) { btn1.textContent = '◀'; btn1.title = '收起'; }
        panel1.style.flex = '0 0 ' + (panel1.dataset.savedWidth || '320px');
      }
      if (panel2.classList.contains('collapsed')) {
        panel2.classList.remove('collapsed');
        const btn2 = panel2.querySelector('.collapse-btn');
        if (btn2) { btn2.textContent = '◀'; btn2.title = '收起'; }
        panel2.style.flex = '0 0 ' + (panel2.dataset.savedWidth || '320px');
      }
      startW1 = panel1.offsetWidth;
      div.classList.add('active');
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    function onMove(e) {
      const dx = e.clientX - startX;
      const otherWidth = getOtherFixedWidth();
      const available = container.offsetWidth - otherWidth;
      const newW1 = Math.max(280, Math.min(available - 280, startW1 + dx));
      const newW2 = available - newW1 - div.offsetWidth;
      if (newW2 < 280) return;
      panel1.style.flex = '0 0 ' + newW1 + 'px';
      panel2.style.flex = '0 0 ' + newW2 + 'px';
    }

    function onUp() {
      div.classList.remove('active');
      saveLayout();
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
  });

  /* Horizontal divider: chapter tree vs editor */
  const hDivider = document.getElementById('divider-tree');
  if (hDivider) {
    const panel = hDivider.closest('.panel');
    const tree = document.getElementById('chapter-tree');
    const editor = document.getElementById('editor-area');
    let startY, startTreeH, containerH;

    hDivider.addEventListener('mousedown', e => {
      e.preventDefault();
      startY = e.clientY;
      startTreeH = tree.offsetHeight;
      containerH = panel.offsetHeight - hDivider.offsetHeight;
      hDivider.classList.add('active');
      document.addEventListener('mousemove', onHMove);
      document.addEventListener('mouseup', onHUp);
    });

    function onHMove(e) {
      const dy = e.clientY - startY;
      const minH = 60;
      const maxH = containerH - 200;
      const newH = Math.max(minH, Math.min(maxH, startTreeH + dy));
      tree.style.height = newH + 'px';
    }
    function onHUp() {
      hDivider.classList.remove('active');
      document.removeEventListener('mousemove', onHMove);
      document.removeEventListener('mouseup', onHUp);
    }
  }

  document.querySelectorAll('.panel-header .collapse-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const panel = btn.closest('.panel');
      if (panel.classList.contains('collapsed')) {
        panel.classList.remove('collapsed');
        btn.textContent = '◀';
        btn.title = '收起';
        const saved = panel.dataset.savedWidth;
        if (saved) {
          panel.style.flex = '0 0 ' + saved;
        }
      } else {
        panel.dataset.savedWidth = panel.style.flex ? panel.style.flex.replace(/.*\s+/, '') : panel.offsetWidth + 'px';
        panel.style.flex = '';
        panel.classList.add('collapsed');
        btn.textContent = '▶';
        btn.title = '展开';
      }
    });
  });

  /* Center tabs */
  document.querySelectorAll('.center-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.center-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.center-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      const target = document.getElementById('center-' + tab.dataset.panel);
      if (target) target.classList.add('active');
    });
  });

  /* Setting sub-tabs */
  document.querySelectorAll('.setting-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.setting-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.setting-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      const target = document.getElementById('sc-' + tab.dataset.panel);
      if (target) target.classList.add('active');
      renderSettingContent(tab.dataset.panel);
    });
  });

  /* Outline sub-tabs */
  document.querySelectorAll('.outline-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.outline-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.outline-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      const target = document.getElementById('oc-' + tab.dataset.panel);
      if (target) target.classList.add('active');
      renderOutlineContent(tab.dataset.panel);
    });
  });
}

/* ============ Chapter Tree ============ */
function renderChapterTree() {
  const tree = document.getElementById('chapter-tree');
  tree.innerHTML = '';
  state.volumes.forEach((vol, vi) => {
    const collapsed = vol._collapsed || false;
    const volDiv = document.createElement('div');
    volDiv.style.cssText = 'padding:3px 8px;font-size:11px;color:var(--text3);display:flex;align-items:center;gap:4px;cursor:pointer;user-select:none;';
    volDiv.innerHTML = `
      <span style="transition:transform .15s;display:inline-block;${collapsed ? 'transform:rotate(-90deg);' : ''}">▼</span>
      <span>📁</span>
      <span style="flex:1">${escapeHtml(vol.name)}</span>
      <button class="add-chapter" data-vid="${vol.id}" style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:14px;padding:0 4px;" title="新建章节">+</button>
    `;
    volDiv.addEventListener('click', e => {
      if (e.target.tagName === 'BUTTON') return;
      state.volumes[vi]._collapsed = !state.volumes[vi]._collapsed;
      saveState();
      renderChapterTree();
    });
    tree.appendChild(volDiv);

    if (!collapsed) {
      vol.chapters.forEach(ch => {
        const item = document.createElement('div');
        item.className = 'chapter-item' + (ch.id === currentChapterId ? ' active' : '');
        item.draggable = true;
        item.dataset.id = ch.id;
        item.dataset.vid = vol.id;
        item.innerHTML = `
          <span class="icon">📄</span>
          <span class="name">${escapeHtml(ch.name)}</span>
          <span class="del" data-id="${ch.id}" title="删除到回收站">✕</span>
        `;
        item.addEventListener('click', e => {
          if (e.target.classList.contains('del')) return;
          switchChapter(ch.id);
        });
        item.querySelector('.del').addEventListener('click', e => {
          e.stopPropagation();
          deleteChapter(ch.id);
        });

        /* Drag */
        item.addEventListener('dragstart', e => {
          dragChapterId = ch.id;
          item.classList.add('dragging');
          e.dataTransfer.effectAllowed = 'move';
        });
        item.addEventListener('dragend', () => {
          item.classList.remove('dragging');
          dragChapterId = null;
          document.querySelectorAll('.chapter-item').forEach(i => i.classList.remove('drag-over'));
        });
        item.addEventListener('dragover', e => {
          e.preventDefault();
          if (dragChapterId && dragChapterId !== ch.id) {
            document.querySelectorAll('.chapter-item').forEach(i => i.classList.remove('drag-over'));
            item.classList.add('drag-over');
          }
        });
        item.addEventListener('dragleave', () => item.classList.remove('drag-over'));
        item.addEventListener('drop', e => {
          e.preventDefault();
          item.classList.remove('drag-over');
          if (dragChapterId && dragChapterId !== ch.id) {
            reorderChapter(dragChapterId, ch.id);
          }
        });

        tree.appendChild(item);
      });
    }
  });
  updateStats();
}

function switchChapter(id) {
  saveCurrentContent();
  currentChapterId = id;
  const ch = findChapter(id);
  if (ch && ch._file) {
    // Load from file system
    api('/api/novel/chapter/read?file=' + encodeURIComponent(ch._file)).then(data => {
      if (data.content !== undefined) {
        ch.content = data.content;
        renderEditor();
      }
    });
  }
  renderChapterTree();
  renderEditor();
  renderAgentContext();
}

function addChapter(volId) {
  const vol = state.volumes.find(v => v.id === volId);
  if (!vol) return;
  const id = 'c' + Date.now();
  const num = vol.chapters.length + 1;
  vol.chapters.push({ id, name: `第${num}章`, content: '' });
  state.chapterOrder.push(id);
  saveState();
  switchChapter(id);
  showToast(`已新建「第${num}章」`);
}

function deleteChapter(id) {
  for (const vol of state.volumes) {
    const idx = vol.chapters.findIndex(c => c.id === id);
    if (idx !== -1) {
      const [ch] = vol.chapters.splice(idx, 1);
      state.trash.push({...ch, deletedAt: Date.now()});
      break;
    }
  }
  if (currentChapterId === id) {
    currentChapterId = state.volumes[0]?.chapters[0]?.id || null;
  }
  saveState();
  renderChapterTree();
  if (currentChapterId) renderEditor();
  showToast('已移入回收站');
}

function reorderChapter(dragId, targetId) {
  for (const vol of state.volumes) {
    const dragIdx = vol.chapters.findIndex(c => c.id === dragId);
    const targetIdx = vol.chapters.findIndex(c => c.id === targetId);
    if (dragIdx !== -1 && targetIdx !== -1) {
      const [item] = vol.chapters.splice(dragIdx, 1);
      const newIdx = vol.chapters.findIndex(c => c.id === targetId);
      vol.chapters.splice(newIdx, 0, item);
      break;
    }
  }
  saveState();
  renderChapterTree();
  showToast('章节顺序已调整');
}

function renameChapter(id, newName) {
  for (const vol of state.volumes) {
    const ch = vol.chapters.find(c => c.id === id);
    if (ch) { ch.name = newName; break; }
  }
  saveState();
  renderChapterTree();
}

/* ============ Editor ============ */
let editorSaveTimer = null;

function renderEditor() {
  const textarea = document.getElementById('editor-textarea');
  const title = document.getElementById('editor-chapter-title');
  if (!currentChapterId) {
    textarea.value = '';
    textarea.disabled = true;
    title.textContent = '请选择或新建章节';
    return;
  }
  textarea.disabled = false;
  const ch = findChapter(currentChapterId);
  if (!ch) return;
  title.textContent = ch.name;
  textarea.value = ch.content || '';
  textarea.focus();
  updateStats();
}

function findChapter(id) {
  for (const vol of state.volumes) {
    const ch = vol.chapters.find(c => c.id === id);
    if (ch) return ch;
  }
  return null;
}

function saveCurrentContent() {
  if (!currentChapterId) return;
  const textarea = document.getElementById('editor-textarea');
  const ch = findChapter(currentChapterId);
  if (!ch) return;
  const newContent = textarea.value;

  if (ch.content !== newContent) {
    if (!state.versionHistory[currentChapterId]) {
      state.versionHistory[currentChapterId] = [];
    }
    state.versionHistory[currentChapterId].push({
      content: ch.content,
      time: Date.now()
    });
    if (state.versionHistory[currentChapterId].length > 20) {
      state.versionHistory[currentChapterId].shift();
    }
    ch.content = newContent;
    saveState();

    // Auto-save to file system for existing chapters
    if (ch._file) {
      api('/api/workspace/save', {
        method: 'POST',
        body: JSON.stringify({ workspace: '文稿', file: ch._file, content: newContent })
      });
    }
  }
}

function autoSaveEditor() {
  if (editorSaveTimer) clearTimeout(editorSaveTimer);
  editorSaveTimer = setTimeout(() => {
    saveCurrentContent();
    updateStats();
  }, 2000);
}

function restoreVersion(id, versionIndex) {
  const history = state.versionHistory[id];
  if (!history || !history[versionIndex]) return;
  const ch = findChapter(id);
  if (!ch) return;
  const version = history[versionIndex];
  if (currentChapterId === id) {
    document.getElementById('editor-textarea').value = version.content;
  }
  ch.content = version.content;
  history.splice(versionIndex, 1);
  saveState();
  showToast('已恢复历史版本');
}

async function showVersionHistory() {
  if (!currentChapterId) return;
  const history = state.versionHistory[currentChapterId];
  if (!history || history.length === 0) {
    showToast('暂无历史版本');
    return;
  }
  let msg = '==== 历史版本 ====\n';
  history.forEach((v, i) => {
    const t = new Date(v.time).toLocaleString();
    msg += `[${i}] ${t} (${v.content.length}字)\n`;
  });
  msg += '\n输入编号恢复，或点击取消';
  const idx = await showModalPrompt('恢复版本\n\n' + msg, '');
  if (idx !== null && idx !== '') {
    const n = parseInt(idx);
    if (!isNaN(n) && n >= 0 && n < history.length) {
      restoreVersion(currentChapterId, n);
    }
  }
}

/* ============ Settings + Outline ============ */
function renderSettingContent(tab) {
  if (tab === '人物') { renderPersonCards(); return; }
  if (tab === '场景') { renderSceneCards(); return; }
  const el = document.getElementById('sc-' + tab);
  if (!el) return;
  const textarea = el.querySelector('textarea');
  if (!textarea) return;
  const keys = { '世界观':'世界观', '关系图':'关系图', '伏笔':'伏笔' };
  const key = keys[tab];
  if (!key) return;
  textarea.value = state.settings[key] || '';
}

function saveSetting(tab) {
  if (tab === '人物') { savePersonCards(); return; }
  if (tab === '场景') { saveSceneCards(); return; }
  const el = document.getElementById('sc-' + tab);
  if (!el) return;
  const textarea = el.querySelector('textarea');
  if (!textarea) return;
  const keys = { '世界观':'世界观', '关系图':'关系图', '伏笔':'伏笔' };
  const files = { '世界观':'世界观.md', '关系图':'关系图.md', '伏笔':'伏笔.json' };
  const key = keys[tab];
  if (!key) return;
  state.settings[key] = textarea.value;
  saveState();
  api('/api/workspace/save', {
    method: 'POST',
    body: JSON.stringify({ workspace: '设定集', file: files[tab], content: textarea.value })
  });
  renderAgentContext();
  showToast('已保存');
}

function renderOutlineContent(tab) {
  const el = document.getElementById('oc-' + tab);
  if (!el) return;
  const textarea = el.querySelector('textarea');
  if (!textarea) return;
  const keys = { '总纲':'总纲', '分卷':'分卷', '逐章细纲':'逐章细纲' };
  const key = keys[tab];
  if (!key) return;
  textarea.value = state.outlines[key] || '';
}

function saveOutline(tab) {
  const el = document.getElementById('oc-' + tab);
  if (!el) return;
  const textarea = el.querySelector('textarea');
  if (!textarea) return;
  const keys = { '总纲':'总纲', '分卷':'分卷', '逐章细纲':'逐章细纲' };
  const files = { '总纲':'总纲.md', '分卷':'分卷.md', '逐章细纲':'逐章细纲.md' };
  const key = keys[tab];
  if (!key) return;
  state.outlines[key] = textarea.value;
  saveState();
  api('/api/workspace/save', {
    method: 'POST',
    body: JSON.stringify({ workspace: '大纲', file: files[tab], content: textarea.value })
  });
  renderAgentContext();
  showToast('已保存');
}

/* ============ Stats ============ */
function updateStats() {
  const ch = currentChapterId ? findChapter(currentChapterId) : null;
  const content = ch ? (ch.content || '') : '';
  const charCount = content.replace(/\s/g, '').length;
  const wordTarget = 5000;
  const pct = Math.min(100, Math.round(charCount / wordTarget * 100));

  document.getElementById('stat-chars').textContent = charCount.toLocaleString() + '字';
  const wc = document.getElementById('word-count');
  if (wc) wc.textContent = charCount.toLocaleString();
  document.querySelector('#stat-progress .fill').style.width = pct + '%';

  let total = 0;
  state.volumes.forEach(v => v.chapters.forEach(() => total++));
  document.getElementById('stat-chapters').textContent = total + '章';
}

/* ============ Novel Management ============ */
async function loadNovels() {
  const data = await api('/api/novels');
  novelList = data.novels || [];
  const current = data.current || state.novelName;
  state.novelName = current;
  saveState();

  const sel = document.getElementById('novel-select');
  sel.innerHTML = '';
  novelList.forEach(n => {
    const o = document.createElement('option');
    o.value = n;
    o.textContent = n;
    if (n === current) o.selected = true;
    sel.appendChild(o);
  });
}

async function loadNovelData(name) {
  // Load existing settings from 设定集
  const settingFiles = {
    '人物': { ws: '设定集', file: '人物.json' },
    '世界观': { ws: '设定集', file: '世界观.md' },
    '关系图': { ws: '设定集', file: '关系图.md' },
    '场景': { ws: '设定集', file: '场景.md' },
    '伏笔': { ws: '设定集', file: '伏笔.json' }
  };
  for (const [key, info] of Object.entries(settingFiles)) {
    const res = await api(`/api/novel/workspace/read?ws=${encodeURIComponent(info.ws)}&file=${encodeURIComponent(info.file)}`);
    if (res.content !== undefined) {
      state.settings[key] = res.content;
    }
  }

  // Load existing outlines from 大纲
  const outlineFiles = {
    '总纲': { ws: '大纲', file: '总纲.md' },
    '分卷': { ws: '大纲', file: '分卷.md' },
    '逐章细纲': { ws: '大纲', file: '逐章细纲.md' }
  };
  for (const [key, info] of Object.entries(outlineFiles)) {
    const res = await api(`/api/novel/workspace/read?ws=${encodeURIComponent(info.ws)}&file=${encodeURIComponent(info.file)}`);
    if (res.content !== undefined) {
      state.outlines[key] = res.content;
    }
  }
  saveState();
  // Parse人物 cards from settings
  try {
    let raw = JSON.parse(state.settings['人物'] || '[]');
    if (raw.人物) raw = raw.人物;
    state.personCards = Array.isArray(raw) ? raw : [];
  } catch(e) { state.personCards = []; }
  // Parse场景 cards from settings
  state.sceneCards = parseSceneMD(state.settings['场景'] || '');
  saveState();
}

/* ============ Entry Cards (人物/场景 per-entry with image) ============ */
function renderPersonCards() {
  const container = document.getElementById('cards-人物');
  if (!container) return;
  container.innerHTML = '';
  const cards = state.personCards || [];
  if (cards.length === 0) {
    container.innerHTML = '<div class="entry-card-empty">暂无角色，点击下方「新增角色」添加</div>';
    return;
  }
  cards.forEach((entry, i) => {
    const name = entry.姓名 || entry.name || `角色${i+1}`;
    const desc = entry.简介 || entry.描述 || entry.description || JSON.stringify(entry, null, 2);
    const summary = desc.replace(/\s+/g, ' ').substring(0, 120);
    const collapsed = entry._collapsed ? true : false;
    const card = document.createElement('div');
    card.className = 'entry-card';
    card.dataset.collapseIdx = i;
    card.innerHTML = `
      <div class="entry-card-header" data-toggle="1">
        <span class="toggle-icon">▼</span>
        <span>👤</span>
        <input class="entry-name" value="${escapeHtml(name)}" data-idx="${i}" placeholder="角色姓名">
        <button class="del-entry" data-idx="${i}">✕</button>
      </div>
      <div class="entry-card-summary" data-toggle="1">${escapeHtml(summary || '空')}</div>
      <div class="entry-card-body">
        <div style="flex:1;display:flex;flex-direction:column;">
          <textarea class="entry-text" data-idx="${i}" placeholder="角色设定：身份、性格、能力、背景...">${escapeHtml(desc)}</textarea>
          <div class="entry-actions">
            <button class="smart-btn" data-idx="${i}">✨ 智能整理</button>
          </div>
        </div>
        <div class="entry-image">
          <div class="img-preview" id="person-img-${i}"><div class="no-img">无图片</div></div>
          <button class="upload-img-btn" data-idx="${i}" data-tab="人物">📷 上传</button>
        </div>
      </div>`;
    // Set initial collapse state
    if (collapsed) {
      card.querySelector('.entry-card-body').style.display = 'none';
      card.querySelector('.toggle-icon').style.transform = 'rotate(-90deg)';
      const sum = card.querySelector('.entry-card-summary');
      if (sum) sum.style.display = 'flex';
    }
    container.appendChild(card);

    // Upload image
    card.querySelector('.upload-img-btn').addEventListener('click', e => {
      const idx = parseInt(e.target.dataset.idx);
      const name = state.personCards[idx]?.姓名 || `角色${idx}`;
      uploadEntryImage('人物', name, `person-img-${idx}`);
    });
    // Load initial image
    loadEntryImage('人物', name, `person-img-${i}`);
    // Delete
    card.querySelector('.del-entry').addEventListener('click', e => {
      e.stopPropagation();
      const idx = parseInt(e.target.dataset.idx);
      state.personCards.splice(idx, 1);
      renderPersonCards();
      showToast('角色已删除');
    });
    // Name change
    card.querySelector('.entry-name').addEventListener('change', e => {
      const idx = parseInt(e.target.dataset.idx);
      if (!isNaN(idx)) state.personCards[idx].姓名 = e.target.value;
    });
    // Smart format
    card.querySelector('.smart-btn').addEventListener('click', e => {
      e.stopPropagation();
      const idx = parseInt(e.target.dataset.idx);
      if (!isNaN(idx)) smartFormatPerson(idx);
    });
    // Auto-format on blur
    card.querySelector('.entry-text').addEventListener('blur', e => {
      const idx = parseInt(e.target.dataset.idx);
      if (isNaN(idx)) return;
      const formatted = smartLocalFormat(e.target.value);
      if (formatted !== e.target.value) {
        e.target.value = formatted;
        state.personCards[idx].简介 = formatted;
      }
    });
  });
  /* Delegated collapse toggle */
  bindPersonCollapseToggle();
}

function bindPersonCollapseToggle() {
  const container = document.getElementById('cards-人物');
  if (!container) return;
  // Remove old listener if any
  container.removeEventListener('click', container._collapseHandler);
  container._collapseHandler = e => {
    const toggleEl = e.target.closest('[data-toggle="1"]');
    if (!toggleEl) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') return;
    const card = toggleEl.closest('.entry-card');
    if (!card) return;
    const idx = parseInt(card.dataset.collapseIdx);
    if (isNaN(idx) || !state.personCards[idx]) return;

    state.personCards[idx]._collapsed = !state.personCards[idx]._collapsed;
    const body = card.querySelector('.entry-card-body');
    const icon = card.querySelector('.toggle-icon');
    const summary = card.querySelector('.entry-card-summary');
    if (state.personCards[idx]._collapsed) {
      if (body) body.style.display = 'none';
      if (icon) icon.style.transform = 'rotate(-90deg)';
      if (summary) summary.style.display = 'flex';
    } else {
      if (body) body.style.display = '';
      if (icon) icon.style.transform = '';
      if (summary) summary.style.display = '';
    }
  };
  container.addEventListener('click', container._collapseHandler);
}

function smartLocalFormat(text) {
  // If already seems structured (has - or ：or numbered), keep mostly as-is
  if (/[-•·]|：|\d+[\.\)、]/.test(text)) return text;
  // Split by Chinese/English sentence endings
  const parts = text.split(/(?<=[。！？.!?\n])/).map(s => s.trim()).filter(Boolean);
  if (parts.length <= 1) return text;
  // Format as bullet points
  return parts.map(s => {
    s = s.trim();
    if (!s) return '';
    // Try to extract a label
    const labelMatch = s.match(/^([^，。,\.:：\s]{1,10}[：:]?)\s*/);
    if (labelMatch) {
      const label = labelMatch[1].replace(/[：:]$/, '');
      return `- **${label}**：${s.substring(labelMatch[0].length)}`;
    }
    return `- ${s}`;
  }).filter(Boolean).join('\n');
}

async function smartFormatPerson(idx) {
  const card = document.querySelector(`#cards-人物 .entry-card[data-collapse-idx="${idx}"]`);
  if (!card) return;
  const textarea = card.querySelector('.entry-text');
  if (!textarea) return;
  const raw = textarea.value;
  if (!raw.trim()) { showToast('内容为空，无需整理'); return; }

  // First try local format
  const local = smartLocalFormat(raw);
  textarea.value = local;
  state.personCards[idx].简介 = local;
  // Then try AI format if available
  const prompt = `你是一个小说设定整理助手。请将以下关于角色的原始描述，整理为结构清晰的要点格式，每行以"- **标签**：内容"开头。标签例如：身份、性格、外貌、能力、背景、动机、关系等。只输出整理后的内容，不要额外解释。\n\n原始描述：\n${raw}`;
  try {
    const res = await api('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ agent_id: 'setting-manager', message: prompt })
    });
    if (res.reply) {
      let cleaned = res.reply.replace(/^["']|["']$/g, '').trim();
      if (cleaned) {
        textarea.value = cleaned;
        state.personCards[idx].简介 = cleaned;
        showToast('✨ AI 已整理完毕');
        return;
      }
    }
  } catch(e) {}
  // AI failed but local is already applied
  showToast('✓ 已本地整理');
}

async function smartFormatScene(idx) {
  const card = document.querySelector(`#cards-场景 .entry-card[data-collapse-idx="${idx}"]`);
  if (!card) return;
  const textarea = card.querySelector('.entry-text');
  if (!textarea) return;
  const raw = textarea.value;
  if (!raw.trim()) { showToast('内容为空，无需整理'); return; }

  const local = smartLocalFormat(raw);
  textarea.value = local;
  state.sceneCards[idx].描述 = local;

  const prompt = `你是一个小说场景设定整理助手。请将以下关于场景的原始描述，整理为结构清晰的要点格式，每行以"- **标签**：内容"开头。标签例如：地点、氛围、关联人物、用途等。只输出整理后的内容。\n\n原始描述：\n${raw}`;
  try {
    const res = await api('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ agent_id: 'setting-manager', message: prompt })
    });
    if (res.reply) {
      let cleaned = res.reply.replace(/^["']|["']$/g, '').trim();
      if (cleaned) {
        textarea.value = cleaned;
        state.sceneCards[idx].描述 = cleaned;
        showToast('✨ AI 已整理完毕');
        return;
      }
    }
  } catch(e) {}
  showToast('✓ 已本地整理');
}

function savePersonCards() {
  // Read current textarea values
  document.querySelectorAll('#cards-人物 .entry-card').forEach(card => {
    const idx = parseInt(card.querySelector('.entry-name').dataset.idx);
    if (isNaN(idx)) return;
    const name = card.querySelector('.entry-name').value;
    const desc = card.querySelector('.entry-text').value;
    if (!state.personCards[idx]) return;
    state.personCards[idx].姓名 = name;
    state.personCards[idx].简介 = desc;
  });
  // Build JSON
  const output = { 小说: state.novelName, 人物: state.personCards };
  state.settings['人物'] = JSON.stringify(output, null, 2);
  saveState();
  api('/api/workspace/save', {
    method: 'POST',
    body: JSON.stringify({ workspace: '设定集', file: '人物.json', content: state.settings['人物'] })
  });
  renderAgentContext();
  showToast('人物已保存');
}

function addPersonCard() {
  state.personCards.push({ 姓名: '新角色', 简介: '' });
  renderPersonCards();
}

function parseSceneMD(md) {
  const cards = [];
  const lines = md.split('\n');
  let current = null;
  for (const line of lines) {
    const m = line.match(/^##\s+(.+)/);
    if (m) {
      if (current) cards.push(current);
      current = { 标题: m[1].trim(), 描述: '' };
    } else if (current) {
      current.描述 += line + '\n';
    }
  }
  if (current) cards.push(current);
  if (cards.length === 0 && md.trim()) {
    cards.push({ 标题: '场景', 描述: md });
  }
  return cards;
}

function renderSceneCards() {
  const container = document.getElementById('cards-场景');
  if (!container) return;
  container.innerHTML = '';
  const cards = state.sceneCards || [];
  if (cards.length === 0) {
    container.innerHTML = '<div class="entry-card-empty">暂无场景，点击下方「新增场景」添加</div>';
    return;
  }
  cards.forEach((entry, i) => {
    const name = entry.标题 || `场景${i+1}`;
    const desc = entry.描述 || '';
    const summary = desc.replace(/\s+/g, ' ').substring(0, 120);
    const collapsed = entry._collapsed ? true : false;
    const card = document.createElement('div');
    card.className = 'entry-card';
    card.dataset.collapseIdx = i;
    card.innerHTML = `
      <div class="entry-card-header" data-toggle="1">
        <span class="toggle-icon">▼</span>
        <span>🎬</span>
        <input class="entry-name" value="${escapeHtml(name)}" data-idx="${i}" placeholder="场景名称">
        <button class="del-entry" data-idx="${i}">✕</button>
      </div>
      <div class="entry-card-summary" data-toggle="1">${escapeHtml(summary || '空')}</div>
      <div class="entry-card-body">
        <div style="flex:1;display:flex;flex-direction:column;">
          <textarea class="entry-text" data-idx="${i}" placeholder="场景描述：地点、气氛、关联人物...">${escapeHtml(desc)}</textarea>
          <div class="entry-actions">
            <button class="smart-btn" data-idx="${i}">✨ 智能整理</button>
          </div>
        </div>
        <div class="entry-image">
          <div class="img-preview" id="scene-img-${i}"><div class="no-img">无图片</div></div>
          <button class="upload-img-btn" data-idx="${i}" data-tab="场景">📷 上传</button>
        </div>
      </div>`;
    // Set initial collapse state
    if (collapsed) {
      card.querySelector('.entry-card-body').style.display = 'none';
      card.querySelector('.toggle-icon').style.transform = 'rotate(-90deg)';
      const sum = card.querySelector('.entry-card-summary');
      if (sum) sum.style.display = 'flex';
    }
    container.appendChild(card);
    // Upload image
    card.querySelector('.upload-img-btn').addEventListener('click', e => {
      const idx = parseInt(e.target.dataset.idx);
      const name = state.sceneCards[idx]?.标题 || `场景${idx}`;
      uploadEntryImage('场景', name, `scene-img-${idx}`);
    });
    // Load initial image
    loadEntryImage('场景', name, `scene-img-${i}`);
    // Delete
    card.querySelector('.del-entry').addEventListener('click', e => {
      e.stopPropagation();
      const idx = parseInt(e.target.dataset.idx);
      state.sceneCards.splice(idx, 1);
      renderSceneCards();
      showToast('场景已删除');
    });
    // Name change
    card.querySelector('.entry-name').addEventListener('change', e => {
      const idx = parseInt(e.target.dataset.idx);
      if (!isNaN(idx)) state.sceneCards[idx].标题 = e.target.value;
    });
    // Smart format
    card.querySelector('.smart-btn').addEventListener('click', e => {
      e.stopPropagation();
      const idx = parseInt(e.target.dataset.idx);
      if (!isNaN(idx)) smartFormatScene(idx);
    });
    // Auto-format on blur
    card.querySelector('.entry-text').addEventListener('blur', e => {
      const idx = parseInt(e.target.dataset.idx);
      if (isNaN(idx)) return;
      const formatted = smartLocalFormat(e.target.value);
      if (formatted !== e.target.value) {
        e.target.value = formatted;
        state.sceneCards[idx].描述 = formatted;
      }
    });
  });
  bindSceneCollapseToggle();
}

function bindSceneCollapseToggle() {
  const container = document.getElementById('cards-场景');
  if (!container) return;
  container.removeEventListener('click', container._collapseHandlerScene);
  container._collapseHandlerScene = e => {
    const toggleEl = e.target.closest('[data-toggle="1"]');
    if (!toggleEl) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') return;
    const card = toggleEl.closest('.entry-card');
    if (!card) return;
    const idx = parseInt(card.dataset.collapseIdx);
    if (isNaN(idx) || !state.sceneCards[idx]) return;

    state.sceneCards[idx]._collapsed = !state.sceneCards[idx]._collapsed;
    const body = card.querySelector('.entry-card-body');
    const icon = card.querySelector('.toggle-icon');
    const summary = card.querySelector('.entry-card-summary');
    if (state.sceneCards[idx]._collapsed) {
      if (body) body.style.display = 'none';
      if (icon) icon.style.transform = 'rotate(-90deg)';
      if (summary) summary.style.display = 'flex';
    } else {
      if (body) body.style.display = '';
      if (icon) icon.style.transform = '';
      if (summary) summary.style.display = '';
    }
  };
  container.addEventListener('click', container._collapseHandlerScene);
}

function saveSceneCards() {
  document.querySelectorAll('#cards-场景 .entry-card').forEach(card => {
    const idx = parseInt(card.querySelector('.entry-name').dataset.idx);
    if (isNaN(idx)) return;
    const name = card.querySelector('.entry-name').value;
    const desc = card.querySelector('.entry-text').value;
    if (!state.sceneCards[idx]) return;
    state.sceneCards[idx].标题 = name;
    state.sceneCards[idx].描述 = desc;
  });
  // Build markdown
  let md = '# 场景设定\n\n';
  state.sceneCards.forEach(s => {
    md += `## ${s.标题}\n${s.描述.trim() ? '\n' + s.描述.trim() + '\n' : '\n-\n'}\n`;
  });
  state.settings['场景'] = md;
  saveState();
  api('/api/workspace/save', {
    method: 'POST',
    body: JSON.stringify({ workspace: '设定集', file: '场景.md', content: md })
  });
  renderAgentContext();
  showToast('场景已保存');
}

function addSceneCard() {
  state.sceneCards.push({ 标题: '新场景', 描述: '' });
  renderSceneCards();
}

async function loadEntryImage(tab, name, imgId) {
  const preview = document.getElementById(imgId);
  if (!preview) return;
  const encoded = encodeURIComponent(name);
  const res = await api(`/api/novel/entry/image?tab=${encodeURIComponent(tab)}&name=${encoded}`);
  if (res.file) {
    preview.innerHTML = `<img src="/api/novel/entry/image/${encodeURIComponent(tab)}/${encoded}" alt="">`;
  } else {
    preview.innerHTML = '<div class="no-img">无图片</div>';
  }
}

async function uploadEntryImage(tab, name, imgId) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/png,image/jpeg,image/webp,image/gif';
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const res = await api('/api/novel/entry/image/upload', {
        method: 'POST',
        body: JSON.stringify({ tab, name, data: reader.result })
      });
      if (res.ok) {
        loadEntryImage(tab, name, imgId);
        showToast('图片已上传');
      } else {
        showToast('上传失败');
      }
    };
    reader.readAsDataURL(file);
  };
  input.click();
}

async function switchNovel(name) {
  /* Save current novel's agent histories before switching */
  saveAgentHistories();

  const data = await api('/api/novel/switch', {
    method: 'POST',
    body: JSON.stringify({ name })
  });
  if (data.ok) {
    state.novelName = name;
    state.settings = { 人物: '', 世界观: '', 关系图: '', 场景: '', 伏笔: '' };
    state.outlines = { 总纲: '', 分卷: '', 逐章细纲: '' };
    state.styleSample = '';

    // Load existing chapters from file system
    const chData = await api('/api/novel/chapters');
    if (chData.chapters && chData.chapters.length > 0) {
      state.volumes = [{ id: 'v1', name: '第一卷', chapters: [] }];
      state.chapterOrder = [];
      chData.chapters.forEach((ch, i) => {
        const id = 'c' + Date.now() + '_' + i;
        state.volumes[0].chapters.push({ id, name: ch.name, content: '', _file: ch.file });
        state.chapterOrder.push(id);
      });
    } else {
      state.volumes = [
        { id: 'v1', name: '第一卷', chapters: [
          { id: 'c1', name: '第一章', content: '' }
        ]}
      ];
      state.chapterOrder = ['c1'];
    }
    saveState();

    // Load existing settings and outlines from file system
    await loadNovelData(name);

    /* Load new novel's agent histories */
    loadAgentHistories();
    if (Object.keys(agentHistories).length === 0) {
      await loadChatHistoryFromBackup();
      saveAgentHistories();
    }

    currentChapterId = state.volumes[0].chapters[0]?.id || null;
    renderChapterTree();
    renderEditor();
    renderAgentContext();
    if (currentAgentId && agentHistories[currentAgentId]) switchAgentHistory(currentAgentId);
    renderSettingContent('人物');
    renderOutlineContent('总纲');
    updateStats();
    showToast(`已切换到「${name}」`);
  } else {
    showToast('切换失败');
  }
}

async function renameCurrentNovel() {
  const newName = await showModalPrompt('请输入新的小说名称', state.novelName);
  if (!newName || newName === state.novelName) return;
  const data = await api('/api/novel/rename', {
    method: 'POST',
    body: JSON.stringify({ old_name: state.novelName, new_name: newName })
  });
  if (data.ok) {
    state.novelName = newName;
    saveState();
    await loadNovels();
    showToast(`已重命名为「${newName}」`);
  } else {
    showToast('重命名失败，请检查名称是否已存在');
  }
}

async function createNewNovel() {
  const name = await showModalPrompt('请输入新小说名称', '');
  if (!name) return;
  const data = await api('/api/novel/create', {
    method: 'POST',
    body: JSON.stringify({ name })
  });
  if (data.ok) {
    await switchNovel(name);
    showToast(`已创建新小说「${name}」`);
  } else {
    showToast('创建失败，请检查名称是否已存在');
  }
}

async function deleteCurrentNovel() {
  if (!(await showModalConfirm(`确认删除小说「${state.novelName}」？\n\n该小说的设定库、大纲、文稿将被永久删除！\n此操作不可撤销！`))) return;
  const name = state.novelName;
  const data = await api('/api/novel/delete', {
    method: 'POST',
    body: JSON.stringify({ name })
  });
  if (data.ok) {
    // Switch to first remaining novel or reset
    const list = await api('/api/novels');
    if (list.novels && list.novels.length > 0) {
      await switchNovel(list.novels[0]);
    } else {
      state.novelName = '我的第一本小说';
      state.volumes = [{ id: 'v1', name: '第一卷', chapters: [{ id: 'c1', name: '第一章', content: '' }] }];
      state.chapterOrder = ['c1'];
      state.settings = { 人物: '', 世界观: '', 关系图: '', 场景: '', 伏笔: '' };
      state.outlines = { 总纲: '', 分卷: '', 逐章细纲: '' };
      state.styleSample = '';
      state.personCards = [];
      state.sceneCards = [];
      saveState();
      await loadNovels();
      currentChapterId = 'c1';
      renderChapterTree();
      renderEditor();
      renderAgentContext();
    }
    showToast(`已删除「${name}」`);
  } else {
    showToast('删除失败');
  }
}

async function addVolume() {
  const name = await showModalPrompt('请输入卷名', `第${state.volumes.length + 1}卷`);
  if (!name) return;
  const id = 'v' + Date.now();
  state.volumes.push({ id, name, chapters: [], _collapsed: false });
  saveState();
  renderChapterTree();
  showToast(`已新增「${name}」`);
}

/* ============ Agent Context ============ */
function renderAgentContext() {
  const ctx = document.getElementById('agent-context');
  if (!ctx) return;
  const ch = currentChapterId ? findChapter(currentChapterId) : null;
  ctx.innerHTML = `
    <div class="ctx-item"><span class="ctx-label">当前章节</span><span class="ctx-value">${ch ? escapeHtml(ch.name) : '未选择'}</span></div>
    <div class="ctx-item"><span class="ctx-label">本章字数</span><span class="ctx-value">${ch ? (ch.content || '').replace(/\s/g, '').length : 0}字</span></div>
    <div class="ctx-item"><span class="ctx-label">已存设定</span><span class="ctx-value">${countSettingItems()}项</span></div>
    <div class="ctx-item"><span class="ctx-label">大纲状态</span><span class="ctx-value">${countOutlineItems()}项</span></div>
  `;
}

function countSettingItems() {
  return Object.values(state.settings).filter(v => v.trim()).length;
}
function countOutlineItems() {
  return Object.values(state.outlines).filter(v => v.trim()).length;
}

function buildAgentContextPayload(agentId) {
  const ch = currentChapterId ? findChapter(currentChapterId) : null;
  let payload = `【当前信息】\n小说：${state.novelName}\n`;

  if (ch) {
    payload += `当前章节：${ch.name}\n`;
    const preview = (ch.content || '').slice(-800);
    payload += `前文（末尾800字）：\n${preview}\n`;
  }

  payload += `\n【设定】\n人物设定：${(state.settings?.人物 || '').slice(0, 500)}\n`;
  payload += `世界观：${(state.settings?.世界观 || '').slice(0, 300)}\n`;

  payload += `\n【大纲】\n总纲：${(state.outlines?.总纲 || '').slice(0, 300)}\n`;
  payload += `逐章细纲：${(state.outlines?.逐章细纲 || '').slice(0, 300)}\n`;

  payload += `\n【文风参考】\n${(state.styleSample || '未提供').slice(0, 500)}\n`;

  return payload;
}

/* ============ Agent Calls ============ */
async function loadAgentConfigs() {
  try {
    const r = await fetch(`${API_BASE}/api/agents`);
    const data = await r.json();
    return data.agents || [];
  } catch(e) {
    return [];
  }
}

function renderAgentButtons() {
  const toolbar = document.getElementById('agent-toolbar');
  if (!toolbar) return;
  toolbar.innerHTML = '';
  agentConfigs.forEach(agent => {
    const btn = document.createElement('button');
    btn.className = 'agent-btn';
    btn.dataset.id = agent.id;
    const colors = { '主控':'var(--red)', '基础设定':'var(--yellow)', '剧情架构':'var(--green)', '正文生成':'var(--orange)', '灵感创意':'var(--cyan)', '审核优化':'var(--purple)', '写作素材':'var(--accent2)' };
    const color = colors[agent.category] || 'var(--text3)';
    btn.innerHTML = `<span class="dot" style="background:${color}"></span> ${agent.icon} ${agent.short || agent.name}`;
    btn.title = agent.name + '：' + (agent.description || '');
    btn.addEventListener('click', () => {
      currentAgentId = agent.id;
      document.querySelectorAll('.agent-btn').forEach(b => b.style.borderColor = '');
      btn.style.borderColor = color;
      switchAgentHistory(agent.id);
      document.getElementById('agent-input').placeholder = `@${agent.short || agent.name} 输入指令...`;
      document.getElementById('agent-input').focus();
    });
    toolbar.appendChild(btn);
  });

  const infoBtns = document.getElementById('agent-info-btns');
  if (infoBtns) {
    const infoItems = [
      { icon:'📖', label:'当前设定', action: () => copyToAgentInput('当前设定如下：\n' + Object.entries(state.settings).filter(([k,v]) => v.trim()).map(([k,v]) => `${k}：${v.slice(0,100)}`).join('\n')) },
      { icon:'📋', label:'本章大纲', action: () => copyToAgentInput('本章大纲：\n' + (state.outlines?.逐章细纲 || '未填写').slice(0,500)) },
      { icon:'✒️', label:'文风参考', action: () => copyToAgentInput('文风参考：\n' + (state.styleSample || '未提供').slice(0,500)) },
      { icon:'📍', label:'伏笔清单', action: () => copyToAgentInput('伏笔清单：\n' + (state.settings?.伏笔 || '未填写').slice(0,500)) },
    ];
    infoBtns.innerHTML = infoItems.map(item => `
      <button class="agent-btn" style="font-size:10px;padding:2px 6px;" title="${item.label}">${item.icon} ${item.label}</button>
    `).join('');
    infoBtns.querySelectorAll('.agent-btn').forEach((btn, i) => {
      btn.addEventListener('click', infoItems[i].action);
    });
  }
}

function copyToAgentInput(text) {
  document.getElementById('agent-input').value = text;
  document.getElementById('agent-input').focus();
}

function switchAgentHistory(agentId) {
  const output = document.getElementById('agent-output');
  const agent = agentConfigs.find(a => a.id === agentId);
  if (!agent) return;

  const history = agentHistories[agentId];
  output.innerHTML = '';

  if (history && history.length > 0) {
    history.forEach(msg => {
      const div = document.createElement('div');
      div.className = 'agent-msg';
      if (msg.role === 'user') {
        div.style.borderLeftColor = 'var(--yellow)';
        div.innerHTML = `<div class="meta">🧑 我的提问 · ${msg.time || ''}</div><div class="body">${escapeHtml(msg.content)}</div>`;
      } else {
        const colors = { '主控':'var(--red)', '基础设定':'var(--yellow)', '剧情架构':'var(--green)', '正文生成':'var(--orange)', '灵感创意':'var(--cyan)', '审核优化':'var(--purple)', '写作素材':'var(--accent2)' };
        div.style.borderLeftColor = colors[agent.category] || 'var(--accent)';
        div.innerHTML = `
          <div class="meta">${agent.icon || '🤖'} ${agent.name} · ${msg.time || ''}</div>
          <div class="body">${escapeHtml(msg.content)}</div>
          <button class="copy-btn" onclick="copyAgentText(this)">📋 复制片段</button>
        `;
      }
      output.appendChild(div);
    });
    output.scrollTop = output.scrollHeight;
  } else {
    output.innerHTML = `<div style="text-align:center;color:var(--text3);font-size:12px;margin-top:40px;">
      🤖 与 ${agent.icon} ${agent.name} 的对话<br>
      <span style="font-size:11px;color:var(--text3);">输入指令开始对话</span>
    </div>`;
  }
}

async function handleAgentSend() {
  const input = document.getElementById('agent-input');
  let text = input.value.trim();

  if (!text || !currentAgentId) {
    showToast('请先选择 Agent 并输入指令');
    return;
  }

  input.value = '';

  const agent = agentConfigs.find(a => a.id === currentAgentId);
  if (!agent) return;

  const atMatch = text.match(/^@(\S+)\s*/);
  if (atMatch) {
    text = text.replace(/^@\S+\s*/, '');
  }
  if (!text) {
    showToast('请输入指令内容');
    return;
  }

  if (!agentHistories[currentAgentId]) agentHistories[currentAgentId] = [];
  agentHistories[currentAgentId].push({ role: 'user', content: text, time: new Date().toLocaleTimeString() });

  switchAgentHistory(currentAgentId);
  addAgentThinking();

  let contextPayload;
  try {
    contextPayload = buildAgentContextPayload(currentAgentId);
  } catch(e) {
    removeAgentThinking();
    if (!agentHistories[currentAgentId]) agentHistories[currentAgentId] = [];
    agentHistories[currentAgentId].push({ role: 'error', content: '上下文构建错误：' + e.message, time: new Date().toLocaleTimeString() });
    switchAgentHistory(currentAgentId);
    persistAgentHistory();
    return;
  }

  let timeoutId = setTimeout(async () => {
    removeAgentThinking();
    if (!agentHistories[currentAgentId]) agentHistories[currentAgentId] = [];
    agentHistories[currentAgentId].push({ role: 'error', content: '⏱ 请求超时（30s），请检查 DeepSeek API 配置或网络连接', time: new Date().toLocaleTimeString() });
    switchAgentHistory(currentAgentId);
    await persistAgentHistory();
    showToast('⏱ 请求超时，请检查 API 配置或网络');
  }, 30000);

  try {
    const r = await fetch(`${API_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_id: currentAgentId,
        message: text + '\n\n' + contextPayload
      })
    });
    clearTimeout(timeoutId);
    const data = await r.json();
    removeAgentThinking();
    if (data.response) {
      if (!agentHistories[currentAgentId]) agentHistories[currentAgentId] = [];
      agentHistories[currentAgentId].push({ role: 'agent', content: data.response, time: new Date().toLocaleTimeString() });
      switchAgentHistory(currentAgentId);
      await persistAgentHistory();
    } else {
      if (!agentHistories[currentAgentId]) agentHistories[currentAgentId] = [];
      agentHistories[currentAgentId].push({ role: 'error', content: data.error || 'API 调用失败', time: new Date().toLocaleTimeString() });
      switchAgentHistory(currentAgentId);
      await persistAgentHistory();
    }
  } catch(e) {
    clearTimeout(timeoutId);
    removeAgentThinking();
    if (!agentHistories[currentAgentId]) agentHistories[currentAgentId] = [];
    agentHistories[currentAgentId].push({ role: 'error', content: '网络错误：' + e.message, time: new Date().toLocaleTimeString() });
    switchAgentHistory(currentAgentId);
    await persistAgentHistory();
  }
}

async function persistAgentHistory() {
  trimAgentHistories();
  saveAgentHistories();
  try { await backupChatHistory(); } catch(e) {}
}

async function dailyBackup() {
  showToast('📦 正在备份...');
  try {
    /* 1. Save all current data first */
    saveCurrentContent();
    const activeSetting = document.querySelector('.setting-tab.active');
    if (activeSetting) saveSetting(activeSetting.dataset.panel);
    const activeOutline = document.querySelector('.outline-tab.active');
    if (activeOutline) saveOutline(activeOutline.dataset.panel);

    /* 2. Save latest chat backup */
    await persistAgentHistory();

    /* 3. Trigger file-system backup */
    const data = await api('/api/novel/backup/today', {
      method: 'POST',
      body: JSON.stringify({ novel: state.novelName })
    });
    if (data.ok) {
      showToast(`✅ 每日备份完成 → ${state.novelName}/备份/`);
    } else {
      showToast('❌ 备份失败');
    }
  } catch(e) {
    showToast('❌ 备份出错：' + e.message);
  }
}

async function gitBackup() {
  showToast('⬆ 正在提交到 Git...');
  try {
    /* Save everything first */
    saveCurrentContent();
    const activeSetting = document.querySelector('.setting-tab.active');
    if (activeSetting) saveSetting(activeSetting.dataset.panel);
    const activeOutline = document.querySelector('.outline-tab.active');
    if (activeOutline) saveOutline(activeOutline.dataset.panel);
    await persistAgentHistory();

    const data = await api('/api/novel/backup/git', {
      method: 'POST',
      body: JSON.stringify({})
    });
    if (data.ok) {
      showToast(`✅ Git 备份完成`);
      if (data.push_error) {
        showModalConfirm(`✅ 提交成功！\n\n提交信息：${data.commit}\n\n⚠️ 推送时出现问题：\n${data.push_error}\n\n请检查 Git 远程仓库配置。`);
      } else {
        showModalConfirm(`✅ Git 备份成功！\n\n提交信息：${data.commit}\n\n已推送到远程仓库（Gitee）`);
      }
    } else {
      showToast('❌ Git 备份失败');
      showModalConfirm(`❌ Git 备份失败\n\n${data.error || '未知错误'}`);
    }
  } catch(e) {
    showToast('❌ Git 备份出错：' + e.message);
  }
}

function addAgentThinking() {
  removeAgentThinking();
  const output = document.getElementById('agent-output');
  const div = document.createElement('div');
  div.id = 'agent-thinking';
  div.className = 'agent-thinking';
  div.innerHTML = `<span>🤔 思考中</span><div class="dots"><span></span><span></span><span></span></div>`;
  output.appendChild(div);
  output.scrollTop = output.scrollHeight;
}

function removeAgentThinking() {
  const el = document.getElementById('agent-thinking');
  if (el) el.remove();
}

function copyAgentText(btn) {
  const body = btn.previousElementSibling;
  if (body) {
    navigator.clipboard.writeText(body.textContent).then(() => {
      btn.textContent = '✅ 已复制';
      setTimeout(() => { btn.textContent = '📋 复制片段'; }, 1500);
    });
  }
}

/* ============ Utility ============ */
function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function showToast(msg) {
  const el = document.getElementById('toast') || (() => {
    const t = document.createElement('div');
    t.id = 'toast';
    document.body.appendChild(t);
    return t;
  })();
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._hide);
  el._hide = setTimeout(() => el.classList.remove('show'), 2000);
}

function showModalPrompt(title, defaultValue) {
  return new Promise(resolve => {
    const modal = document.getElementById('custom-modal');
    const titleEl = document.getElementById('modal-title');
    const bodyEl = document.getElementById('modal-body');
    const inputEl = document.getElementById('modal-input');
    const okBtn = document.getElementById('modal-ok');
    const cancelBtn = document.getElementById('modal-cancel');
    if (!modal) { resolve(null); return; }

    titleEl.textContent = title || '';
    bodyEl.textContent = '';
    bodyEl.style.display = 'none';
    inputEl.style.display = 'block';
    inputEl.value = defaultValue || '';
    inputEl.focus();
    inputEl.select();
    modal.style.display = 'flex';

    function cleanup(val) {
      modal.style.display = 'none';
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      resolve(val);
    }
    function onOk() { cleanup(inputEl.value); }
    function onCancel() { cleanup(null); }
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    inputEl.addEventListener('keydown', e => {
      if (e.key === 'Enter') onOk();
      if (e.key === 'Escape') onCancel();
    });
  });
}

function showModalConfirm(message) {
  return new Promise(resolve => {
    const modal = document.getElementById('custom-modal');
    const titleEl = document.getElementById('modal-title');
    const bodyEl = document.getElementById('modal-body');
    const inputEl = document.getElementById('modal-input');
    const okBtn = document.getElementById('modal-ok');
    const cancelBtn = document.getElementById('modal-cancel');
    if (!modal) { resolve(false); return; }

    titleEl.textContent = '确认操作';
    bodyEl.textContent = message;
    bodyEl.style.display = 'block';
    inputEl.style.display = 'none';
    modal.style.display = 'flex';

    function cleanup(val) {
      modal.style.display = 'none';
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      resolve(val);
    }
    function onOk() { cleanup(true); }
    function onCancel() { cleanup(false); }
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    document.addEventListener('keydown', function escHandler(e) {
      if (e.key === 'Escape') { document.removeEventListener('keydown', escHandler); cleanup(false); }
    });
  });
}

function showTrashDialog() {
  return new Promise(resolve => {
    const modal = document.getElementById('custom-modal');
    const titleEl = document.getElementById('modal-title');
    const bodyEl = document.getElementById('modal-body');
    const inputEl = document.getElementById('modal-input');
    const okBtn = document.getElementById('modal-ok');
    const cancelBtn = document.getElementById('modal-cancel');
    if (!modal) { resolve(null); return; }

    const recent = state.trash.slice().reverse();
    titleEl.textContent = '🗑 回收站';
    bodyEl.style.display = 'block';
    inputEl.style.display = 'none';

    let html = `<div style="font-size:12px;color:var(--text3);margin-bottom:8px;">共 ${recent.length} 个已删除章节，点选后选择恢复方式：</div>`;
    html += `<div style="max-height:300px;overflow-y:auto;margin-bottom:10px;">`;
    recent.forEach((ch, i) => {
      const preview = (ch.content || '').slice(0, 60).replace(/\n/g, ' ');
      html += `
        <label style="display:flex;align-items:flex-start;gap:8px;padding:8px 6px;border-radius:4px;cursor:pointer;transition:.15s;border:1px solid transparent;margin-bottom:2px;" class="trash-item" data-idx="${i}">
          <input type="radio" name="trash-select" value="${i}" style="margin-top:2px;">
          <div style="flex:1;min-width:0;">
            <div style="font-weight:600;color:var(--text);font-size:13px;">${escapeHtml(ch.name)}</div>
            <div style="font-size:10px;color:var(--text3);margin-top:2px;">🗑 ${new Date(ch.deletedAt).toLocaleString()}</div>
            <div style="font-size:11px;color:var(--text3);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(preview) || '（空章节）'}</div>
          </div>
        </label>`;
    });
    html += `</div>`;
    html += `<div id="trash-actions" style="display:none;gap:6px;justify-content:flex-end;border-top:1px solid var(--border);padding-top:10px;margin-top:4px;">
      <span style="font-size:11px;color:var(--text2);flex:1;align-self:center;">恢复方式：</span>
      <button id="trash-overwrite" style="font-size:11px;padding:5px 14px;border-radius:4px;border:1px solid var(--accent);background:var(--accent);color:#fff;cursor:pointer;">📝 覆盖恢复</button>
      <button id="trash-addnew" style="font-size:11px;padding:5px 14px;border-radius:4px;border:1px solid var(--border);background:var(--bg3);color:var(--text2);cursor:pointer;">➕ 新增恢复</button>
    </div>`;
    bodyEl.innerHTML = html;

    let selectedCh = null;
    bodyEl.querySelectorAll('.trash-item').forEach(label => {
      label.addEventListener('click', () => {
        bodyEl.querySelectorAll('.trash-item').forEach(l => l.style.borderColor = 'transparent');
        label.style.borderColor = 'var(--accent)';
        label.querySelector('input').checked = true;
        selectedCh = recent[parseInt(label.dataset.idx)];
        document.getElementById('trash-actions').style.display = 'flex';
      });
    });

    modal.style.display = 'flex';

    function cleanup(val) {
      modal.style.display = 'none';
      okBtn.style.display = '';
      cancelBtn.textContent = '取消';
      resolve(val);
    }

    okBtn.style.display = 'none';
    cancelBtn.textContent = '关闭';
    cancelBtn.onclick = () => cleanup(null);

    const overwriteBtn = document.getElementById('trash-overwrite');
    const addnewBtn = document.getElementById('trash-addnew');
    if (overwriteBtn) overwriteBtn.onclick = () => { if (selectedCh) cleanup({ ch: selectedCh, mode: 'overwrite' }); };
    if (addnewBtn) addnewBtn.onclick = () => { if (selectedCh) cleanup({ ch: selectedCh, mode: 'addnew' }); };

    const escHandler = e => { if (e.key === 'Escape') { document.removeEventListener('keydown', escHandler); cleanup(null); } };
    document.addEventListener('keydown', escHandler);
  });
}

/* ============ Word Bank ============ */
let wbLoading = false;

async function refreshWordBank() {
  if (wbLoading) return;
  wbLoading = true;
  const container = document.getElementById('wordbank-content');
  if (!container) return;
  container.innerHTML = '<div class="wb-loading">⏳ 正在生成词汇...</div>';

  const style = document.getElementById('wb-style')?.value || 'auto';
  const customQuery = document.getElementById('wb-query')?.value?.trim() || '';

  // Build context from current state
  const ch = currentChapterId ? findChapter(currentChapterId) : null;
  let context = '';
  context += `小说名称：${state.novelName}\n\n`;

  // Person cards (concise)
  const persons = state.personCards || [];
  if (persons.length > 0) {
    context += `【人物设定】\n`;
    persons.forEach(p => {
      context += `- ${p.姓名 || '未知'}：${(p.简介 || '').slice(0, 200)}\n`;
    });
    context += '\n';
  }

  // Settings (world, scenes)
  if (state.settings?.世界观) context += `【世界观】\n${state.settings.世界观.slice(0, 500)}\n\n`;
  if (state.settings?.场景) context += `【场景设定】\n${state.settings.场景.slice(0, 500)}\n\n`;

  // Current chapter (last 800 chars for context)
  if (ch) {
    const preview = (ch.content || '').slice(-800);
    context += `【当前前文】\n${preview}\n\n`;
  }

  // Style sample
  if (state.styleSample) {
    context += `【文风参考】\n${state.styleSample.slice(0, 300)}\n`;
  }

  // Custom query
  if (customQuery) {
    context += `【用户特殊需求】\n${customQuery}\n\n`;
  }

  try {
    const res = await api('/api/novel/word-bank', {
      method: 'POST',
      body: JSON.stringify({ style, context })
    });
    if (res.error) {
      container.innerHTML = `<div class="wb-error">❌ ${escapeHtml(res.error)}</div>`;
    } else if (res.response) {
      renderWordBankResult(res.response);
    } else {
      container.innerHTML = '<div class="wb-error">❌ 返回为空，请重试</div>';
    }
  } catch(e) {
    container.innerHTML = `<div class="wb-error">❌ 请求失败：${escapeHtml(e.message || '网络错误')}</div>`;
  }
  wbLoading = false;
}

function renderWordBankResult(text) {
  const container = document.getElementById('wordbank-content');
  if (!container) return;

  // Try to parse structured format
  const sections = [];
  const sectionRegex = /【(.+?)】/g;
  const subsectionRegex = /-\s*\*\*(.+?)\*\*[：:]\s*(.+)/g;

  let lastSection = null;
  const lines = text.split('\n');

  // Build HTML - parse markdown-like structure into clickable chips
  let html = '<div class="wb-raw">';
  let inSection = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) { html += '\n'; continue; }

    // Section header like 【男性角色用词】
    const sectionMatch = trimmed.match(/^【(.+?)】/);
    if (sectionMatch) {
      html += `<div class="section-title">${escapeHtml(sectionMatch[0])}</div>`;
      inSection = true;
      continue;
    }

    // Subsection like - **外貌**：xxx, xxx, xxx
    const subMatch = trimmed.match(/^-\s*\*\*(.+?)\*\*[：:]\s*(.+)/);
    if (subMatch) {
      const label = escapeHtml(subMatch[1]);
      const wordsRaw = subMatch[2];
      const words = wordsRaw.split(/[,，、\/]/).map(w => w.trim()).filter(Boolean);
      html += `<div class="subsection-title">${label}</div><div class="wb-subsection">`;
      words.forEach(w => {
        const clean = escapeHtml(w.replace(/[*❖✦◆]/g, '').trim());
        if (clean) {
          html += `<span class="wb-word" onclick="copyWord(this)" title="点击复制">${clean}</span>`;
        }
      });
      html += '</div>';
      continue;
    }

    // Fallback: just display as text
    html += escapeHtml(trimmed) + '<br>';
  }

  html += '</div>';
  html += '<div class="wb-tip">💡 点击词汇即可复制</div>';
  container.innerHTML = html;
}

function copyWord(el) {
  const text = el.textContent.trim();
  navigator.clipboard.writeText(text).then(() => {
    el.classList.add('copied');
    el.textContent = '✅ 已复制';
    setTimeout(() => {
      el.textContent = text;
      el.classList.remove('copied');
    }, 800);
  }).catch(() => {
    // Fallback
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    el.classList.add('copied');
    setTimeout(() => el.classList.remove('copied'), 800);
  });
}

/* ============ Init ============ */
async function init() {
  try {
  initLayout();

  agentConfigs = await loadAgentConfigs();
  if (agentConfigs.length === 0) {
    /* Fallback embedded configs */
    agentConfigs = [
      { id:'main-writer', name:'网文主笔·总控', short:'主笔', icon:'🎯', category:'主控', description:'节奏监控·大纲匹配·钩子评估' },
      { id:'setting-manager', name:'设定管家·书库', short:'设定', icon:'📚', category:'基础设定', description:'设定速查·一致性校验·伏笔追踪' },
      { id:'style-feeder', name:'书风认知·投喂专员', short:'文风', icon:'✒️', category:'基础设定', description:'文风记忆·仿写·句式匹配' },
      { id:'plot-analyzer', name:'爆款解构·剧情分析师', short:'剧情', icon:'🔍', category:'剧情架构', description:'爽点分析·节奏优化·钩子强化' },
      { id:'outline-architect', name:'大纲架构师·章纲', short:'大纲', icon:'🏗️', category:'剧情架构', description:'细纲生成·顺序调整·高潮设计' },
      { id:'content-writer', name:'正文写手·去AI', short:'写手', icon:'✍️', category:'正文生成', description:'场景扩写·过渡段·心理描写' },
      { id:'inspiration-engine', name:'灵感引擎·爽点', short:'灵感', icon:'💡', category:'灵感创意', description:'卡文灵感·反转·冲突·打脸' },
      { id:'editor-polisher', name:'金牌责编·润色', short:'责编', icon:'🔖', category:'审核优化', description:'去AI味·精简·质感提升' },
    ];
  }
  renderAgentButtons();

  /* Load per-novel agent chat histories */
  loadAgentHistories();
  if (Object.keys(agentHistories).length === 0) {
    await loadChatHistoryFromBackup();
    saveAgentHistories();
  }

  /* Load novels list */
  await loadNovels();

  /* Load settings and outlines from file system */
  await loadNovelData(state.novelName);

  /* Set first chapter */
  currentChapterId = state.volumes[0]?.chapters[0]?.id || null;

  renderChapterTree();
  renderEditor();
  renderAgentContext();
  renderSettingContent('人物');
  renderOutlineContent('总纲');

  /* Editor auto-save */
  document.getElementById('editor-textarea')?.addEventListener('input', autoSaveEditor);

  /* Agent send */
  document.getElementById('agent-send')?.addEventListener('click', handleAgentSend);
  document.getElementById('agent-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleAgentSend();
    }
  });

  /* Word Bank refresh */
  document.querySelectorAll('.refresh-wb-btn').forEach(btn => {
    btn.addEventListener('click', refreshWordBank);
  });
  document.getElementById('wb-style')?.addEventListener('change', refreshWordBank);

  /* Top bar: new chapter, new volume, history, style editor, save all, novel switch */
  document.getElementById('btn-new-chapter')?.addEventListener('click', () => {
    if (state.volumes.length > 0) addChapter(state.volumes[0].id);
  });
  document.getElementById('btn-new-volume')?.addEventListener('click', addVolume);
  document.getElementById('btn-history')?.addEventListener('click', showVersionHistory);
  document.getElementById('btn-style')?.addEventListener('click', async () => {
    const val = await showModalPrompt('粘贴你的文风示例（一段你写的代表性文字）', state.styleSample);
    if (val !== null) { state.styleSample = val; saveState(); showToast('文风示例已保存'); }
  });
  document.getElementById('btn-save-all')?.addEventListener('click', () => {
    saveCurrentContent();
    const activeSetting = document.querySelector('.setting-tab.active');
    if (activeSetting) saveSetting(activeSetting.dataset.panel);
    const activeOutline = document.querySelector('.outline-tab.active');
    if (activeOutline) saveOutline(activeOutline.dataset.panel);
    showToast('全部已保存');
  });
  document.getElementById('novel-select')?.addEventListener('change', async e => {
    const name = e.target.value;
    if (name && name !== state.novelName) {
      await switchNovel(name);
    }
  });
  document.getElementById('btn-rename-novel')?.addEventListener('click', renameCurrentNovel);
  document.getElementById('btn-new-novel')?.addEventListener('click', createNewNovel);
  document.getElementById('btn-delete-novel')?.addEventListener('click', deleteCurrentNovel);

  /* Add chapter buttons in tree */
  document.addEventListener('click', e => {
    if (e.target.classList.contains('add-chapter')) {
      addChapter(e.target.dataset.vid);
    }
  });

  /* Chapter rename: double-click on name */
  document.addEventListener('dblclick', async e => {
    const item = e.target.closest('.chapter-item');
    if (!item) return;
    const nameEl = item.querySelector('.name');
    if (!nameEl || !nameEl.contains(e.target)) return;
    const oldName = nameEl.textContent;
    const newName = await showModalPrompt('重命名章节', oldName);
    if (newName && newName !== oldName) {
      renameChapter(item.dataset.id, newName);
    }
  });

  /* Setting save buttons */
  document.querySelectorAll('.setting-content .save-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.closest('.setting-content');
      if (tab) {
        const activeTab = document.querySelector('.setting-tab.active');
        if (activeTab) saveSetting(activeTab.dataset.panel);
      }
    });
  });

  /* Outline save buttons */
  document.querySelectorAll('.outline-content .save-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const activeTab = document.querySelector('.outline-tab.active');
      if (activeTab) saveOutline(activeTab.dataset.panel);
    });
  });

  /* Recover from trash */
  document.getElementById('btn-trash').addEventListener('click', async () => {
    if (state.trash.length === 0) { showToast('回收站为空'); return; }
    const result = await showTrashDialog();
    if (!result) return;
    const { ch, mode } = result;
    if (mode === 'overwrite') {
      const vol = state.volumes[0];
      const existing = vol.chapters.find(c => c.name === ch.name);
      if (existing) {
        existing.content = ch.content || '';
      } else {
        vol.chapters.push({ id: ch.id, name: ch.name, content: ch.content || '' });
      }
    } else {
      state.volumes[0].chapters.push({ id: 'c' + Date.now(), name: ch.name + '(恢复)', content: ch.content || '' });
    }
    state.trash = state.trash.filter(t => t.id !== ch.id);
    saveState();
    renderChapterTree();
    showToast(`已恢复「${ch.name}」`);
  });

  /* Word Bank: Enter and button triggers refresh */
  document.getElementById('wb-query')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') refreshWordBank();
  });
  document.getElementById('wb-query-btn')?.addEventListener('click', () => {
    refreshWordBank();
  });

  /* Reset layout button */
  document.getElementById('btn-reset-layout')?.addEventListener('click', resetLayout);

  /* Daily backup button */
  document.getElementById('btn-backup')?.addEventListener('click', dailyBackup);

  /* Git backup button */
  document.getElementById('btn-git-backup')?.addEventListener('click', gitBackup);

  /* Restore saved layout */
  restoreLayout();

  saveState();
  updateStats();
  } catch(e) {
    console.error('init error:', e);
    showToast('初始化出错，请刷新重试');
    /* Still try to register button handlers */
    document.getElementById('btn-new-volume')?.addEventListener('click', addVolume);
    document.getElementById('btn-rename-novel')?.addEventListener('click', renameCurrentNovel);
    document.getElementById('btn-new-novel')?.addEventListener('click', createNewNovel);
    document.getElementById('btn-delete-novel')?.addEventListener('click', deleteCurrentNovel);
  }
}

function saveLayout() {
  const editor = document.getElementById('panel-editor');
  const agents = document.getElementById('panel-agents');
  const layout = {};
  if (editor) layout.editorW = editor.style.flex ? editor.style.flex.replace(/.*\s+/, '') : editor.offsetWidth + 'px';
  if (agents) layout.agentsW = agents.style.flex ? agents.style.flex.replace(/.*\s+/, '') : agents.offsetWidth + 'px';
  try { localStorage.setItem('novel_layout', JSON.stringify(layout)); } catch(e) {}
}

function restoreLayout() {
  try {
    const saved = localStorage.getItem('novel_layout');
    if (!saved) {
      saveLayout();
      return;
    }
    const layout = JSON.parse(saved);
    const editor = document.getElementById('panel-editor');
    const agents = document.getElementById('panel-agents');
    if (layout.editorW && editor) editor.style.flex = '0 0 ' + layout.editorW;
    if (layout.agentsW && agents) agents.style.flex = '0 0 ' + layout.agentsW;
  } catch(e) {
    saveLayout();
  }
}

function resetLayout() {
  try { localStorage.removeItem('novel_layout'); } catch(e) {}
  location.reload();
}

document.addEventListener('DOMContentLoaded', init);
