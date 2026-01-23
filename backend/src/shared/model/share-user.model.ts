import z from 'zod'

export const UserSchema = z.object({
  id: z.number(),
  email: z.string().email(),
  emailVerified: z.boolean(),
  password: z
    .string()
    .min(8)
    .max(32)
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/\d/, 'Password must contain at least one number')
    .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character')
    .refine((val) => !/\s/.test(val), 'Password must not contain spaces'),
  createdAt: z.iso.datetime(),
  deletedAt: z.iso.datetime().nullable(),
  updatedAt: z.iso.datetime().nullable(),
})

export type UserType = z.infer<typeof UserSchema>