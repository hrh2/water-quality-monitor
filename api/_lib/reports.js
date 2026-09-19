// Report generation: shared query + CSV/PDF formatting for every report
// type exposed by api/reports/[type].js. Available to any active
// authenticated user (admin or self-registered) - see that route's
// comment for why exports aren't role-restricted the way device/alert
// management is.
import PDFDocument from 'pdfkit';
import { query } from './db.js';

const MAX_EXPORT_ROWS = 5000;

function buildFilterClause(filters, params, { deviceColumn, timeColumn }) {
  const conditions = [];
  if (filters.device_id) {
    params.push(filters.device_id);
    conditions.push(`${deviceColumn} = $${params.length}`);
  }
  if (filters.from) {
    params.push(filters.from);
    conditions.push(`${timeColumn} >= $${params.length}`);
  }
  if (filters.to) {
    params.push(filters.to);
    conditions.push(`${timeColumn} <= $${params.length}`);
  }
  return conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
}

const REPORT_TYPES = {
  readings: {
    title: 'Sensor Readings Report',
    columns: [
      { key: 'device_id', label: 'Device' },
      { key: 'received_at', label: 'Received At' },
      { key: 'ph', label: 'pH' },
      { key: 'turbidity_ntu', label: 'Turbidity (NTU)' },
      { key: 'tds_ppm', label: 'TDS (ppm)' },
      { key: 'is_valid', label: 'Valid' },
      { key: 'water_quality_category', label: 'Category' },
      { key: 'prediction_confidence', label: 'Confidence' },
      { key: 'contamination_risk', label: 'Contamination Risk' },
    ],
    async fetch(filters) {
      const params = [];
      const where = buildFilterClause(filters, params, { deviceColumn: 'r.device_id', timeColumn: 'r.received_at' });
      const { rows } = await query(
        `SELECT r.device_id, r.received_at, r.ph, r.turbidity_ntu, r.tds_ppm, r.is_valid,
                p.water_quality_category, p.prediction_confidence, p.contamination_risk
         FROM sensor_readings r
         LEFT JOIN predictions p ON p.reading_id = r.id
         ${where}
         ORDER BY r.received_at DESC
         LIMIT ${MAX_EXPORT_ROWS}`,
        params
      );
      return rows;
    },
  },
  predictions: {
    title: 'Predictions Report',
    columns: [
      { key: 'created_at', label: 'Predicted At' },
      { key: 'device_id', label: 'Device' },
      { key: 'ph', label: 'pH' },
      { key: 'turbidity_ntu', label: 'Turbidity (NTU)' },
      { key: 'tds_ppm', label: 'TDS (ppm)' },
      { key: 'water_quality_category', label: 'Category' },
      { key: 'prediction_confidence', label: 'Confidence' },
      { key: 'contamination_risk', label: 'Contamination Risk' },
    ],
    async fetch(filters) {
      const params = [];
      const where = buildFilterClause(filters, params, { deviceColumn: 'r.device_id', timeColumn: 'p.created_at' });
      const { rows } = await query(
        `SELECT p.created_at, r.device_id, r.ph, r.turbidity_ntu, r.tds_ppm,
                p.water_quality_category, p.prediction_confidence, p.contamination_risk
         FROM predictions p
         JOIN sensor_readings r ON r.id = p.reading_id
         ${where}
         ORDER BY p.created_at DESC
         LIMIT ${MAX_EXPORT_ROWS}`,
        params
      );
      return rows;
    },
  },
  alerts: {
    title: 'Alerts Report',
    columns: [
      { key: 'created_at', label: 'Created At' },
      { key: 'device_id', label: 'Device' },
      { key: 'severity', label: 'Severity' },
      { key: 'status', label: 'Status' },
      { key: 'reason', label: 'Reason' },
      { key: 'acknowledged_at', label: 'Acknowledged At' },
      { key: 'resolved_at', label: 'Resolved At' },
    ],
    async fetch(filters) {
      const params = [];
      const where = buildFilterClause(filters, params, { deviceColumn: 'device_id', timeColumn: 'created_at' });
      const { rows } = await query(
        `SELECT created_at, device_id, severity, status, reason, acknowledged_at, resolved_at
         FROM alerts
         ${where}
         ORDER BY created_at DESC
         LIMIT ${MAX_EXPORT_ROWS}`,
        params
      );
      return rows;
    },
  },
  devices: {
    title: 'Devices Report',
    columns: [
      { key: 'device_id', label: 'Device' },
      { key: 'label', label: 'Label' },
      { key: 'is_active', label: 'Active' },
      { key: 'firmware_version', label: 'Firmware' },
      { key: 'registered_at', label: 'Registered At' },
      { key: 'last_seen_at', label: 'Last Seen' },
      { key: 'reading_count', label: 'Reading Count' },
    ],
    // Devices have no per-row time filter (registration date isn't a
    // meaningful "date range" to slice this report by), so from/to are
    // ignored here - documented in the API contract.
    async fetch() {
      const { rows } = await query(
        `SELECT d.device_id, d.label, d.is_active, d.firmware_version, d.registered_at, d.last_seen_at,
                (SELECT count(*) FROM sensor_readings r WHERE r.device_id = d.device_id) AS reading_count
         FROM devices d ORDER BY d.registered_at DESC`
      );
      return rows;
    },
  },
};

export function isValidReportType(type) {
  return Object.prototype.hasOwnProperty.call(REPORT_TYPES, type);
}

export function listReportTypes() {
  return Object.keys(REPORT_TYPES);
}

export async function fetchReportRows(type, filters) {
  return REPORT_TYPES[type].fetch(filters);
}

function formatCell(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  return String(value);
}

function csvEscape(value) {
  const str = formatCell(value);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

export function generateCsv(type, rows) {
  const { columns } = REPORT_TYPES[type];
  const header = columns.map((c) => csvEscape(c.label)).join(',');
  const lines = rows.map((row) => columns.map((c) => csvEscape(row[c.key])).join(','));
  return [header, ...lines].join('\n') + '\n';
}

export function generatePdfBuffer(type, rows, { generatedBy, filters }) {
  const { title, columns } = REPORT_TYPES[type];

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4', layout: 'landscape' });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(18).text(title, { align: 'left' });
    doc.fontSize(9).fillColor('#555555');
    doc.text(`Generated ${new Date().toISOString()} by ${generatedBy}`);
    const filterParts = Object.entries(filters || {})
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}=${v}`);
    if (filterParts.length > 0) doc.text(`Filters: ${filterParts.join(', ')}`);
    doc.text(`${rows.length} row(s)${rows.length === MAX_EXPORT_ROWS ? ` (capped at ${MAX_EXPORT_ROWS})` : ''}`);
    doc.moveDown();
    doc.fillColor('#000000');

    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const colWidth = pageWidth / columns.length;
    const rowHeight = 16;

    function drawHeaderRow(y) {
      doc.fontSize(8).font('Helvetica-Bold');
      columns.forEach((col, i) => {
        doc.text(col.label, doc.page.margins.left + i * colWidth, y, { width: colWidth - 4, ellipsis: true });
      });
      doc.font('Helvetica');
    }

    let y = doc.y;
    drawHeaderRow(y);
    y += rowHeight;
    doc.moveTo(doc.page.margins.left, y - 2).lineTo(doc.page.width - doc.page.margins.right, y - 2).strokeColor('#cccccc').stroke();

    doc.fontSize(7.5);
    for (const row of rows) {
      if (y + rowHeight > doc.page.height - doc.page.margins.bottom) {
        doc.addPage();
        y = doc.page.margins.top;
        drawHeaderRow(y);
        y += rowHeight;
      }
      columns.forEach((col, i) => {
        doc.text(formatCell(row[col.key]), doc.page.margins.left + i * colWidth, y, { width: colWidth - 4, ellipsis: true });
      });
      y += rowHeight;
    }

    doc.end();
  });
}
