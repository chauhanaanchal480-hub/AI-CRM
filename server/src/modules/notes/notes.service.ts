import type { Role } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { logActivity } from '../../services/activity.service.js';
import { invalidateCache } from '../../performance/cache.js';
import { ApiError } from '../../utils/ApiError.js';

interface Actor { id: string; role: Role; }

export const notesService = {
  async create(actor: Actor, input: { customerId: string; body: string }) {
    const customer = await prisma.customer.findUnique({ where: { id: input.customerId } });
    if (!customer) throw ApiError.notFound('Customer not found');
    const note = await prisma.note.create({
      data: { customerId: input.customerId, body: input.body, userId: actor.id },
      include: { user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } },
    });
    await logActivity({
      type: 'NOTE',
      summary: input.body.slice(0, 120),
      userId: actor.id,
      customerId: input.customerId,
    });
    return note;
  },

  async remove(actor: Actor, id: string) {
    const note = await prisma.note.findUnique({ where: { id } });
    if (!note) throw ApiError.notFound('Note not found');
    if (actor.role === 'EMPLOYEE' && note.userId !== actor.id) {
      throw ApiError.forbidden('You can only delete your own notes');
    }
    await prisma.note.delete({ where: { id } });
    await invalidateCache(`customer:${note.customerId}`, `ai:customer:${note.customerId}`);
    return { id };
  },
};
