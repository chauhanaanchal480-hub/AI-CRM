import type { Role } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { ApiError } from '../../utils/ApiError.js';
import { hashPassword, verifyPassword } from '../../utils/password.js';
import { passwordSecurityService } from '../auth/password-security.service.js';

const publicUser = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
  avatarUrl: true,
  title: true,
  phone: true,
  isActive: true,
  createdAt: true,
} as const;

export interface UpdateProfileInput {
  firstName?: string;
  lastName?: string;
  title?: string;
  phone?: string;
  avatarUrl?: string;
}

export interface UpdateUserAccessInput {
  role?: Role;
  isActive?: boolean;
}

export const usersService = {
  listActive() {
    return prisma.user.findMany({
      where: { isActive: true },
      select: publicUser,
      orderBy: { firstName: 'asc' },
    });
  },

  updateProfile(userId: string, data: UpdateProfileInput) {
    return prisma.user.update({
      where: { id: userId },
      data: { ...data, avatarUrl: data.avatarUrl || null },
      select: publicUser,
    });
  },

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !(await verifyPassword(currentPassword, user.passwordHash))) {
      logger.warn({ event: 'auth.password_change_failed', userId }, 'Password change rejected: wrong current password');
      throw ApiError.badRequest('Current password is incorrect');
    }
    await passwordSecurityService.assertAllowed(user.id, newPassword);
    const passwordHash = await hashPassword(newPassword);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
    await passwordSecurityService.record(user.id, passwordHash);
    await prisma.refreshToken.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    logger.info({ event: 'auth.password_changed', userId: user.id }, 'Password changed');
    return { message: 'Password updated' };
  },

  updateAccess(actorId: string, userId: string, data: UpdateUserAccessInput) {
    if (userId === actorId) throw ApiError.forbidden('You cannot change your own role or status');
    return prisma.user.update({ where: { id: userId }, data, select: publicUser });
  },
};
