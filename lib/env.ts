import { z } from 'zod';

const optionalUrl = z
  .union([z.string().url(), z.literal('')])
  .optional();

const envSchema = z.object({
  MINIMAX_API_KEY: z.string().optional(),
  DEEPSEEK_API_KEY: z.string().optional(),
  DEEPSEEK_MODEL: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_API_ENDPOINT: z.string().url().optional(),
  OPENAI_MODEL: z.string().optional(),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),
  CALENDLY_URL: optionalUrl,
  SETUP_TOKEN: z.string().optional()
});

export function getEnv() {
  return envSchema.parse(process.env);
}
