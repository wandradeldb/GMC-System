export function apiFetch(url, options = {}) {
  const token = localStorage.getItem('gmc_token');
  return fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}
