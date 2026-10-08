'use strict';
// Excel (.xlsx) reading/writing via exceljs (loaded lazily so tests do not need it).
function cellValue(v) {
  if (v == null) return '';
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if ('error' in v) return '';
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('');
    if ('result' in v) return cellValue(v.result);
    if ('text' in v) return cellValue(v.text);
    return String(v);
  }
  return v;
}

// Returns the first (or named) worksheet as an array of row arrays
async function readMatrix(buffer, sheetName) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = (sheetName && wb.getWorksheet(sheetName)) || wb.worksheets[0];
  if (!ws) return [];
  const out = [];
  const width = ws.columnCount || 1;
  ws.eachRow({ includeEmpty: true }, (row, n) => {
    const vals = [];
    for (let c = 1; c <= Math.max(width, row.cellCount || 0); c++) vals.push(cellValue(row.getCell(c).value));
    out[n - 1] = vals;
  });
  return Array.from(out, (r) => r || []);
}

async function toXlsx(sheetName, columns, rows, extraSheets = []) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'School Test System';
  const add = (name, cols, data) => {
    const ws = wb.addWorksheet(String(name).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet1');
    ws.addRow(cols);
    ws.getRow(1).font = { bold: true };
    data.forEach((r) => ws.addRow(r));
    for (let i = 0; i < cols.length; i++) {
      const longest = Math.max(String(cols[i] ?? '').length, ...data.slice(0, 200).map((r) => String(r[i] ?? '').length));
      ws.getColumn(i + 1).width = Math.min(50, Math.max(8, longest + 2));
    }
  };
  add(sheetName, columns, rows);
  extraSheets.forEach((s) => add(s.name, s.columns, s.rows));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

module.exports = { readMatrix, toXlsx };
