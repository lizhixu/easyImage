const adminShell = document.querySelector('#adminShell');
const storageForm = document.querySelector('#storageForm');
const uploadForm = document.querySelector('#uploadForm');
const apiForm = document.querySelector('#apiForm');
const storageHint = document.querySelector('#storageHint');
const openlistImport = document.querySelector('#openlistImport');
const importTarget = document.querySelector('#importTarget');
const importStatus = document.querySelector('#importStatus');
const navAuth = document.querySelector('#navAuth');
const navToggle = document.querySelector('.nav-toggle');
const navCollapse = document.querySelector('.nav-collapse');
const fileRows = document.querySelector('#fileRows');
const fileSearch = document.querySelector('#fileSearch');
const refreshFilesBtn = document.querySelector('#refreshFilesBtn');
const batchApproveBtn = document.querySelector('#batchApproveBtn');
const batchDeleteBtn = document.querySelector('#batchDeleteBtn');
const selectAllFiles = document.querySelector('#selectAllFiles');
const pageInfo = document.querySelector('#pageInfo');
const pageNumbers = document.querySelector('#pageNumbers');
const pageSizeSelect = document.querySelector('#pageSizeSelect');
const statsEl = document.querySelector('#stats');
const toast = document.querySelector('#toast');
const confirmModal = document.querySelector('#confirmModal');
const confirmMessage = document.querySelector('#confirmMessage');
const confirmOk = document.querySelector('#confirmOk');
const confirmCancel = document.querySelector('#confirmCancel');
let activeFilter = '';
let cachedFiles = [];
let selectedFileIds = new Set();
let filePage = 1;
let filePageSize = 12;
let fileTotal = 0;
const tokenNames = new Map();
const sectionByRoute = {
  storage: 'storageSection',
  upload: 'uploadSection',
  api: 'apiSection',
  files: 'filesSection',
  account: 'accountSection',
  tokens: 'tokensSection'
};
const routeBySection = Object.fromEntries(Object.entries(sectionByRoute).map(([route, section]) => [section, route]));

showSection(sectionFromPath(), false);

function showToast(message) {
  toast.textContent = message;
  toast.hidden = false;
  window.setTimeout(() => {
    toast.hidden = true;
  }, 2800);
}

function showConfirm(message, { danger = false } = {}) {
  function setLoading() {
    confirmOk.disabled = true;
    confirmCancel.disabled = true;
    confirmOk.innerHTML = '<span class="btn-spinner"></span>处理中…';
  }
  function resetButtons() {
    confirmOk.disabled = false;
    confirmCancel.disabled = false;
    confirmOk.className = danger ? 'btn small danger' : 'btn small primary';
    confirmOk.textContent = danger ? '删除' : '确认';
    confirmOk.focus();
  }
  function hide() {
    confirmModal.hidden = true;
  }

  confirmMessage.textContent = message;
  resetButtons();
  confirmModal.hidden = false;

  return new Promise((resolve) => {
    function done(value) {
      confirmOk.removeEventListener('click', onOk);
      confirmCancel.removeEventListener('click', onCancel);
      confirmModal.removeEventListener('click', onBackdrop);
      document.removeEventListener('keydown', onKey);
      resolve(value);
    }
    function onOk() { done({ confirmed: true, setLoading, reset: resetButtons, close: hide }); }
    function onCancel() { hide(); done({ confirmed: false }); }
    function onBackdrop(e) { if (e.target === confirmModal) { hide(); done({ confirmed: false }); } }
    function onKey(e) { if (e.key === 'Escape') { hide(); done({ confirmed: false }); } }
    confirmOk.addEventListener('click', onOk);
    confirmCancel.addEventListener('click', onCancel);
    confirmModal.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onKey);
  });
}

function formatSize(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return map[char];
  });
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

async function api(path, options) {
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || '请求失败');
  return data;
}

async function loadSession() {
  const session = await api('/api/session');
  if (!session.authenticated) {
    window.location.replace(`/login.html?next=${encodeURIComponent(window.location.pathname)}`);
    return;
  }
  showSection(sectionFromPath(), false);
  adminShell.hidden = false;
  document.body.classList.remove('admin-auth-pending');
  navAuth.innerHTML = `<a id="logoutBtn" class="nav-user" href="#"><svg class="icon"><use href="#i-user"></use></svg><span>${session.user || ''}</span><svg class="icon"><use href="#i-log-out"></use></svg></a>`;
  document.querySelector('#logoutBtn').addEventListener('click', async (e) => {
    e.preventDefault();
    await api('/api/auth/logout', { method: 'POST' });
    window.location.replace('/login.html');
  });
  await Promise.all([loadStorageSettings(), loadUploadSettings(), loadApiSettings(), loadFiles(), loadAccountSettings(), loadTokens()]);
}

function sectionFromPath() {
  const route = window.location.pathname.split('/').filter(Boolean)[1] || 'storage';
  return sectionByRoute[route] || 'storageSection';
}

function showSection(sectionId, push = true) {
  document.querySelectorAll('[data-section]').forEach((item) => item.classList.toggle('active', item.dataset.section === sectionId));
  document.querySelectorAll('.admin-section').forEach((section) => {
    section.hidden = section.id !== sectionId;
  });

  if (push) {
    const route = routeBySection[sectionId] || 'storage';
    const nextPath = `/admin/${route}`;
    if (window.location.pathname !== nextPath) {
      window.history.pushState({ sectionId }, '', nextPath);
    }
  }
}

async function loadStorageSettings() {
  const data = await api('/api/settings/storage');
  const settings = data.settings;
  fillStorageGroup('normal', settings.normal);
  fillStorageGroup('suspicious', settings.suspicious);
  const normalSecret = settings.normal.hasSecretAccessKey ? '正常 Secret 已保存' : '正常 Secret 未保存';
  const suspiciousSecret = settings.suspicious.hasSecretAccessKey ? '可疑 Secret 已保存' : '可疑 Secret 未保存';
  storageHint.textContent = `${normalSecret}，${suspiciousSecret}`;
}

function fillStorageGroup(prefix, settings) {
  for (const [key, value] of Object.entries(settings)) {
    const field = storageForm.elements[`${prefix}.${key}`];
    if (!field || key === 'secretAccessKey' || key === 'hasSecretAccessKey') continue;
    if (field.type === 'checkbox') {
      field.checked = Boolean(value);
    } else {
      field.value = value || '';
    }
  }
  storageForm.elements[`${prefix}.secretAccessKey`].value = '';
}

function readStorageGroup(prefix) {
  return {
    endpoint: storageForm.elements[`${prefix}.endpoint`].value.trim(),
    region: storageForm.elements[`${prefix}.region`].value.trim() || 'auto',
    accessKeyId: storageForm.elements[`${prefix}.accessKeyId`].value.trim(),
    secretAccessKey: storageForm.elements[`${prefix}.secretAccessKey`].value,
    bucket: storageForm.elements[`${prefix}.bucket`].value.trim(),
    publicBaseUrl: storageForm.elements[`${prefix}.publicBaseUrl`].value.trim(),
    forcePathStyle: storageForm.elements[`${prefix}.forcePathStyle`].checked
  };
}

function parseJsonLoose(text) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    const first = trimmed.indexOf('{');
    const last = trimmed.lastIndexOf('}');
    if (first >= 0 && last > first) {
      return JSON.parse(trimmed.slice(first, last + 1));
    }
    throw new Error('不是有效 JSON');
  }
}

function normalizeEndpoint(endpoint) {
  const value = String(endpoint || '').trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  return `https://${value}`;
}

function parseOpenListStorage(text) {
  const root = parseJsonLoose(text);
  const addition = typeof root.addition === 'string' ? parseJsonLoose(root.addition) : root.addition || root;
  if (!addition || typeof addition !== 'object') {
    throw new Error('未找到 S3 addition 配置');
  }

  const driver = String(root.driver || addition.driver || 'S3').toLowerCase();
  if (driver !== 's3') {
    throw new Error('当前配置不是 S3 驱动');
  }

  const bucket = addition.bucket || '';
  const endpoint = normalizeEndpoint(addition.endpoint);
  const accessKeyId = addition.access_key_id || addition.accessKeyId || '';
  const secretAccessKey = addition.secret_access_key || addition.secretAccessKey || '';

  if (!bucket || !endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error('缺少 bucket、endpoint、access_key_id 或 secret_access_key');
  }

  return {
    endpoint,
    region: addition.region || 'auto',
    accessKeyId,
    secretAccessKey,
    bucket,
    publicBaseUrl: normalizeEndpoint(addition.custom_host || addition.direct_upload_host || ''),
    forcePathStyle: Boolean(addition.force_path_style)
  };
}

function applyStorageGroup(prefix, values) {
  for (const [key, value] of Object.entries(values)) {
    const field = storageForm.elements[`${prefix}.${key}`];
    if (!field) continue;
    if (field.type === 'checkbox') {
      field.checked = Boolean(value);
    } else {
      field.value = value || '';
    }
  }
}

function importOpenListConfig() {
  const text = openlistImport.value;
  if (!text.trim()) {
    importStatus.textContent = '等待输入';
    return;
  }

  try {
    const values = parseOpenListStorage(text);
    applyStorageGroup(importTarget.value, values);
    importStatus.textContent = `已识别并填入${importTarget.value === 'normal' ? '正常文件存储' : '可疑文件存储'}，确认后点击保存 S3 配置`;
  } catch (error) {
    importStatus.textContent = error.message;
  }
}

async function loadFiles() {
  const params = new URLSearchParams({ page: String(filePage), pageSize: String(filePageSize) });
  if (activeFilter) params.set('status', activeFilter);
  const query = `?${params.toString()}`;
  const [filesData, statsData] = await Promise.all([api(`/api/files${query}`), api('/api/stats')]);
  statsEl.textContent = `总数 ${statsData.stats.total || 0}，正常 ${statsData.stats.active || 0}，可疑 ${statsData.stats.suspicious || 0}，容量 ${formatSize(statsData.stats.bytes)}`;
  cachedFiles = filesData.files;
  filePage = filesData.page;
  filePageSize = filesData.pageSize;
  fileTotal = filesData.total;
  pageSizeSelect.value = String(filePageSize);
  selectedFileIds.clear();
  renderFileRows();
}

function renderFileRows() {
  const keyword = fileSearch.value.trim().toLowerCase();
  const files = cachedFiles.filter((file) => {
    if (!keyword) return true;
    return [file.original_name, file.object_key, file.reason, file.bucket_name, file.public_url]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(keyword));
  });

  fileRows.innerHTML = '';
  files.forEach((file) => {
    const row = document.createElement('tr');
    const status = file.status === 'suspicious' ? '可疑' : '正常';
    const preview = String(file.mime_type || '').startsWith('image/')
      ? `<img class="file-preview" src="${escapeAttr(file.public_url)}" alt="">`
      : '<div class="file-preview placeholder">FILE</div>';
    const approveButton =
      file.status === 'suspicious'
        ? `<button class="btn small" data-approve="${file.id}" type="button" title="审核通过"><svg class="icon"><use href="#i-check"></use></svg></button>`
        : '';
    const source = file.token_id ? (tokenNames.get(Number(file.token_id)) || 'Token') : '网页上传';
    row.innerHTML = `
      <td><input class="file-select" data-select-file="${file.id}" type="checkbox" ${selectedFileIds.has(file.id) ? 'checked' : ''}></td>
      <td>${preview}</td>
      <td>
        <div class="file-main">
          <a href="${escapeAttr(file.public_url)}" target="_blank" rel="noreferrer" title="${escapeAttr(file.original_name)}">${escapeHtml(file.original_name)}</a>
          <code>${escapeHtml(file.object_key)}</code>
          ${file.reason ? `<div class="muted">${escapeHtml(file.reason)}</div>` : ''}
        </div>
      </td>
      <td><span class="badge ${file.status === 'suspicious' ? 'suspicious' : ''}">${status}</span></td>
      <td><span class="muted">${escapeHtml(source)}</span></td>
      <td><span class="muted">${escapeHtml(file.bucket_name)}</span></td>
      <td>${formatSize(file.size)}</td>
      <td>${new Date(file.created_at).toLocaleString()}</td>
      <td>
        <div class="row-actions">
          ${approveButton}
          <button class="btn small" data-copy-url="${escapeAttr(file.public_url)}" type="button" title="复制链接"><svg class="icon"><use href="#i-copy"></use></svg></button>
          <a class="btn small" href="${escapeAttr(file.public_url)}" target="_blank" rel="noreferrer" title="打开"><svg class="icon"><use href="#i-external"></use></svg></a>
          <button class="btn small danger" data-delete="${file.id}" type="button" title="删除"><svg class="icon"><use href="#i-trash"></use></svg></button>
        </div>
      </td>
    `;
    fileRows.appendChild(row);
  });

  if (!files.length) {
    fileRows.innerHTML = '<tr><td class="empty-row" colspan="9">没有匹配的文件</td></tr>';
  }

  const totalPages = Math.max(Math.ceil(fileTotal / filePageSize), 1);
  const start = fileTotal === 0 ? 0 : (filePage - 1) * filePageSize + 1;
  const end = Math.min(filePage * filePageSize, fileTotal);
  pageInfo.textContent = `${start}–${end} / ${fileTotal}`;
  renderPagination(totalPages);
  selectAllFiles.checked = files.length > 0 && files.every((file) => selectedFileIds.has(file.id));
  batchApproveBtn.disabled = selectedFileIds.size === 0;
  batchDeleteBtn.disabled = selectedFileIds.size === 0;
}

function renderPagination(totalPages) {
  pageNumbers.innerHTML = '';

  function btn(label, page, { active = false, disabled = false, ellipsis = false, icon = null } = {}) {
    const el = document.createElement('button');
    el.type = 'button';
    if (ellipsis) {
      el.className = 'page-num ellipsis';
      el.textContent = '…';
      el.disabled = true;
    } else {
      el.className = 'page-num' + (active ? ' active' : '');
      if (icon) {
        el.innerHTML = `<svg class="icon"><use href="#${icon}"></use></svg>`;
      } else {
        el.textContent = label;
      }
      el.disabled = disabled;
      if (!disabled && !active) {
        el.addEventListener('click', async () => {
          filePage = page;
          try { await loadFiles(); } catch (error) { showToast(error.message); }
        });
      }
    }
    pageNumbers.appendChild(el);
  }

  btn('', 1, { disabled: filePage <= 1, icon: 'i-chevrons-left' });
  btn('', filePage - 1, { disabled: filePage <= 1, icon: 'i-chevron-left' });

  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) btn(String(i), i, { active: i === filePage });
  } else {
    btn('1', 1, { active: filePage === 1 });
    if (filePage > 3) btn('', 0, { ellipsis: true });
    const start = Math.max(2, filePage - 1);
    const end = Math.min(totalPages - 1, filePage + 1);
    for (let i = start; i <= end; i++) btn(String(i), i, { active: i === filePage });
    if (filePage < totalPages - 2) btn('', 0, { ellipsis: true });
    btn(String(totalPages), totalPages, { active: filePage === totalPages });
  }

  btn('', filePage + 1, { disabled: filePage >= totalPages, icon: 'i-chevron-right' });
  btn('', totalPages, { disabled: filePage >= totalPages, icon: 'i-chevrons-right' });
}

async function loadApiSettings() {
  const data = await api('/api/settings/api');
  apiForm.elements.nsfwjsUrl.value = data.settings.nsfwjsUrl || '';
  apiForm.elements.nsfwThreshold.value = data.settings.nsfwThreshold || 0.6;
}

function uploadOutputValue(name, value) {
  if (name === 'maxSize') return `${Math.round(Number(value) / 1024 / 1024)} MB`;
  if (name === 'maxUploadFiles') return `${value} 张`;
  return String(value);
}

function updateUploadOutput(name) {
  const output = uploadForm.querySelector(`[data-output="${name}"]`);
  const field = uploadForm.elements[name];
  if (output && field) output.value = uploadOutputValue(name, field.value);
}

async function loadUploadSettings() {
  const data = await api('/api/settings/upload');
  for (const [key, value] of Object.entries(data.settings)) {
    const field = uploadForm.elements[key];
    if (!field) continue;
    field.value = value;
    updateUploadOutput(key);
  }
}

storageForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const payload = {
    normal: readStorageGroup('normal'),
    suspicious: readStorageGroup('suspicious')
  };
  try {
    await api('/api/settings/storage', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    showToast('S3 配置已保存');
    await loadStorageSettings();
  } catch (error) {
    showToast(error.message);
  }
});

uploadForm.addEventListener('input', (event) => {
  if (event.target?.name) updateUploadOutput(event.target.name);
});

uploadForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(uploadForm);
  const payload = Object.fromEntries(form.entries());
  for (const key of ['chunks', 'maxUploadFiles', 'maxSize']) {
    payload[key] = Number(payload[key]);
  }
  try {
    await api('/api/settings/upload', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    showToast('上传设置已保存');
    await loadUploadSettings();
  } catch (error) {
    showToast(error.message);
  }
});

async function loadAccountSettings() {
  try {
    const data = await api('/api/settings/auth');
    const form = document.querySelector('#accountForm');
    form.elements.username.value = data.settings.username || '';
  } catch { /* ignore if not available */ }
}

document.querySelector('#accountForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  const username = form.get('username')?.trim();
  const currentPassword = form.get('currentPassword') || '';
  const newPassword = form.get('newPassword') || '';

  if (!username) { showToast('请输入用户名'); return; }
  if (!currentPassword) { showToast('请输入当前密码'); return; }

  try {
    await api('/api/settings/auth', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, currentPassword, newPassword })
    });
    showToast('账号信息已保存');
    event.target.elements.currentPassword.value = '';
    event.target.elements.newPassword.value = '';
  } catch (error) {
    showToast(error.message);
  }
});

/* ── Token Management ── */

async function loadTokens() {
  try {
    const data = await api('/api/tokens');
    tokenNames.clear();
    (data.tokens || []).forEach((t) => { tokenNames.set(t.id, t.name); });
    renderTokenRows(data.tokens || []);
  } catch { /* ignore */ }
}

function renderTokenRows(tokens) {
  const tbody = document.querySelector('#tokenRows');
  tbody.innerHTML = '';
  if (!tokens.length) {
    tbody.innerHTML = '<tr><td class="empty-row" colspan="5">暂无 API Token</td></tr>';
    return;
  }
  tokens.forEach((t) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${escapeHtml(t.name)}</td>
      <td><code style="font-size:12px;user-select:all">${escapeHtml(t.token)}</code></td>
      <td>${new Date(t.created_at).toLocaleString()}</td>
      <td>${t.last_used_at ? new Date(t.last_used_at).toLocaleString() : '—'}</td>
      <td><button class="btn small danger" data-delete-token="${t.id}" type="button">删除</button></td>
    `;
    tbody.appendChild(row);
  });
}

document.querySelector('#createTokenBtn').addEventListener('click', async () => {
  const input = document.querySelector('#newTokenName');
  const name = input.value.trim();
  if (!name) { showToast('请输入 Token 名称'); return; }
  try {
    await api('/api/tokens', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
    showToast('Token 已生成');
    input.value = '';
    await loadTokens();
  } catch (error) { showToast(error.message); }
});

document.querySelector('#tokenRows').addEventListener('click', async (event) => {
  const btn = event.target.closest('[data-delete-token]');
  if (!btn) return;
  const { confirmed, setLoading, reset, close } = await showConfirm('确认删除此 Token？使用该 Token 的上传不会受影响。', { danger: true });
  if (!confirmed) return;
  setLoading();
  try {
    await api(`/api/tokens/${btn.dataset.deleteToken}`, { method: 'DELETE' });
    close();
    showToast('Token 已删除');
    await loadTokens();
  } catch (error) { reset(); showToast(error.message); }
});

apiForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const payload = {
    nsfwjsUrl: apiForm.elements.nsfwjsUrl.value.trim(),
    nsfwThreshold: Number(apiForm.elements.nsfwThreshold.value || 0.6)
  };
  try {
    await api('/api/settings/api', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    showToast('API 配置已保存');
    await loadApiSettings();
  } catch (error) {
    showToast(error.message);
  }
});

openlistImport.addEventListener('input', importOpenListConfig);
importTarget.addEventListener('change', importOpenListConfig);

/* ── Mobile nav toggle ── */
navToggle?.addEventListener('click', () => {
  navToggle.classList.toggle('is-open');
  navCollapse?.classList.toggle('is-open');
});

document.querySelectorAll('[data-filter]').forEach((button) => {
  button.addEventListener('click', async () => {
    document.querySelectorAll('[data-filter]').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
    activeFilter = button.dataset.filter;
    filePage = 1;
    try { await loadFiles(); } catch (error) { showToast(error.message); }
  });
});

fileSearch.addEventListener('input', renderFileRows);
refreshFilesBtn.addEventListener('click', async () => {
  refreshFilesBtn.disabled = true;
  try {
    await loadFiles();
  } catch (error) {
    showToast(error.message);
  } finally {
    refreshFilesBtn.disabled = false;
  }
});
pageSizeSelect.addEventListener('change', async () => {
  filePageSize = Number(pageSizeSelect.value);
  filePage = 1;
  try { await loadFiles(); } catch (error) { showToast(error.message); }
});
selectAllFiles.addEventListener('change', () => {
  const visibleIds = cachedFiles
    .filter((file) => {
      const keyword = fileSearch.value.trim().toLowerCase();
      if (!keyword) return true;
      return [file.original_name, file.object_key, file.reason, file.bucket_name, file.public_url]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(keyword));
    })
    .map((file) => file.id);
  visibleIds.forEach((id) => {
    if (selectAllFiles.checked) selectedFileIds.add(id);
    else selectedFileIds.delete(id);
  });
  renderFileRows();
});

async function batchAction(path, confirmText, successText) {
  const ids = [...selectedFileIds];
  if (!ids.length) return;
  const { confirmed, setLoading, reset, close } = await showConfirm(confirmText, { danger: path.includes('delete') });
  if (!confirmed) return;
  setLoading();
  try {
    await api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) });
    close();
    showToast(successText);
    await loadFiles();
  } catch (error) {
    reset();
    showToast(error.message);
  }
}

batchApproveBtn.addEventListener('click', () => batchAction('/api/files/batch/approve', '确认批量审核通过选中文件？', '批量审核完成'));
batchDeleteBtn.addEventListener('click', () => batchAction('/api/files/batch/delete', '确认批量删除选中文件？', '批量删除完成'));

document.querySelectorAll('[data-section]').forEach((button) => {
  button.addEventListener('click', () => {
    showSection(button.dataset.section);
  });
});

window.addEventListener('popstate', () => showSection(sectionFromPath(), false));

fileRows.addEventListener('click', async (event) => {
  const select = event.target.closest('[data-select-file]');
  if (select) {
    if (select.checked) selectedFileIds.add(select.dataset.selectFile);
    else selectedFileIds.delete(select.dataset.selectFile);
    renderFileRows();
    return;
  }

  const copyButton = event.target.closest('[data-copy-url]');
  if (copyButton) {
    await navigator.clipboard.writeText(copyButton.dataset.copyUrl);
    showToast('链接已复制');
    return;
  }

  const approveButton = event.target.closest('[data-approve]');
  if (approveButton) {
    const { confirmed, setLoading, reset, close } = await showConfirm('确认审核通过并移入正常存储？');
    if (!confirmed) return;
    setLoading();
    try {
      await api(`/api/files/${approveButton.dataset.approve}/approve`, { method: 'POST' });
      close();
      showToast('已审核通过');
      await loadFiles();
    } catch (error) {
      reset();
      showToast(error.message);
    }
    return;
  }

  const button = event.target.closest('[data-delete]');
  if (!button) return;
  const { confirmed, setLoading, reset, close } = await showConfirm('确认删除这个文件？', { danger: true });
  if (!confirmed) return;
  setLoading();
  try {
    await api(`/api/files/${button.dataset.delete}`, { method: 'DELETE' });
    close();
    showToast('已删除');
    await loadFiles();
  } catch (error) {
    reset();
    showToast(error.message);
  }
});

loadSession().catch((error) => showToast(error.message));
