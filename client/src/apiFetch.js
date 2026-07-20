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
      // Without this flag, an expired token silently reloads straight to a blank login form --
      // from the user's side that looks exactly like the app randomly crashing and "leaving" to
      // a new screen, with no clue why. LoginView reads and clears this on mount to explain it.
      localStorage.setItem('gmc_session_expired', '1');
      window.location.reload();
    }
    return res;
  });
}
