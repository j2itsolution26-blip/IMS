import 'server-only';

import ExcelJS from 'exceljs';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { ReportColumn, ReportResult } from '@/server/reports/registry';

/**
 * Report exporters.
 *
 * All three formats render from the same `ReportResult`, so the file a user
 * downloads always matches what they were looking at on screen.
 */

export type ExportFormat = 'csv' | 'xlsx' | 'pdf';

interface ExportContext {
  reportName: string;
  periodLabel: string;
  companyName: string;
  currency: string;
  generatedAt: Date;
}

/** Renders a cell for text-based output. Dates become ISO-ish, numbers stay raw. */
function formatCell(value: unknown, column: ReportColumn): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) {
    return column.format === 'datetime' ? value.toISOString() : value.toISOString().slice(0, 10);
  }
  if (typeof value === 'number') {
    if (column.format === 'currency') return value.toFixed(2);
    if (column.format === 'percent') return value.toFixed(2);
    return String(value);
  }
  return String(value);
}

function totalsFor(result: ReportResult): Record<string, number> {
  const totals: Record<string, number> = {};

  for (const column of result.columns) {
    if (!column.total) continue;
    totals[column.key] = result.rows.reduce((acc, row) => {
      const value = row[column.key];
      return acc + (typeof value === 'number' ? value : 0);
    }, 0);
  }

  return totals;
}

// --- CSV --------------------------------------------------------------------

/**
 * Escapes a CSV field. A leading =, +, -, or @ is prefixed with a quote so
 * spreadsheet software does not execute the cell as a formula.
 */
function csvEscape(value: string): string {
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

export function toCsv(result: ReportResult): string {
  const header = result.columns.map((column) => csvEscape(column.label)).join(',');

  const body = result.rows.map((row) =>
    result.columns.map((column) => csvEscape(formatCell(row[column.key], column))).join(','),
  );

  const totals = totalsFor(result);
  const hasTotals = Object.keys(totals).length > 0;

  const totalRow = hasTotals
    ? result.columns
        .map((column, index) => {
          if (index === 0) return csvEscape('TOTAL');
          const value = totals[column.key];
          return value === undefined ? '' : csvEscape(value.toFixed(column.format === 'currency' ? 2 : 3));
        })
        .join(',')
    : null;

  // BOM so Excel opens UTF-8 correctly on Windows.
  return `﻿${[header, ...body, ...(totalRow ? [totalRow] : [])].join('\r\n')}`;
}

// --- Excel ------------------------------------------------------------------

export async function toExcel(result: ReportResult, context: ExportContext): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = context.companyName;
  workbook.created = context.generatedAt;

  const sheet = workbook.addWorksheet(context.reportName.slice(0, 30) || 'Report');

  // Title block.
  sheet.mergeCells(1, 1, 1, Math.max(1, result.columns.length));
  const titleCell = sheet.getCell(1, 1);
  titleCell.value = `${context.companyName} — ${context.reportName}`;
  titleCell.font = { size: 14, bold: true };

  sheet.mergeCells(2, 1, 2, Math.max(1, result.columns.length));
  const subtitleCell = sheet.getCell(2, 1);
  subtitleCell.value = `${context.periodLabel} · generated ${context.generatedAt.toLocaleString()}`;
  subtitleCell.font = { size: 10, color: { argb: 'FF666666' } };

  const headerRowIndex = 4;
  const headerRow = sheet.getRow(headerRowIndex);
  headerRow.values = result.columns.map((column) => column.label);
  headerRow.font = { bold: true };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
  headerRow.commit();

  result.rows.forEach((row, index) => {
    const sheetRow = sheet.getRow(headerRowIndex + 1 + index);
    sheetRow.values = result.columns.map((column) => {
      const value = row[column.key];
      // Real numbers and dates keep their type so Excel can sort and total them.
      if (value instanceof Date) return value;
      if (typeof value === 'number') return value;
      return value ?? '';
    });
    sheetRow.commit();
  });

  // Number formats per column.
  result.columns.forEach((column, index) => {
    const sheetColumn = sheet.getColumn(index + 1);
    sheetColumn.width = Math.min(42, Math.max(12, column.label.length + 6));

    if (column.format === 'currency') sheetColumn.numFmt = '#,##0.00';
    else if (column.format === 'percent') sheetColumn.numFmt = '0.00"%"';
    else if (column.format === 'quantity') sheetColumn.numFmt = '#,##0.###';
    else if (column.format === 'number') sheetColumn.numFmt = '#,##0';
    else if (column.format === 'date') sheetColumn.numFmt = 'yyyy-mm-dd';
    else if (column.format === 'datetime') sheetColumn.numFmt = 'yyyy-mm-dd hh:mm';

    if (column.numeric) sheetColumn.alignment = { horizontal: 'right' };
  });

  const totals = totalsFor(result);
  if (Object.keys(totals).length > 0 && result.rows.length > 0) {
    const totalRow = sheet.getRow(headerRowIndex + result.rows.length + 1);
    totalRow.values = result.columns.map((column, index) =>
      index === 0 ? 'TOTAL' : (totals[column.key] ?? ''),
    );
    totalRow.font = { bold: true };
    totalRow.border = { top: { style: 'thin' } };
    totalRow.commit();
  }

  sheet.views = [{ state: 'frozen', ySplit: headerRowIndex }];
  sheet.autoFilter = {
    from: { row: headerRowIndex, column: 1 },
    to: { row: headerRowIndex, column: result.columns.length },
  };

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// --- PDF --------------------------------------------------------------------

export function toPdf(result: ReportResult, context: ExportContext): Buffer {
  // Wide tables need landscape, or the columns compress to nothing.
  const landscape = result.columns.length > 6;
  const doc = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' });

  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setFontSize(16);
  doc.text(context.companyName, 40, 44);

  doc.setFontSize(12);
  doc.text(context.reportName, 40, 64);

  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text(`${context.periodLabel} · generated ${context.generatedAt.toLocaleString()}`, 40, 80);
  doc.setTextColor(0);

  let startY = 96;

  if (result.summary?.length) {
    const line = result.summary.map((item) => `${item.label}: ${item.value}`).join('    ');
    doc.setFontSize(9);
    doc.text(line, 40, startY, { maxWidth: pageWidth - 80 });
    startY += 20;
  }

  const totals = totalsFor(result);
  const hasTotals = Object.keys(totals).length > 0 && result.rows.length > 0;

  autoTable(doc, {
    startY,
    head: [result.columns.map((column) => column.label)],
    body: result.rows.map((row) =>
      result.columns.map((column) => formatCell(row[column.key], column)),
    ),
    foot: hasTotals
      ? [
          result.columns.map((column, index) => {
            if (index === 0) return 'TOTAL';
            const value = totals[column.key];
            return value === undefined ? '' : value.toFixed(column.format === 'currency' ? 2 : 3);
          }),
        ]
      : undefined,
    styles: { fontSize: 7.5, cellPadding: 3, overflow: 'linebreak' },
    headStyles: { fillColor: [42, 120, 214], textColor: 255, fontStyle: 'bold' },
    footStyles: { fillColor: [241, 245, 249], textColor: 20, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [249, 250, 251] },
    columnStyles: Object.fromEntries(
      result.columns.map((column, index) => [index, { halign: column.numeric ? 'right' : 'left' }]),
    ),
    margin: { left: 40, right: 40, bottom: 40 },
    didDrawPage: () => {
      const page = doc.getNumberOfPages();
      doc.setFontSize(8);
      doc.setTextColor(140);
      doc.text(
        `Page ${page}`,
        pageWidth - 40,
        doc.internal.pageSize.getHeight() - 20,
        { align: 'right' },
      );
      doc.setTextColor(0);
    },
  });

  return Buffer.from(doc.output('arraybuffer'));
}

export const CONTENT_TYPES: Record<ExportFormat, string> = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
};

export type { ExportContext };
