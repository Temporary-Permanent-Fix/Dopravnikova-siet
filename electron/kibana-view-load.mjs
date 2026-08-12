// Tracks load/failure state of the embedded Kibana WebContentsView and drives
// retry/reload. Kept free of any `electron` import (main.mjs wires the real
// webContents events/loadURL in) so this stays unit-testable like kibana-poll.js.

export const DEFAULT_RETRY_DELAYS_MS = [2000, 5000, 15000]; // ~22s of auto-retry before requiring a manual click

// Same-origin popups (e.g. a SAML/SSO login flow) must stay inside the
// embedded view's persist:kibana session, or the login cookies never reach
// the WebContentsView the poller actually reads from.
export function isSameOrigin(url, baseUrl) {
  try {
    return new URL(url).origin === new URL(baseUrl).origin;
  } catch {
    return false;
  }
}

export function createKibanaLoadWatcher({ loadUrl, retryDelaysMs = DEFAULT_RETRY_DELAYS_MS, onStateChange }) {
  let state = { status: 'loading', lastError: null };
  let retryAttempt = 0;
  let retryTimer = null;

  function setState(next) {
    state = next;
    onStateChange?.(state);
  }

  function clearRetryTimer() {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  }

  function scheduleRetry() {
    if (retryAttempt >= retryDelaysMs.length) return; // exhausted — wait for manual reload
    const delay = retryDelaysMs[retryAttempt++];
    retryTimer = setTimeout(() => {
      retryTimer = null;
      loadUrl();
    }, delay);
  }

  function handleFailure(errorCode, errorDescription, isMainFrame) {
    // -3 = ERR_ABORTED, fires on cancelled/superseded navigations (incl. our
    // own reload racing a slow first load) — not a real failure.
    if (isMainFrame === false || errorCode === -3) return;
    setState({ status: 'error', lastError: errorDescription || `chyba ${errorCode}` });
    scheduleRetry();
  }

  function handleSuccess() {
    clearRetryTimer();
    retryAttempt = 0;
    setState({ status: 'loaded', lastError: null });
  }

  function reload() {
    clearRetryTimer();
    retryAttempt = 0;
    setState({ status: 'loading', lastError: null });
    loadUrl();
  }

  function getState() {
    return state;
  }

  function dispose() {
    clearRetryTimer();
  }

  return { handleFailure, handleSuccess, reload, getState, dispose };
}
