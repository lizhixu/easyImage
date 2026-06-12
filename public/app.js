const fileInput = document.querySelector('#fileInput');
const browseBtn = document.querySelector('#browseBtn');
const uploadBtn = document.querySelector('#uploadBtn');
const clearBtn = document.querySelector('#clearBtn');
const dropZone = document.querySelector('#dropZone');
const fileList = document.querySelector('#fileList');
const statusText = document.querySelector('#status');
const toast = document.querySelector('#toast');
const copyBtn = document.querySelector('#copyBtn');
const sessionText = document.querySelector('#sessionText');
const outputs = {
  links: document.querySelector('#links'),
  markdown: document.querySelector('#markdown'),
  html: document.querySelector('#html'),
  del: document.querySelector('#del')
};

let selectedFiles = [];
let previewUrls = new Map();
let progressState = new Map();
let activeOutput = 'links';
const uploadConcurrency = 3;
let chunkSize = 0;

fetch('/api/upload/config')
  .then((r) => r.json())
  .then((d) => { chunkSize = Number(d.chunks || 0); })
  .catch(() => {});

function fileKey(file) {
  return `${file.name}::${file.size}::${file.lastModified}`;
}

function showToast(message) {
  toast.textContent = message;
  toast.hidden = false;
  window.setTimeout(() => {
    toast.hidden = true;
  }, 2800);
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function renderFiles() {
  fileList.innerHTML = '';
  dropZone.classList.toggle('has-files', selectedFiles.length > 0);
  selectedFiles.forEach((file, index) => {
    const progress = progressState.get(file) || { percent: 0, status: 'waiting' };
    const statusText = progress.status === 'uploading' ? `${progress.percent}%` : progress.status === 'done' ? '完成' : progress.status === 'failed' ? '失败' : '等待';
    const progressStyle = progress.status === 'uploading' ? `--progress: ${progress.percent}%` : '';
    const progressBadge =
      progress.status === 'done'
        ? '<span class="file-complete"><svg class="icon"><use href="#i-check-circle"></use></svg></span>'
        : `<span class="file-percent ${progress.status}">${statusText}</span>`;
    let preview = '<div class="file-thumb" aria-hidden="true">File</div>';
    if (file.type.startsWith('image/')) {
      if (!previewUrls.has(file)) previewUrls.set(file, URL.createObjectURL(file));
      preview = `<img class="file-thumb image" src="${previewUrls.get(file)}" alt="">`;
    }
    const item = document.createElement('div');
    item.className = `file-item ${progress.status}`;
    item.style = progressStyle;
    item.innerHTML = `
      ${preview}
      <div class="file-meta">
        <div class="file-name">${file.name}</div>
        <div class="file-size">${formatSize(file.size)}</div>
      </div>
      <div class="file-actions">
        ${progressBadge}
        <button class="file-action" data-upload-one="${index}" type="button" title="上传"><svg class="icon"><use href="#i-upload"></use></svg></button>
        <button class="file-action danger" data-remove-file="${index}" type="button" title="删除"><svg class="icon"><use href="#i-trash"></use></svg></button>
      </div>
    `;
    fileList.appendChild(item);
  });
  const uploading = [...progressState.values()].filter((item) => item.status === 'uploading').length;
  const done = [...progressState.values()].filter((item) => item.status === 'done').length;
  if (uploading > 0) {
    const totalProgress = selectedFiles.length
      ? Math.round([...progressState.values()].reduce((sum, item) => sum + (item.percent || 0), 0) / selectedFiles.length)
      : 0;
    statusText.textContent = `正在上传 ${uploading} 个文件，共 ${selectedFiles.length} 个文件，已上传 ${done} 个文件，进度 ${totalProgress}%。`;
  } else {
    statusText.textContent = selectedFiles.length ? `共 ${selectedFiles.length} 个文件，${selectedFiles.length} 个文件等待上传。` : '';
  }
}

function revokeRemovedPreviews(nextFiles = []) {
  const nextSet = new Set(nextFiles);
  for (const [file, url] of previewUrls.entries()) {
    if (!nextSet.has(file)) {
      URL.revokeObjectURL(url);
      previewUrls.delete(file);
    }
  }
}

function addFiles(files) {
  const existing = new Set(selectedFiles.map(fileKey));
  const incoming = Array.from(files);
  const unique = incoming.filter((file) => {
    const key = fileKey(file);
    if (existing.has(key)) return false;
    existing.add(key);
    return true;
  });

  const skipped = incoming.length - unique.length;
  unique.forEach((file) => progressState.set(file, { percent: 0, status: 'waiting' }));
  selectedFiles = [...selectedFiles, ...unique];
  renderFiles();
  if (skipped > 0) {
    const message = `已过滤 ${skipped} 个重复文件`;
    statusText.textContent = selectedFiles.length ? `共 ${selectedFiles.length} 个文件，${message}。` : message;
    showToast(message);
  }
}

function appendResult(file) {
  outputs.links.value += `${file.url}\n`;
  outputs.markdown.value += `![${file.srcName}](${file.url})\n`;
  outputs.html.value += `<img src="${file.url}" alt="${file.srcName}" />\n`;
  outputs.del.value += `${file.del}\n`;
}

async function uploadSingleFileChunked(file) {
  const totalChunks = Math.ceil(file.size / chunkSize);

  const initRes = await fetch('/api/upload/init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: file.name, mimetype: file.type, totalChunks })
  });
  if (!initRes.ok) { const e = await initRes.json().catch(() => ({})); throw new Error(e.message || '分片初始化失败'); }
  const { uploadId } = await initRes.json();

  for (let i = 0; i < totalChunks; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, file.size);
    const blob = file.slice(start, end);
    const form = new FormData();
    form.append('uploadId', uploadId);
    form.append('index', String(i));
    form.append('chunk', blob, `${file.name}.part`);

    const res = await fetch('/api/upload/chunk', { method: 'POST', body: form });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.message || `分片 ${i + 1} 上传失败`); }

    progressState.set(file, { percent: Math.min(99, Math.round(((i + 1) / totalChunks) * 100)), status: 'uploading' });
    renderFiles();
  }

  const completeRes = await fetch('/api/upload/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uploadId })
  });
  if (!completeRes.ok) { const e = await completeRes.json().catch(() => ({})); throw new Error(e.message || '分片合并失败'); }
  const data = await completeRes.json();
  progressState.set(file, { percent: 100, status: 'done' });
  renderFiles();
  return data;
}

function uploadSingleFileNormal(file) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('file', file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload', true);
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      progressState.set(file, { percent: Math.min(99, Math.round((event.loaded / event.total) * 100)), status: 'uploading' });
      renderFiles();
    };
    xhr.onload = () => {
      let data;
      try { data = JSON.parse(xhr.responseText); } catch {
        progressState.set(file, { percent: 0, status: 'failed' }); renderFiles();
        reject(new Error('上传返回不是有效 JSON')); return;
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        progressState.set(file, { percent: 0, status: 'failed' }); renderFiles();
        reject(new Error(data.message || '上传失败')); return;
      }
      progressState.set(file, { percent: 100, status: 'done' }); renderFiles();
      resolve(data.files?.[0] || data);
    };
    xhr.onerror = () => {
      progressState.set(file, { percent: 0, status: 'failed' }); renderFiles();
      reject(new Error('网络错误，上传失败'));
    };
    progressState.set(file, { percent: 0, status: 'uploading' }); renderFiles();
    xhr.send(form);
  });
}

function uploadSingleFile(file) {
  if (chunkSize > 0 && file.size > chunkSize) return uploadSingleFileChunked(file);
  return uploadSingleFileNormal(file);
}

async function uploadFiles(filesToUpload = selectedFiles) {
  if (!selectedFiles.length) {
    showToast('请先选择文件');
    return;
  }

  const uploadList = Array.isArray(filesToUpload) ? filesToUpload : selectedFiles;
  const queue = [...uploadList].filter((file) => selectedFiles.includes(file));
  if (!queue.length) return;

  uploadBtn.disabled = true;
  statusText.textContent = `正在上传 ${Math.min(uploadConcurrency, queue.length)} 个文件，共 ${queue.length} 个文件。`;
  const completed = [];
  const uploadedResults = [];
  const failures = [];

  try {
    let cursor = 0;
    async function worker() {
      while (cursor < queue.length) {
        const file = queue[cursor];
        cursor += 1;
        try {
          const result = await uploadSingleFile(file);
          appendResult(result);
          uploadedResults.push(result);
          completed.push(file);
        } catch (error) {
          failures.push({ file, error });
        }
      }
    }

    const workers = Array.from({ length: Math.min(uploadConcurrency, queue.length) }, () => worker());
    await Promise.all(workers);

    const suspicious = uploadedResults.filter((file) => file.status === 'suspicious').length;
    selectedFiles = selectedFiles.filter((file) => !completed.includes(file));
    completed.forEach((file) => progressState.delete(file));
    revokeRemovedPreviews(selectedFiles);
    renderFiles();

    if (failures.length) {
      showToast(`上传完成，${completed.length} 个成功，${failures.length} 个失败`);
    } else {
      showToast(suspicious ? `上传完成，${suspicious} 个文件进入可疑桶` : '上传完成');
    }
  } finally {
    uploadBtn.disabled = false;
    statusText.textContent = selectedFiles.length ? `共 ${selectedFiles.length} 个文件，${selectedFiles.length} 个文件等待上传。` : '';
  }
}

browseBtn.addEventListener('click', () => fileInput.click());
dropZone.querySelector('.drop-title').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => addFiles(fileInput.files));
clearBtn.addEventListener('click', () => {
  revokeRemovedPreviews([]);
  progressState.clear();
  selectedFiles = [];
  renderFiles();
});
uploadBtn.addEventListener('click', () => uploadFiles());

fileList.addEventListener('click', async (event) => {
  const remove = event.target.closest('[data-remove-file]');
  if (remove) {
    const [removed] = selectedFiles.splice(Number(remove.dataset.removeFile), 1);
    if (removed) progressState.delete(removed);
    revokeRemovedPreviews(selectedFiles);
    renderFiles();
    return;
  }

  const uploadOne = event.target.closest('[data-upload-one]');
  if (uploadOne) {
    const file = selectedFiles[Number(uploadOne.dataset.uploadOne)];
    if (!file) return;
    await uploadFiles([file]);
  }
});

dropZone.addEventListener('dragover', (event) => {
  event.preventDefault();
  dropZone.classList.add('dragging');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragging'));
dropZone.addEventListener('drop', (event) => {
  event.preventDefault();
  dropZone.classList.remove('dragging');
  addFiles(event.dataTransfer.files);
});

document.addEventListener('paste', (event) => {
  const files = Array.from(event.clipboardData?.files || []);
  if (files.length) addFiles(files);
});

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((item) => item.classList.remove('active'));
    document.querySelectorAll('.result-box').forEach((item) => item.classList.remove('active'));
    activeOutput = tab.dataset.target;
    tab.classList.add('active');
    outputs[activeOutput].classList.add('active');
  });
});

copyBtn.addEventListener('click', async () => {
  const value = outputs[activeOutput].value;
  if (!value.trim()) {
    showToast('复制内容为空');
    return;
  }
  await navigator.clipboard.writeText(value);
  showToast('复制成功');
});

const navAuth = document.querySelector('#navAuth');
const navToggle = document.querySelector('.nav-toggle');
const navCollapse = document.querySelector('.nav-collapse');

/* ── Mobile nav toggle ── */
navToggle?.addEventListener('click', () => {
  navToggle.classList.toggle('is-open');
  navCollapse?.classList.toggle('is-open');
});

/* ── Session ── */
fetch('/api/session')
  .then((res) => res.json())
  .then((session) => {
    if (session.authenticated) {
      navAuth.innerHTML = `<a id="logoutBtn" class="nav-user" href="#"><svg class="icon"><use href="#i-user"></use></svg><span>${session.user || ''}</span><svg class="icon"><use href="#i-log-out"></use></svg></a>`;
      document.querySelector('#logoutBtn').addEventListener('click', async (e) => {
        e.preventDefault();
        await fetch('/api/auth/logout', { method: 'POST' });
        window.location.replace('/login.html');
      });
    } else {
      navAuth.innerHTML = '<a href="/login.html"><svg class="icon"><use href="#i-user"></use></svg> 登录</a>';
    }
  })
  .catch(() => {
    navAuth.innerHTML = '<a href="/login.html"><svg class="icon"><use href="#i-user"></use></svg> 登录</a>';
  });
