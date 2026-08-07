import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { finished } from 'node:stream/promises';
import type { Writable } from 'node:stream';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { z } from 'zod';
import type { Prisma, Role } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { env } from '../../config/env.js';
import { runQueuedJob } from '../../performance/queue.js';

const exportJobSchema = z.object({
  entity: z.enum(['customers', 'leads', 'deals']),
  format: z.enum(['excel', 'pdf']),
  role: z.enum(['ADMIN', 'SALES_MANAGER', 'EMPLOYEE']),
  userId: z.string().cuid(),
});

export type ExportEntity = z.infer<typeof exportJobSchema>['entity'];
export type ExportFormat = z.infer<typeof exportJobSchema>['format'];
export type ExportJob = z.infer<typeof exportJobSchema>;

interface ExportRow {
  cursor: string;
  cells: (string | number)[];
}

const exportDirectory = path.resolve(env.EXPORT_DIR);

function customerScope(role: Role, id: string): Prisma.CustomerWhereInput {
  return role === 'EMPLOYEE' ? { ownerId: id } : {};
}

export function columnsFor(entity: ExportEntity) {
  if (entity === 'customers') return ['Name', 'Company', 'Email', 'Phone', 'Status', 'Owner', 'Created'];
  if (entity === 'leads') return ['Title', 'Status', 'Source', 'Value', 'Contact', 'Email', 'Created'];
  return ['Title', 'Customer', 'Stage', 'Value', 'Status', 'Probability', 'Created'];
}

async function fetchRows(job: Pick<ExportJob, 'entity' | 'role' | 'userId'>, cursor?: string): Promise<ExportRow[]> {
  const page = { take: env.EXPORT_BATCH_SIZE, orderBy: { id: 'asc' as const }, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) };
  if (job.entity === 'customers') {
    const rows = await prisma.customer.findMany({
      where: customerScope(job.role, job.userId),
      ...page,
      select: {
        id: true, name: true, company: true, email: true, phone: true, status: true, createdAt: true,
        owner: { select: { firstName: true, lastName: true } },
      },
    });
    return rows.map((row) => ({
      cursor: row.id,
      cells: [row.name, row.company ?? '', row.email ?? '', row.phone ?? '', row.status, `${row.owner.firstName} ${row.owner.lastName}`, row.createdAt.toISOString().slice(0, 10)],
    }));
  }
  if (job.entity === 'leads') {
    const rows = await prisma.lead.findMany({
      where: job.role === 'EMPLOYEE' ? { assignedToId: job.userId } : {},
      ...page,
      select: { id: true, title: true, status: true, source: true, value: true, contactName: true, contactEmail: true, createdAt: true },
    });
    return rows.map((row) => ({
      cursor: row.id,
      cells: [row.title, row.status, row.source, Number(row.value), row.contactName ?? '', row.contactEmail ?? '', row.createdAt.toISOString().slice(0, 10)],
    }));
  }
  const rows = await prisma.deal.findMany({
    where: job.role === 'EMPLOYEE' ? { ownerId: job.userId } : {},
    ...page,
    select: {
      id: true, title: true, value: true, status: true, probability: true, createdAt: true,
      customer: { select: { name: true } },
      stage: { select: { name: true } },
    },
  });
  return rows.map((row) => ({
    cursor: row.id,
    cells: [row.title, row.customer.name, row.stage.name, Number(row.value), row.status, `${row.probability}%`, row.createdAt.toISOString().slice(0, 10)],
  }));
}

async function* iterateRows(job: Pick<ExportJob, 'entity' | 'role' | 'userId'>) {
  let cursor: string | undefined;
  do {
    const rows = await fetchRows(job, cursor);
    for (const row of rows) yield row.cells;
    cursor = rows.at(-1)?.cursor;
    if (rows.length < env.EXPORT_BATCH_SIZE) break;
  } while (cursor);
}

async function writeExcel(job: ExportJob, destination: Writable) {
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    stream: destination,
    useStyles: true,
    useSharedStrings: false,
  });
  workbook.creator = 'AI-CRM';
  const worksheet = workbook.addWorksheet(job.entity);
  const header = worksheet.addRow(columnsFor(job.entity));
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF6366F1' } };
  header.commit();
  worksheet.columns.forEach((column) => { column.width = 22; });
  for await (const row of iterateRows(job)) worksheet.addRow(row).commit();
  worksheet.commit();
  await workbook.commit();
}

async function writePdf(job: ExportJob, destination: Writable) {
  const columns = columnsFor(job.entity);
  const document = new PDFDocument({ margin: 36, size: 'A4', layout: 'landscape' });
  document.pipe(destination);
  document.fontSize(18).fillColor('#111827').text(`${job.entity.toUpperCase()} EXPORT`, { align: 'left' });
  document.fontSize(9).fillColor('#6b7280').text(`Generated ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`);
  document.moveDown(0.8);
  const pageWidth = document.page.width - 72;
  const columnWidth = pageWidth / columns.length;
  const drawRow = (cells: (string | number)[], bold: boolean) => {
    const y = document.y;
    document.fontSize(8).font(bold ? 'Helvetica-Bold' : 'Helvetica').fillColor(bold ? '#111827' : '#374151');
    cells.forEach((cell, index) => {
      document.text(String(cell), 36 + index * columnWidth, y, { width: columnWidth - 6, ellipsis: true });
    });
    document.moveDown(0.4);
    document.moveTo(36, document.y).lineTo(36 + pageWidth, document.y).strokeColor('#e5e7eb').lineWidth(0.5).stroke();
    document.moveDown(0.2);
  };
  drawRow(columns, true);
  for await (const row of iterateRows(job)) {
    if (document.y > document.page.height - 60) {
      document.addPage();
      drawRow(columns, true);
    }
    drawRow(row, false);
  }
  document.end();
}

export async function writeExport(job: ExportJob, destination: Writable) {
  if (job.format === 'excel') await writeExcel(job, destination);
  else await writePdf(job, destination);
  if (!destination.writableFinished) await finished(destination);
}

export async function processExportJob(input: unknown) {
  const job = exportJobSchema.parse(input);
  await fs.promises.mkdir(exportDirectory, { recursive: true });
  const extension = job.format === 'excel' ? 'xlsx' : 'pdf';
  const filename = `${crypto.randomUUID()}.${extension}`;
  const outputPath = path.join(exportDirectory, filename);
  const destination = fs.createWriteStream(outputPath, { flags: 'wx', mode: 0o600 });
  try {
    await writeExport(job, destination);
    const stat = await fs.promises.stat(outputPath);
    return { filename, size: stat.size };
  } catch (error) {
    destination.destroy();
    await fs.promises.rm(outputPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export function prepareExport(job: ExportJob) {
  return runQueuedJob({
    queue: 'export',
    name: `${job.entity}-${job.format}`,
    payload: job,
    fallback: () => processExportJob(job),
    priority: 7,
  });
}

export function resolvePreparedExport(filename: string) {
  const safeName = path.basename(filename);
  const resolved = path.resolve(exportDirectory, safeName);
  if (safeName !== filename || path.dirname(resolved) !== exportDirectory) throw new Error('Invalid export filename');
  return resolved;
}

export async function cleanupPreparedExports(maxAgeMs = 24 * 3_600_000) {
  const cutoff = Date.now() - maxAgeMs;
  const entries = await fs.promises.readdir(exportDirectory, { withFileTypes: true }).catch(() => []);
  let removed = 0;
  // Cleanup is intentionally sequential: a large export directory must not
  // create one stat/unlink promise (and file descriptor) per entry.
  for (const entry of entries) {
    if (!entry.isFile() || !/^[0-9a-f-]+\.(?:xlsx|pdf)$/i.test(entry.name)) continue;
    const file = path.join(exportDirectory, entry.name);
    const stat = await fs.promises.stat(file).catch(() => null);
    if (stat && stat.mtimeMs < cutoff) {
      await fs.promises.rm(file, { force: true });
      removed += 1;
    }
  }
  return { removed };
}
