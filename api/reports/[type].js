import { sendJson, methodNotAllowed, withErrorHandling, requireUser } from '../_lib/http.js';
import { isValidReportType, listReportTypes, fetchReportRows, generateCsv, generatePdfBuffer } from '../_lib/reports.js';
import { query } from '../_lib/db.js';

// GET /api/reports/:type?format=csv|pdf&device_id=&from=&to=
// type: readings | predictions | alerts | devices
// Available to any active authenticated user (admin or self-registered) -
// exporting a report is a read of already-visible operational data, not a
// privileged action; device/alert/user MANAGEMENT stays admin-only
// elsewhere. See docs/backend/api-contract.md.
export default withErrorHandling(async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);

  const auth = await requireUser(req, res);
  if (!auth) return;

  const { type } = req.query;
  if (!isValidReportType(type)) {
    return sendJson(res, 400, { error: `Unknown report type '${type}'. Valid types: ${listReportTypes().join(', ')}` });
  }

  const { format = 'csv', device_id, from, to } = req.query;
  if (!['csv', 'pdf'].includes(format)) {
    return sendJson(res, 400, { error: "format must be 'csv' or 'pdf'" });
  }

  const filters = { device_id, from, to };
  const rows = await fetchReportRows(type, filters);

  await query(
    'INSERT INTO system_events (event_type, message, metadata) VALUES ($1, $2, $3)',
    ['report_exported', `${auth.email} exported ${type} report as ${format}`, JSON.stringify({ user_id: auth.id, type, format, filters, row_count: rows.length })]
  );

  const filename = `${type}-report-${new Date().toISOString().slice(0, 10)}.${format}`;

  if (format === 'csv') {
    const csv = generateCsv(type, rows);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.end(csv);
  }

  const pdfBuffer = await generatePdfBuffer(type, rows, { generatedBy: auth.email, filters });
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.end(pdfBuffer);
});
