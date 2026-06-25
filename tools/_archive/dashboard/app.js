const API = '/api';
let agents = [];
let dashboardData = null;
let callHistory = [];
let currentTarget = null;

const AGENT_MAP = {
  'main-writer':       { short: '主笔', cat: '主控', color: 'red' },
  'setting-manager':   { short: '设定', cat: '基础设定', color: 'yellow' },
  'style-feeder':      { short: '文风', cat: '基础设定', color: 'yellow' },
  'outline-architect': { short: '大纲', cat: '剧情架构', color: 'green' },
  'plot-analyzer':     { short: '剧情', cat: '剧情架构', color: 'green' },
  'content-writer':    { short: '写手', cat: '正文生成', color: 'orange' },
  'inspiration-engine':{ short: '灵感', cat: '灵感创意', color: 'cyan' },
  'editor-polisher':   { short: '责编', cat: '审核优化', color: 'purple' },
};

const STAT_COLORS = ['red','yellow','green','orange','cyan','purple'];

async function api(path, opts = {}) {
  try {
    const r = await fetch(API + path, {
      headers: { 'Content-Type': 'application/json' },
      ...opts,
    });
    return await r.json();
  } catch (e) {
    return { error: e.message };
  }
}

/* ============ Init ============ */
async function init() {
  setupListeners();
  await loadAll();
  setInterval(autoSave, 30000);
}

async function loadAll() {
  await Promise.all([loadAgents(), loadDashboard(), loadNovels(), loadBoard(), loadWsList()]);
  renderStatusTable();
  renderMindmapNodes();
  updateLastSaved();
}

async function loadAgents() {
  const data = await api('/agents');
  agents = data.agents || [];
}

async function loadDashboard() {
  const data = await api('/dashboard/load');
  dashboardData = data;
}

async function loadNovels() {
  const data = await api('/novels');
  const el = document.getElementById('headerNovel');
  if (el) el.textContent = data.current || '未选择';
}

function saveDashboard() {
  api('/dashboard/save', {
    method: 'POST',
    body: JSON.stringify(dashboardData),
  });
  updateLastSaved();
}

function autoSave() {
  saveDashboard();
}

function updateLastSaved() {
  const el = document.getElementById('lastSaved');
  if (el) el.textContent = '已保存 ' + new Date().toLocaleTimeString();
}

/* ============ Mindmap Nodes ============ */
function renderMindmapNodes() {
  document.querySelectorAll('.status-badge').forEach(badge => {
    const id = badge.dataset.id;
    const state = dashboardData?.agents?.[id];
    if (!state) return;
    badge.textContent = state.status || '空闲';
    badge.className = 'mt-1 status-badge ' + (state.status !== '空闲' && state.status !== '' ? 'working' : 'idle');
  });
  document.querySelectorAll('.agent-node').forEach(node => {
    node.classList.remove('active');
    if (node.dataset.id === currentTarget) node.classList.add('active');
  });
}

/* ============ Status Table ============ */
function renderStatusTable() {
  const tbody = document.getElementById('statusTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  const order = ['main-writer','setting-manager','style-feeder','outline-architect','plot-analyzer','content-writer','inspiration-engine','editor-polisher'];
  const catMap = {};
  agents.forEach(a => { catMap[a.id] = a.category; });

  order.forEach(id => {
    const state = dashboardData?.agents?.[id];
    if (!state) return;
    const info = AGENT_MAP[id] || {};
    const cat = catMap[id] || info.cat || '—';
    const catColors = { '主控':'red','基础设定':'yellow','剧情架构':'green','正文生成':'orange','灵感创意':'cyan','审核优化':'purple' };
    const cc = catColors[cat] || 'gray';
    const statusOptions = ['空闲', '工作中', '等待中', '已完成', '卡文中'];

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="font-medium text-sm">
        <span class="w-2 h-2 inline-block rounded-full mr-1.5" style="background:var(--${cc})"></span>
        ${state.name}
      </td>
      <td class="text-dark-300 text-xs">${cat}</td>
      <td>
        <select class="inline-edit status-select text-xs" data-id="${id}" data-field="status">
          ${statusOptions.map(s => `<option value="${s}" ${s === state.status ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
      </td>
      <td><input class="inline-edit" type="text" value="${escapeAttr(state.task || '')}" data-id="${id}" data-field="task" placeholder="输入当前任务..."></td>
      <td>
        <div class="flex items-center gap-2">
          <progress class="progress-bar flex-1" value="${state.progress || 0}" max="100" data-id="${id}" data-field="progress"></progress>
          <span class="text-[10px] text-dark-300 w-8 text-right progress-label">${state.progress || 0}%</span>
        </div>
        <input class="inline-edit text-[10px] mt-1" type="range" min="0" max="100" value="${state.progress || 0}" data-id="${id}" data-field="progress-range">
      </td>
      <td><input class="inline-edit" type="text" value="${escapeAttr(state.notes || '')}" data-id="${id}" data-field="notes" placeholder="备注..."></td>
      <td class="text-center">
        <button class="text-[10px] px-2 py-1 rounded bg-agent-${info.color || 'purple'}/20 text-agent-${info.color || 'purple'} border border-agent-${info.color || 'purple'}/30 hover:bg-agent-${info.color || 'purple'}/30 call-btn" data-id="${id}">@调用</button>
      </td>
    `;
    tbody.appendChild(tr);

    // Bind inline edit events
    tr.querySelectorAll('.inline-edit').forEach(el => {
      el.addEventListener('change', () => handleEdit(id, el.dataset.field, el.value));
      el.addEventListener('input', () => {
        if (el.tagName === 'INPUT' && el.type === 'range') {
          const progress = parseInt(el.value);
          const state = dashboardData?.agents?.[id];
          if (state) state.progress = progress;
          const row = el.closest('tr');
          row.querySelector('progress')?.setAttribute('value', progress);
          row.querySelector('.progress-label').textContent = progress + '%';
        }
      });
      // blur saves
      if (el.tagName === 'INPUT' && el.type === 'text') {
        el.addEventListener('blur', () => handleEdit(id, el.dataset.field, el.value));
      }
    });
    // range blur also saves
    tr.querySelectorAll('input[type="range"]').forEach(el => {
      el.addEventListener('change', () => {
        handleEdit(id, 'progress', parseInt(el.value));
      });
    });
    // call buttons
    tr.querySelector('.call-btn')?.addEventListener('click', () => {
      document.querySelectorAll('.agent-node').forEach(n => n.classList.remove('active'));
      const node = document.querySelector(`.agent-node[data-id="${id}"]`);
      if (node) node.classList.add('active');
      currentTarget = id;
      document.getElementById('atInput').value = `@${AGENT_MAP[id]?.short || id} `;
      document.getElementById('atInput').focus();
    });
  });
}

function handleEdit(id, field, value) {
  if (!dashboardData?.agents?.[id]) return;
  if (field === 'progress-range') return; // handled by range change
  if (field === 'progress') {
    dashboardData.agents[id].progress = parseInt(value) || 0;
  } else {
    dashboardData.agents[id][field] = value;
  }
  renderMindmapNodes();
}

/* ============ @ Call ============ */
async function handleAtCall() {
  const input = document.getElementById('atInput');
  let text = input.value.trim();
  if (!text) return;

  let targetId = currentTarget;
  const atMatch = text.match(/^@(\S+)\s*/);
  if (atMatch) {
    const short = atMatch[1];
    for (const [id, info] of Object.entries(AGENT_MAP)) {
      if (info.short === short || id.startsWith(short)) {
        targetId = id;
        break;
      }
    }
    text = text.replace(/^@\S+\s*/, '');
  }

  if (!targetId || !text) {
    input.placeholder = '请先选择 Agent 或输入 @简称 + 指令';
    input.value = '';
    setTimeout(() => input.placeholder = '@Agent 输入指令...', 2000);
    return;
  }

  const agent = agents.find(a => a.id === targetId);
  if (!agent) return;

  // Set status to working
  if (dashboardData?.agents?.[targetId]) {
    dashboardData.agents[targetId].status = '工作中';
    dashboardData.agents[targetId].task = text;
    renderStatusTable();
    renderMindmapNodes();
  }

  // Add to chat log
  addChatEntry('user', targetId, text);
  addThinkingEntry(targetId);

  // Call API
  const res = await api('/chat', {
    method: 'POST',
    body: JSON.stringify({ agent_id: targetId, message: text }),
  });

  removeThinkingEntry();

  if (res.response) {
    addChatEntry('agent', targetId, res.response);
    // Auto-update status
    if (dashboardData?.agents?.[targetId]) {
      dashboardData.agents[targetId].status = '已完成';
      renderStatusTable();
      renderMindmapNodes();
    }
    // Switch to chat tab
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelector('[data-tab="chat"]')?.classList.add('active');
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.getElementById('tab-chat')?.classList.add('active');
  } else {
    addChatEntry('agent', targetId, `[错误] ${res.error || '调用失败'}`);
    if (dashboardData?.agents?.[targetId]) {
      dashboardData.agents[targetId].status = '卡文中';
      renderStatusTable();
      renderMindmapNodes();
    }
  }

  input.value = '';
  saveDashboard();
}

function addChatEntry(role, agentId, content) {
  const log = document.getElementById('chatLog');
  const agent = agents.find(a => a.id === agentId);
  const info = AGENT_MAP[agentId] || {};
  const cc = info.color || 'purple';

  const div = document.createElement('div');
  div.className = 'chat-msg';

  if (role === 'user') {
    div.innerHTML = `<div class="flex justify-end mb-2"><div class="bg-agent-${cc}/20 border border-agent-${cc}/30 rounded-lg px-3 py-2 text-sm max-w-[70%]">${escapeHtml(content)}</div></div>`;
  } else {
    const name = agent?.name || agentId;
    div.innerHTML = `
      <div class="flex gap-2 mb-2">
        <span class="text-lg shrink-0">${info.cat === '主控' ? '🎯' : info.cat === '基础设定' ? '📚' : info.cat === '剧情架构' ? '🏗️' : info.cat === '正文生成' ? '✍️' : info.cat === '灵感创意' ? '💡' : '🔍'}</span>
        <div>
          <div class="text-[10px] text-dark-300 mb-1">${name}</div>
          <div class="bg-dark-700 border border-dark-500 rounded-lg px-3 py-2 text-sm leading-relaxed max-w-[80%] whitespace-pre-wrap">${escapeHtml(content)}</div>
        </div>
      </div>`;
  }
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

function addThinkingEntry(agentId) {
  const log = document.getElementById('chatLog');
  const div = document.createElement('div');
  div.id = 'thinkingEntry';
  div.className = 'chat-msg';
  div.innerHTML = `<div class="flex items-center gap-2 text-dark-300 text-sm ml-8"><span class="animate-pulse">思考中</span><span class="flex gap-0.5"><span class="w-1.5 h-1.5 rounded-full bg-agent-cyan animate-bounce" style="animation-delay:0s"></span><span class="w-1.5 h-1.5 rounded-full bg-agent-cyan animate-bounce" style="animation-delay:.15s"></span><span class="w-1.5 h-1.5 rounded-full bg-agent-cyan animate-bounce" style="animation-delay:.3s"></span></span></div>`;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

function removeThinkingEntry() {
  const el = document.getElementById('thinkingEntry');
  if (el) el.remove();
}

/* ============ Board ============ */
async function loadBoard() {
  const data = await api('/board');
  const el = document.getElementById('boardContent');
  if (el) el.textContent = data.content || '看板文件不存在';
}

/* ============ Workspace ============ */
async function loadWsList() {
  const data = await api('/workspaces');
  const sidebar = document.getElementById('wsSidebar');
  if (!sidebar) return;
  sidebar.innerHTML = '';
  (data.workspaces || []).forEach(ws => {
    const div = document.createElement('div');
    div.className = 'ws-item text-xs';
    div.innerHTML = `<div>${ws.name}</div><div class="text-[9px] text-dark-400">${ws.shared ? '共享' : '专属'}</div>`;
    div.onclick = () => loadWsFiles(ws.name);
    sidebar.appendChild(div);
  });
}

async function loadWsFiles(name) {
  const data = await api(`/workspace/list?ws=${encodeURIComponent(name)}`);
  const el = document.getElementById('wsContent');
  if (!el) return;
  el.innerHTML = `<h4 class="text-sm font-medium mb-3">${name}</h4>`;
  if (!data.files?.length) {
    el.innerHTML += '<div class="text-dark-400 text-sm">(空文件夹)</div>';
    return;
  }
  data.files.forEach(f => {
    const div = document.createElement('div');
    div.className = 'flex justify-between items-center px-3 py-2 rounded bg-dark-700/50 hover:bg-dark-700 border border-dark-500/50 mb-1 cursor-pointer text-xs';
    div.innerHTML = `<span>${f.name}</span><span class="text-dark-400 text-[10px]">${f.size}B</span>`;
    div.onclick = () => readWsFile(name, f.name);
    el.appendChild(div);
  });
}

async function readWsFile(ws, file) {
  const data = await api(`/workspace/read?ws=${encodeURIComponent(ws)}&file=${encodeURIComponent(file)}`);
  const el = document.getElementById('wsContent');
  let preview = el.querySelector('.ws-preview');
  if (!preview) {
    preview = document.createElement('div');
    preview.className = 'ws-preview mt-3 p-3 rounded bg-dark-700 border border-dark-500 text-xs leading-relaxed whitespace-pre-wrap max-h-60 overflow-auto';
    el.appendChild(preview);
  }
  preview.textContent = data.content || '(空)';
}

/* ============ Batch Update ============ */
async function batchUpdateBoard() {
  if (!dashboardData?.agents) return;
  for (const [id, state] of Object.entries(dashboardData.agents)) {
    const agent = agents.find(a => a.id === id);
    if (!agent?.board_section) continue;

    const boardFields = agent.board_fields || {};
    const updates = {};
    if (boardFields.checkboxes?.length && state.status) {
      boardFields.checkboxes.forEach(field => {
        updates[field] = state.status;
      });
    }
    if (boardFields.fill_text?.length && state.task) {
      boardFields.fill_text.forEach(field => {
        updates[field] = state.task;
      });
    }
    if (Object.keys(updates).length) {
      await api('/board/update', {
        method: 'POST',
        body: JSON.stringify({ agent_id: id, updates }),
      });
    }
  }
  await loadBoard();
}

/* ============ Listeners ============ */
function setupListeners() {
  // @ send
  document.getElementById('btnAtSend').onclick = handleAtCall;
  document.getElementById('atInput').onkeydown = e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAtCall(); }
  };

  // Quick @ tags
  document.querySelectorAll('.at-tag').forEach(tag => {
    tag.onclick = () => {
      const id = tag.dataset.id;
      currentTarget = id;
      document.querySelectorAll('.agent-node').forEach(n => n.classList.remove('active'));
      const node = document.querySelector(`.agent-node[data-id="${id}"]`);
      if (node) node.classList.add('active');
      document.getElementById('atInput').value = `@${AGENT_MAP[id]?.short || id} `;
      document.getElementById('atInput').focus();
    };
  });

  // Agent nodes click
  document.querySelectorAll('.agent-node').forEach(node => {
    node.onclick = () => {
      const id = node.dataset.id;
      currentTarget = id;
      document.querySelectorAll('.agent-node').forEach(n => n.classList.remove('active'));
      node.classList.add('active');
      document.getElementById('atInput').value = `@${AGENT_MAP[id]?.short || id} `;
      document.getElementById('atInput').focus();
    };
  });

  // Tabs
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      const tab = document.getElementById('tab-' + btn.dataset.tab);
      if (tab) tab.classList.add('active');
      if (btn.dataset.tab === 'board') loadBoard();
    };
  });

  // Save all
  document.getElementById('btnSaveAll').onclick = () => {
    saveDashboard();
    batchUpdateBoard().then(loadBoard);
  };

  // Refresh
  document.getElementById('btnRefresh').onclick = loadAll;

  // Add task
  document.getElementById('btnAddTask').onclick = () => {
    const firstIdle = Object.entries(dashboardData?.agents || {}).find(([_, s]) => s.status === '空闲');
    if (firstIdle) {
      handleEdit(firstIdle[0], 'status', '工作中');
      renderStatusTable();
      renderMindmapNodes();
    }
  };

  // Batch sync
  document.getElementById('btnBatchUpdate').onclick = batchUpdateBoard;
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function escapeAttr(s) {
  if (!s) return '';
  return s.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

document.addEventListener('DOMContentLoaded', init);
