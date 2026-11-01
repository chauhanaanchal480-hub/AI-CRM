import { prisma } from '../../lib/prisma.js';
import { logActivity } from '../../services/activity.service.js';
import { ApiError } from '../../utils/ApiError.js';

export interface RecordEmailInput {
  customerId: string;
  subject: string;
  body: string;
  direction: 'INBOUND' | 'OUTBOUND';
  toAddr: string;
  fromAddr: string;
}

export const emailsService = {
  async record(userId: string, input: RecordEmailInput) {
    const customer = await prisma.customer.findUnique({ where: { id: input.customerId } });
    if (!customer) throw ApiError.notFound('Customer not found');
    // Email logging remains inline because it is a small consistency-sensitive write.
    const email = await prisma.emailLog.create({ data: { ...input, userId } });
    await logActivity({
      type: 'EMAIL',
      summary: `${input.direction === 'OUTBOUND' ? 'Sent' : 'Received'}: ${input.subject}`,
      userId,
      customerId: input.customerId,
    });
    return email;
  },
};
