import { Api } from '../api.js';
import { renderState, safeErrorMessage, fmtDateTime, fmtRelativeTime, deviceStatusBadge, categoryBadge, escapeHtml } from '../utils.js';
import { renderLineChart } from '../charts.js';

export async function render(container) {
  await renderList(container);
}

async function renderList(container) {
  renderState(container, 'loading', { loadingText: 'Loading devices…' });

  let devices;
  try {
    const resp = await Api.getDevices();
    devices = resp.devices;
  } catch (err) {
    renderState(container, 'error', { message: safeErrorMessage(err), retryable: true, onRetry: () => renderList(container) });
    return;
  }

  container.innerHTML = `
    <div class="panel-header" style="margin-bottom:16px;">
      <div></div>
      <button class="btn btn-primary" id="registerDeviceBtn">+ Register new device</button>
    </div>
    <div id="devicesListWrap"></div>
  `;

  document.getElementById('registerDeviceBtn').addEventListener('click', () => openRegisterModal(() => renderList(container)));

  const listWrap = document.getElementById('devicesListWrap');

  if (devices.length === 0) {
    renderState(listWrap, 'empty', {
      title: 'No devices registered yet',
      message: 'Register your first device to get a one-time device token for the firmware configuration.',
    });
    return;
  }

  listWrap.innerHTML = `
    <div class="panel-box">
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Device</th><th>Label</th><th>Status</th><th>Firmware</th><th>Last seen</th><th>Readings</th></tr></thead>
          <tbody>
            ${devices.map((d) => `
              <tr class="clickable" data-device-id="${escapeHtml(d.device_id)}">
                <td class="mono-cell">${escapeHtml(d.device_id)}</td>
                <td>${escapeHtml(d.label || '—')}</td>
                <td>${deviceStatusBadge(d.status)}</td>
                <td class="mono-cell">${escapeHtml(d.firmware_version || '—')}</td>
                <td>${fmtRelativeTime(d.last_seen_at)}</td>
                <td class="mono-cell">${d.reading_count}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  listWrap.querySelectorAll('tr[data-device-id]').forEach((row) => {
    row.addEventListener('click', () => renderDetail(container, row.getAttribute('data-device-id')));
  });
}

async function renderDetail(container, deviceId) {
  renderState(container, 'loading', { loadingText: `Loading ${deviceId}…` });

  let device;
  try {
    device = await Api.getDevice(deviceId);
  } catch (err) {
    renderState(container, 'error', {
      message: safeErrorMessage(err),
      retryable: true,
      onRetry: () => renderDetail(container, deviceId),
    });
    return;
  }

  const readings = device.readings || [];
  const chronological = [...readings].reverse();
  const labels = chronological.map((r) => new Date(r.received_at).toLocaleString());

  container.innerHTML = `
    <button class="btn btn-sm" id="backToDevicesBtn" style="margin-bottom:16px;">&larr; Back to devices</button>
    <div class="panel-header">
      <div>
        <h3 class="mono">${escapeHtml(device.device_id)}</h3>
        <p>${escapeHtml(device.label || 'No label set')} &middot; firmware ${escapeHtml(device.firmware_version || 'unknown')}</p>
      </div>
      ${deviceStatusBadge(device.status)}
    </div>

    <div class="card-grid">
      <div class="card"><div class="label">Registered</div><div class="value" style="font-size:15px;">${fmtDateTime(device.registered_at)}</div></div>
      <div class="card"><div class="label">Last seen</div><div class="value" style="font-size:15px;">${fmtRelativeTime(device.last_seen_at)}</div></div>
      <div class="card"><div class="label">Readings (recent window)</div><div class="value">${readings.length}</div></div>
    </div>

    ${readings.length === 0 ? `
      <div class="state-block">
        <div class="state-title">No readings from this device yet</div>
        <div>Once the firmware sends its first payload, readings will appear here.</div>
      </div>
    ` : `
      <div class="panel-box">
        <h4>Recent readings (this device)</h4>
        <div class="chart-wrap tall"><canvas id="deviceChart"></canvas></div>
      </div>
      <div class="panel-box">
        <h4>Reading history</h4>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Time</th><th>pH</th><th>Turbidity</th><th>TDS</th><th>Category</th><th>Confidence</th><th>Valid</th></tr></thead>
            <tbody>
              ${readings.slice(0, 100).map((r) => `
                <tr>
                  <td>${fmtDateTime(r.received_at)}</td>
                  <td class="mono-cell">${typeof r.ph === 'number' ? r.ph.toFixed(2) : '—'}</td>
                  <td class="mono-cell">${r.turbidity_ntu.toFixed(1)}</td>
                  <td class="mono-cell">${r.tds_ppm.toFixed(0)}</td>
                  <td>${r.water_quality_category ? categoryBadge(r.water_quality_category) : '—'}</td>
                  <td class="mono-cell">${typeof r.prediction_confidence === 'number' ? (r.prediction_confidence * 100).toFixed(0) + '%' : '—'}</td>
                  <td>${r.is_valid ? '<span class="badge badge-accent">valid</span>' : '<span class="badge badge-danger">invalid</span>'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `}
  `;

  document.getElementById('backToDevicesBtn').addEventListener('click', () => renderList(container));

  if (readings.length > 0) {
    renderLineChart('deviceChart', {
      labels,
      datasets: [
        { label: 'pH', data: chronological.map((r) => (typeof r.ph === 'number' ? r.ph : null)), color: '#35d0c4' },
        { label: 'Turbidity (NTU)', data: chronological.map((r) => r.turbidity_ntu), color: '#e8b34c' },
        { label: 'TDS (ppm / 10)', data: chronological.map((r) => r.tds_ppm / 10), color: '#4c9be8' },
      ],
    });
  }
}

function openRegisterModal(onDone) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal">
      <h3>Register new device</h3>
      <p class="modal-sub">Creates a device record and issues a one-time authentication token for the firmware.</p>
      <form id="registerDeviceForm">
        <div class="field">
          <label for="regDeviceId">Device ID *</label>
          <input type="text" id="regDeviceId" required placeholder="e.g. soil-water-monitor-2" />
        </div>
        <div class="field">
          <label for="regLabel">Label</label>
          <input type="text" id="regLabel" placeholder="e.g. Pond intake sensor" />
        </div>
        <div class="field">
          <label for="regFirmware">Firmware version</label>
          <input type="text" id="regFirmware" placeholder="e.g. 1.2.0" />
        </div>
        <div id="registerFormBanner" class="field-error hidden" style="color:var(--danger); font-size:13px; margin-bottom:12px;"></div>
        <div class="modal-actions">
          <button type="button" class="btn" id="cancelRegisterBtn">Cancel</button>
          <button type="submit" class="btn btn-primary" id="submitRegisterBtn">Register device</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(backdrop);

  document.getElementById('cancelRegisterBtn').addEventListener('click', () => backdrop.remove());
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) backdrop.remove();
  });

  document.getElementById('registerDeviceForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const device_id = document.getElementById('regDeviceId').value.trim();
    const label = document.getElementById('regLabel').value.trim();
    const firmware_version = document.getElementById('regFirmware').value.trim();
    const banner = document.getElementById('registerFormBanner');
    const submitBtn = document.getElementById('submitRegisterBtn');

    if (!device_id) return;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Registering…';
    banner.classList.add('hidden');

    try {
      const result = await Api.registerDevice({
        device_id,
        label: label || undefined,
        firmware_version: firmware_version || undefined,
      });
      backdrop.remove();
      showTokenModal(result, onDone);
    } catch (err) {
      banner.textContent = safeErrorMessage(err);
      banner.classList.remove('hidden');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Register device';
    }
  });
}

function showTokenModal(result, onDone) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal">
      <h3>Device registered</h3>
      <p class="modal-sub">Device <span class="mono">${escapeHtml(result.device_id)}</span> was created successfully.</p>
      <div class="token-box">
        <div class="token-value" id="deviceTokenValue">${escapeHtml(result.device_token)}</div>
        <button class="btn btn-sm" id="copyTokenBtn">Copy token</button>
        <span class="copy-feedback hidden" id="copyFeedback">Copied</span>
      </div>
      <p class="token-warning">
        <strong>Copy this token now.</strong> ${escapeHtml(result.warning || 'It will not be shown again - only its hash is stored.')}
        Configure it into the firmware (WiFiManager portal, serial <span class="mono">set</span> command, or remote
        <span class="mono">set_config</span>) so the device can authenticate.
      </p>
      <div class="modal-actions">
        <button class="btn btn-primary" id="doneTokenBtn">Done</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);

  document.getElementById('copyTokenBtn').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(result.device_token);
      document.getElementById('copyFeedback').classList.remove('hidden');
    } catch {
      // Clipboard API unavailable - the token is still selectable text.
    }
  });

  document.getElementById('doneTokenBtn').addEventListener('click', () => {
    backdrop.remove();
    onDone();
  });
}
