import { Api } from '../api.js';
import { renderState, safeErrorMessage, fmtDateTime, categoryBadge, escapeHtml } from '../utils.js';

const CATEGORY_ORDER = ['Safe', 'Moderate', 'Unsafe', 'Critical'];

function countFor(distribution, category) {
  const row = (distribution || []).find((r) => r.water_quality_category === category);
  return row ? Number(row.count) : 0;
}

export async function render(container) {
  renderState(container, 'loading', { loadingText: 'Loading system overview…' });

  let health;
  let latestPredictionResp;
  try {
    [health, latestPredictionResp] = await Promise.all([
      Api.getHealth(),
      Api.getPredictions({ limit: 1 }).catch(() => null), // non-fatal if this one fails
    ]);
  } catch (err) {
    renderState(container, 'error', {
      message: safeErrorMessage(err),
      retryable: true,
      onRetry: () => render(container),
    });
    return;
  }

  const noDevices = health.devices.total === 0;
  const noReadings = health.total_readings === 0;

  if (noDevices && noReadings) {
    renderState(container, 'empty', {
      title: 'No devices registered yet',
      message:
        'This deployment has no devices and no sensor readings yet. Go to the ' +
        '<strong>Devices</strong> tab and register your first device to get a one-time ' +
        'device token, then configure the firmware with it. Readings and predictions will ' +
        'appear here as soon as the device starts sending data.',
    });
    return;
  }

  const dbOk = health.database.status === 'ok';
  const mlOk = health.ml_model.status === 'ok';
  const latest = latestPredictionResp && latestPredictionResp.predictions[0];

  container.innerHTML = `
    <div class="card-grid">
      <div class="card">
        <div class="label">Devices</div>
        <div class="value">${health.devices.total}</div>
        <div class="sub">${health.devices.online} online &middot; ${health.devices.offline} offline</div>
      </div>
      <div class="card">
        <div class="label">Total readings</div>
        <div class="value">${health.total_readings}</div>
      </div>
      <div class="card">
        <div class="label">Active alerts</div>
        <div class="value ${health.active_alerts > 0 ? '' : ''}">${health.active_alerts}</div>
        <div class="sub ${health.active_alerts > 0 ? 'warn' : 'ok'}">${health.active_alerts > 0 ? 'needs attention' : 'all clear'}</div>
      </div>
      <div class="card">
        <div class="label">System health</div>
        <div class="value" style="font-size:16px;">
          <span class="badge ${dbOk ? 'badge-accent' : 'badge-danger'}">DB ${dbOk ? 'ok' : 'down'}</span>
          <span class="badge ${mlOk ? 'badge-accent' : 'badge-danger'}" style="margin-left:6px;">Model ${mlOk ? 'ok' : 'down'}</span>
        </div>
      </div>
    </div>

    <div class="panel-box">
      <h4>Water quality classifications (all-time)</h4>
      <div class="card-grid" style="margin-bottom:0;">
        ${CATEGORY_ORDER.map((cat) => `
          <div class="card">
            <div class="label">${cat}</div>
            <div class="value">${countFor(health.category_distribution, cat)}</div>
          </div>
        `).join('')}
      </div>
    </div>

    <div class="panel-box">
      <h4>Latest prediction</h4>
      ${
        latest
          ? `<div style="display:flex; align-items:center; gap:16px; flex-wrap:wrap;">
              ${categoryBadge(latest.water_quality_category)}
              <span class="mono text-dim">confidence ${(latest.prediction_confidence * 100).toFixed(0)}%</span>
              <span class="mono text-dim">device ${escapeHtml(latest.device_id)}</span>
              <span class="mono text-dim">${fmtDateTime(latest.created_at)}</span>
            </div>`
          : `<div class="text-dim">No predictions recorded yet.</div>`
      }
    </div>
  `;
}
