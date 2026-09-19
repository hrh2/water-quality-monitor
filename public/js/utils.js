// Shared formatting / rendering helpers used across admin console sections.

export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function fmtNumber(value, digits = 2) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  return value.toFixed(digits);
}

export function fmtDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString();
}

/** Relative time like "3m ago" / "just now" / "2d ago". */
export function fmtRelativeTime(value) {
  if (!value) return 'never';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'never';
  const diffMs = Date.now() - d.getTime();
  if (diffMs < 0) return 'just now';
  const sec = Math.floor(diffMs / 1000);
  if (sec < 10) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

const DEVICE_STATUS_BADGE = {
  Online: 'badge-accent',
  Offline: 'badge-warn',
  'Never connected': 'badge-dim',
  'Connection error': 'badge-danger',
};

export function deviceStatusBadge(status) {
  const cls = DEVICE_STATUS_BADGE[status] || 'badge-dim';
  return `<span class="badge ${cls}">${escapeHtml(status || 'Unknown')}</span>`;
}

const CATEGORY_BADGE = {
  Safe: 'badge-safe',
  Moderate: 'badge-moderate',
  Unsafe: 'badge-unsafe',
  Critical: 'badge-critical',
};

export function categoryBadge(category) {
  if (!category) return '<span class="badge badge-dim">Unknown</span>';
  const cls = CATEGORY_BADGE[category] || 'badge-dim';
  return `<span class="badge ${cls}">${escapeHtml(category)}</span>`;
}

const SEVERITY_BADGE = {
  info: 'badge-info',
  warning: 'badge-warn',
  critical: 'badge-danger',
};

export function severityBadge(severity) {
  const cls = SEVERITY_BADGE[severity] || 'badge-dim';
  return `<span class="badge ${cls}">${escapeHtml(severity || 'unknown')}</span>`;
}

const STATUS_BADGE = {
  active: 'badge-warn',
  acknowledged: 'badge-info',
  resolved: 'badge-accent',
};

export function alertStatusBadge(status) {
  const cls = STATUS_BADGE[status] || 'badge-dim';
  return `<span class="badge ${cls}">${escapeHtml(status || 'unknown')}</span>`;
}

export function roleBadge(role) {
  const cls = role === 'admin' ? 'badge-accent' : 'badge-info';
  return `<span class="badge ${cls}">${escapeHtml(role || 'user')}</span>`;
}

export function activeStatusBadge(isActive) {
  return isActive
    ? '<span class="badge badge-accent">active</span>'
    : '<span class="badge badge-dim">deactivated</span>';
}

/** Renders the standard loading / error / empty / content state block into
 * a container. `render` is only called for the 'content' state. */
export function renderState(container, state, opts = {}) {
  if (state === 'loading') {
    container.innerHTML = `
      <div class="state-block">
        <div class="spinner"></div>
        <div>${escapeHtml(opts.loadingText || 'Loading…')}</div>
      </div>`;
    return;
  }
  if (state === 'error') {
    container.innerHTML = `
      <div class="state-block error">
        <div class="state-title">Couldn't load this data</div>
        <div>${escapeHtml(opts.message || 'Something went wrong. Please try again.')}</div>
        ${opts.retryable ? '<button class="btn btn-sm" data-retry style="margin-top:14px;">Retry</button>' : ''}
      </div>`;
    if (opts.retryable && opts.onRetry) {
      container.querySelector('[data-retry]').addEventListener('click', opts.onRetry);
    }
    return;
  }
  if (state === 'empty') {
    container.innerHTML = `
      <div class="state-block">
        <div class="state-title">${escapeHtml(opts.title || 'Nothing here yet')}</div>
        <div>${opts.message || ''}</div>
      </div>`;
    return;
  }
}

/** Turns a caught error (ApiError / NetworkError / other) into a safe,
 * user-facing message - never leaks raw stack traces or internals. */
export function safeErrorMessage(err) {
  if (err && typeof err.message === 'string' && err.message) return err.message;
  return 'An unexpected error occurred.';
}

const CHART_PALETTE = {
  ph: '#35d0c4',
  turbidity_ntu: '#e8b34c',
  tds_ppm: '#4c9be8',
};

export function chartColorFor(key) {
  return CHART_PALETTE[key] || '#8892f0';
}

export function debounce(fn, wait) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}
