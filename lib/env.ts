import { z } from 'zod';

const optionalUrl = z
  .union([z.string().url(), z.literal('')])
  .optional();

const envSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: optionalUrl,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  SUPABASE_SECRET_KEY: z.string().optional(),
  MINIMAX_API_KEY: z.string().optional(),
  DEEPSEEK_API_KEY: z.string().optional(),
  DEEPSEEK_MODEL: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_API_ENDPOINT: z.string().url().optional(),
  OPENAI_MODEL: z.string().optional(),
  MONDAY_API_TOKEN: z.string().optional(),
  MONDAY_BOARD_ID: z.string().optional(),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),
  CALENDLY_URL: optionalUrl,
  SETUP_TOKEN: z.string().optional()
});

export function getEnv() {
  return envSchema.parse(process.env);
}
