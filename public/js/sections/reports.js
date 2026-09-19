import { Api } from '../api.js';
import { safeErrorMessage } from '../utils.js';

// Available to any active user (admin or self-registered) - exporting a
// report is a read of already-visible data, not a privileged action. See
// api/reports/[type].js.
const REPORT_TYPES = [
  { value: 'readings', label: 'Sensor Readings', supportsDateRange: true, supportsDevice: true },
  { value: 'predictions', label: 'Predictions', supportsDateRange: true, supportsDevice: true },
  { value: 'alerts', label: 'Alerts', supportsDateRange: true, supportsDevice: true },
  { value: 'devices', label: 'Devices Summary', supportsDateRange: false, supportsDevice: false },
];

export async function render(container) {
  container.innerHTML = `
    <div class="panel-box" style="max-width:560px;">
      <h4>Export a report</h4>
      <p class="text-dim" style="font-size:12.5px; margin-top:-8px;">
        Downloads a file directly - nothing is emailed or stored server-side beyond an audit entry in System &rarr; Recent system events.
      </p>
      <form id="reportForm">
        <div class="field">
          <label for="reportType">Report</label>
          <select id="reportType">
            ${REPORT_TYPES.map((t) => `<option value="${t.value}">${t.label}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label for="reportFormat">Format</label>
          <select id="reportFormat">
            <option value="csv">CSV</option>
            <option value="pdf">PDF</option>
          </select>
        </div>
        <div id="reportFilterFields" class="inline-fields"></div>
        <div id="reportBanner" class="hidden" style="color:var(--danger); font-size:13px; margin-bottom:12px;"></div>
        <button type="submit" class="btn btn-primary" id="reportDownloadBtn">Download</button>
      </form>
    </div>
  `;

  const typeSelect = document.getElementById('reportType');
  const filterFieldsEl = document.getElementById('reportFilterFields');

  function renderFilterFields() {
    const type = REPORT_TYPES.find((t) => t.value === typeSelect.value);
    const parts = [];
    if (type.supportsDevice) {
      parts.push(`
        <div class="field">
          <label for="reportDeviceId">Device ID (optional)</label>
          <input type="text" id="reportDeviceId" placeholder="e.g. soil-water-monitor-1" />
        </div>`);
    }
    if (type.supportsDateRange) {
      parts.push(`
        <div class="field">
          <label for="reportFrom">From (optional)</label>
          <input type="datetime-local" id="reportFrom" />
        </div>
        <div class="field">
          <label for="reportTo">To (optional)</label>
          <input type="datetime-local" id="reportTo" />
        </div>`);
    }
    filterFieldsEl.innerHTML = parts.join('');
  }

  typeSelect.addEventListener('change', renderFilterFields);
  renderFilterFields();

  document.getElementById('reportForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const banner = document.getElementById('reportBanner');
    const btn = document.getElementById('reportDownloadBtn');
    banner.classList.add('hidden');

    const type = typeSelect.value;
    const format = document.getElementById('reportFormat').value;
    const deviceIdEl = document.getElementById('reportDeviceId');
    const fromEl = document.getElementById('reportFrom');
    const toEl = document.getElementById('reportTo');

    const params = { format };
    if (deviceIdEl?.value) params.device_id = deviceIdEl.value.trim();
    if (fromEl?.value) params.from = new Date(fromEl.value).toISOString();
    if (toEl?.value) params.to = new Date(toEl.value).toISOString();

    btn.disabled = true;
    btn.textContent = 'Preparing…';
    try {
      await Api.downloadReport(type, params);
    } catch (err) {
      banner.textContent = safeErrorMessage(err);
      banner.classList.remove('hidden');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Download';
    }
  });
}
