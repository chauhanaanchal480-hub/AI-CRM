import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../utils/ApiError.js';

export const notificationsService = {
  async list(userId: string) {
    const [items, unread] = await Promise.all([
      prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      prisma.notification.count({ where: { userId, read: false } }),
    ]);
    return { items, unread };
  },

  async markRead(userId: string, id: string) {
    const notification = await prisma.notification.findUnique({ where: { id } });
    if (!notification || notification.userId !== userId) {
      throw ApiError.notFound('Notification not found');
    }
    return prisma.notification.update({ where: { id }, data: { read: true } });
  },

  async markAllRead(userId: string) {
    await prisma.notification.updateMany({ where: { userId, read: false }, data: { read: true } });
    return { message: 'All notifications marked as read' };
  },
};
