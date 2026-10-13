import { z } from "zod"

export const env = z.object({
	BOT_TOKEN: z.string(),
	API_URL: z.url(),
	USER_IDS: z
		.string()
		.optional()
		.transform((val) => val?.split(",").map((s) => parseInt(s.trim()))),

	USER_AGENT: z.string().optional(),
}).parse(process.env)
