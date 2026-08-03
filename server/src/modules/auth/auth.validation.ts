import { z } from 'zod';

/**
 * Strong password policy: length + upper/lower/digit. The min-length message
 * is surfaced verbatim in the register form.
 */
export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters')
  .regex(/[a-z]/, 'Password must contain a lowercase letter')
  .regex(/[A-Z]/, 'Password must contain an uppercase letter')
  .regex(/[0-9]/, 'Password must contain a digit');

export const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: passwordSchema,
  firstName: z.string().trim().min(1).max(60),
  lastName: z.string().trim().min(1).max(60),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(128),
});

export const mfaCodeSchema = z.string().trim().min(6).max(32);

export const mfaVerifySchema = z.object({
  challengeToken: z.string().min(32).max(256),
  code: mfaCodeSchema,
  rememberDevice: z.boolean().default(false),
});

export const mfaCodeBodySchema = z.object({ code: mfaCodeSchema });

export const stepUpSchema = z.object({
  password: z.string().min(1).max(128).optional(),
  code: mfaCodeSchema.optional(),
}).refine((value) => Boolean(value.password || value.code), {
  message: 'Password or authentication code is required',
});

export const trustedDeviceIdParam = z.object({
  trustedDeviceId: z.string().cuid('Invalid trusted device id'),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1).max(4096).optional(),
}).default({});

export const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1).max(2048),
  password: passwordSchema,
});

export const sessionIdParam = z.object({
  sessionId: z.string().uuid('Invalid session id'),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
