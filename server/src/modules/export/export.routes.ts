import { Router } from 'express';
import { z } from 'zod';
import type { Request, Response } from 'express';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import type { Prisma, Role } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { authenticate } from '../../middleware/authenticate.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ApiError } from '../../utils/ApiError.js';
import { exportRateLimiter } from '../../middleware/rateLimit.js';

const params = z.object({ entity: z.enum(['customers', 'leads', 'deals']) });

function customerScope(role: Role, id: string): Prisma.CustomerWhereInput {
  return role === 'EMPLOYEE' ? { ownerId: id } : {};
}

async function loadRows(entity: string, role: Role, userId: string) {
  if (entity === 'customers') {
    const rows = await prisma.customer.findMany({
      where: customerScope(role, userId),
      include: { owner: { select: { firstName: true, lastName: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return {
      columns: ['Name', 'Company', 'Email', 'Phone', 'Status', 'Owner', 'Created'],
      data: rows.map((c) => [c.name, c.company ?? '', c.email ?? '', c.phone ?? '', c.status, `${c.owner.firstName} ${c.owner.lastName}`, c.createdAt.toISOString().slice(0, 10)]),
    };
  }
  if (entity === 'leads') {
    const rows = await prisma.lead.findMany({
      where: role === 'EMPLOYEE' ? { assignedToId: userId } : {},
      orderBy: { createdAt: 'desc' },
    });
    return {
      columns: ['Title', 'Status', 'Source', 'Value', 'Contact', 'Email', 'Created'],
      data: rows.map((l) => [l.title, l.status, l.source, Number(l.value), l.contactName ?? '', l.contactEmail ?? '', l.createdAt.toISOString().slice(0, 10)]),
    };
  }
  const rows = await prisma.deal.findMany({
    where: role === 'EMPLOYEE' ? { ownerId: userId } : {},
    include: { customer: { select: { name: true } }, stage: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return {
    columns: ['Title', 'Customer', 'Stage', 'Value', 'Status', 'Probability', 'Created'],
    data: rows.map((d) => [d.title, d.customer.name, d.stage.name, Number(d.value), d.status, `${d.probability}%`, d.createdAt.toISOString().slice(0, 10)]),
  };
}

export const exportRouter = Router();
exportRouter.use(authenticate, exportRateLimiter);

// Excel export: GET /export/:entity/excel
exportRouter.get(
  '/:entity/excel',
  validate({ params }),
  asyncHandler(async (req: Request, res: Response) => {
    const { entity } = req.params as z.infer<typeof params>;
    const { columns, data } = await loadRows(entity, req.user!.role, req.user!.sub);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'AI-CRM';
    const ws = wb.addWorksheet(entity);
    ws.addRow(columns);
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF6366F1' } };
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    data.forEach((row) => ws.addRow(row));
    ws.columns.forEach((col) => { col.width = 22; });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${entity}-${Date.now()}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  }),
);

// PDF export: GET /export/:entity/pdf
exportRouter.get(
  '/:entity/pdf',
  validate({ params }),
  asyncHandler(async (req: Request, res: Response) => {
    const { entity } = req.params as z.infer<typeof params>;
    const { columns, data } = await loadRows(entity, req.user!.role, req.user!.sub);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${entity}-${Date.now()}.pdf"`);

    const doc = new PDFDocument({ margin: 36, size: 'A4', layout: 'landscape' });
    doc.pipe(res);

    doc.fontSize(18).fillColor('#111827').text(`${entity.toUpperCase()} EXPORT`, { align: 'left' });
    doc.fontSize(9).fillColor('#6b7280').text(`Generated ${new Date().toISOString().slice(0, 19).replace('T', ' ')} · ${data.length} records`);
    doc.moveDown(0.8);

    const pageWidth = doc.page.width - 72;
    const colWidth = pageWidth / columns.length;
    const drawRow = (cells: (string | number)[], bold: boolean) => {
      const y = doc.y;
      doc.fontSize(8).font(bold ? 'Helvetica-Bold' : 'Helvetica').fillColor(bold ? '#111827' : '#374151');
      cells.forEach((cell, i) => {
        doc.text(String(cell), 36 + i * colWidth, y, { width: colWidth - 6, ellipsis: true });
      });
      doc.moveDown(0.4);
      doc.moveTo(36, doc.y).lineTo(36 + pageWidth, doc.y).strokeColor('#e5e7eb').lineWidth(0.5).stroke();
      doc.moveDown(0.2);
    };

    drawRow(columns, true);
    for (const row of data) {
      if (doc.y > doc.page.height - 60) doc.addPage();
      drawRow(row, false);
    }
    doc.end();
  }),
);

// Guard unknown export params early with a clear error.
exportRouter.use((req, _res, next) => next(ApiError.notFound(`Unknown export route ${req.path}`)));
