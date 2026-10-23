const base = '/api';

export const getToken = () => localStorage.getItem('token');
export const setToken = t => (t ? localStorage.setItem('token', t) : localStorage.removeItem('token'));

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(getToken() ? { Authorization: 'Bearer ' + getToken() } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'Request failed');
    err.status = res.status;
    throw err;
  }
  return data;
}
