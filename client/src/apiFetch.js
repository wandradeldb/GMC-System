let handlingExpiredToken = false;

export function apiFetch(url, options = {}) {
  const token = localStorage.getItem('gmc_token');
  return fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  }).then(res => {
    if (res.status === 401 && token && !handlingExpiredToken) {
      handlingExpiredToken = true;
      localStorage.removeItem('gmc_token');
      localStorage.removeItem('gmc_user');
      localStorage.removeItem('gmc_role');
      window.location.reload();
    }
    return res;
  });
}
