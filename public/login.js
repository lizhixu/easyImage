const loginForm = document.querySelector('#loginForm');
const toast = document.querySelector('#toast');

function showToast(message) {
  toast.textContent = message;
  toast.hidden = false;
  window.setTimeout(() => {
    toast.hidden = true;
  }, 2800);
}

async function api(path, options) {
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || '请求失败');
  return data;
}

function nextUrl() {
  const params = new URLSearchParams(window.location.search);
  const next = params.get('next') || '/admin/storage';
  if (!next.startsWith('/') || next.startsWith('//')) return '/admin/storage';
  return next;
}

api('/api/session')
  .then((session) => {
    if (session.authenticated) window.location.replace(nextUrl());
  })
  .catch(() => {});

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(loginForm);
  try {
    await api('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(form.entries()))
    });
    window.location.replace(nextUrl());
  } catch (error) {
    showToast(error.message);
  }
});
