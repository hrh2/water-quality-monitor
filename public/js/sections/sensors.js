import { Api } from '../api.js';
import { renderState, safeErrorMessage, fmtDateTime, escapeHtml } from '../utils.js';
import { renderLineChart } from '../charts.js';

// Filter state persists across re-renders of this tab within the session.
const state = { deviceId: '', from: '', to: '' };

function latestPerDevice(readings) {
  const seen = new Map();
  for (const r of readings) {
    if (!seen.has(r.device_id)) seen.set(r.device_id, r);
  }
  return [...seen.values()];
}

export async function render(container) {
  renderState(container, 'loading', { loadingText: 'Loading sensor data…' });

  let devices;
  try {
    const devResp = await Api.getDevices();
    devices = devResp.devices;
  } catch (err) {
    renderState(container, 'error', { message: safeErrorMessage(err), retryable: true, onRetry: () => render(container) });
    return;
  }

  container.innerHTML = `
    <div class="filters-bar">
      <div class="field">
        <label for="sensorDeviceFilter">Device</label>
        <select id="sensorDeviceFilter">
          <option value="">All devices</option>
          ${devices.map((d) => `<option value="${escapeHtml(d.device_id)}" ${state.deviceId === d.device_id ? 'selected' : ''}>${escapeHtml(d.label || d.device_id)}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label for="sensorFrom">From</label>
        <input type="datetime-local" id="sensorFrom" value="${state.from}" />
      </div>
      <div class="field">
        <label for="sensorTo">To</label>
        <input type="datetime-local" id="sensorTo" value="${state.to}" />
      </div>
      <button class="btn btn-primary" id="sensorApplyBtn">Apply</button>
    </div>
    <div id="sensorResults"></div>
  `;

  if (devices.length === 0) {
    renderState(document.getElementById('sensorResults'), 'empty', {
      title: 'No devices registered yet',
      message: 'Register a device from the Devices tab to start collecting sensor readings.',
    });
    return;
  }

  document.getElementById('sensorApplyBtn').addEventListener('click', () => {
    state.deviceId = document.getElementById('sensorDeviceFilter').value;
    state.from = document.getElementById('sensorFrom').value;
    state.to = document.getElementById('sensorTo').value;
    loadResults();
  });

  async function loadResults() {
    const resultsEl = document.getElementById('sensorResults');
    renderState(resultsEl, 'loading', { loadingText: 'Loading readings…' });

    const params = { limit: 500 };
    if (state.deviceId) params.device_id = state.deviceId;
    // received_at is stored as TIMESTAMPTZ in the database, so filters must
    // be sent as ISO 8601 strings (not epoch ms) for the SQL comparison in
    // GET /api/readings to bind correctly.
    if (state.from) params.from = new Date(state.from).toISOString();
    if (state.to) params.to = new Date(state.to).toISOString();

    let readings;
    try {
      const resp = await Api.getReadings(params);
      readings = resp.readings;
    } catch (err) {
      renderState(resultsEl, 'error', { message: safeErrorMessage(err), retryable: true, onRetry: loadResults });
      return;
    }

    if (readings.length === 0) {
      renderState(resultsEl, 'empty', {
        title: 'No readings in this range',
        message: 'Try widening the date range or selecting a different device.',
      });
      return;
    }

    const latest = latestPerDevice(readings);
    const chronological = [...readings].reverse(); // API returns newest-first
    const labels = chronological.map((r) => new Date(r.received_at).toLocaleTimeString());

    resultsEl.innerHTML = `
      <div class="panel-box">
        <h4>Latest reading per device</h4>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Device</th><th>pH</th><th>Turbidity (NTU)</th><th>TDS (ppm)</th><th>Received</th><th>Valid</th></tr></thead>
            <tbody>
              ${latest.map((r) => `
                <tr>
                  <td class="mono-cell">${escapeHtml(r.device_id)}</td>
                  <td class="mono-cell">${typeof r.ph === 'number' ? r.ph.toFixed(2) : '—'}</td>
                  <td class="mono-cell">${r.turbidity_ntu.toFixed(1)}</td>
                  <td class="mono-cell">${r.tds_ppm.toFixed(0)}</td>
                  <td>${fmtDateTime(r.received_at)}</td>
                  <td>${r.is_valid ? '<span class="badge badge-accent">valid</span>' : '<span class="badge badge-danger">invalid</span>'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <div class="grid-3">
        <div class="panel-box">
          <h4>pH over time</h4>
          <div class="chart-wrap"><canvas id="chartPh"></canvas></div>
        </div>
        <div class="panel-box">
          <h4>Turbidity (NTU) over time</h4>
          <div class="chart-wrap"><canvas id="chartTurbidity"></canvas></div>
        </div>
        <div class="panel-box">
          <h4>TDS (ppm) over time</h4>
          <div class="chart-wrap"><canvas id="chartTds"></canvas></div>
        </div>
      </div>
    `;

    renderLineChart('chartPh', {
      labels,
      datasets: [{ label: 'pH', data: chronological.map((r) => (typeof r.ph === 'number' ? r.ph : null)), color: '#35d0c4' }],
    });
    renderLineChart('chartTurbidity', {
      labels,
      datasets: [{ label: 'Turbidity (NTU)', data: chronological.map((r) => r.turbidity_ntu), color: '#e8b34c' }],
    });
    renderLineChart('chartTds', {
      labels,
      datasets: [{ label: 'TDS (ppm)', data: chronological.map((r) => r.tds_ppm), color: '#4c9be8' }],
    });
  }

  await loadResults();
}
