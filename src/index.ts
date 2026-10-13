import { Hono } from 'hono'
import { Telegraf } from 'telegraf'
import { message } from 'telegraf/filters'
import { env } from './env.js'
import { Scraper } from './scrapers/scraper.js'

const app = new Hono()
const bot = new Telegraf(env.BOT_TOKEN);
const scraper = new Scraper();

bot.telegram.setWebhook(`${env.API_URL}/webhook`)

const isEligibleUser = async (ctx: any): Promise<boolean> => {
	const userIds = env.USER_IDS ?? [];
	if (userIds.length == 0) return true;

	const members = await Promise.all(userIds.map(async (userId) => {
		return await ctx.telegram.getChatMember(ctx.chat.id, userId).catch(() => null)
	}))
	const ok = members.some((m) => m && m.status !== 'left' && m.status !== 'kicked')
	return ok;
}

bot.on(message('text'), async (ctx) => {
	if (!await isEligibleUser(ctx)) {
		return
	}

	const urls = ctx.message.entities
		?.filter((entity) => entity.type === "url")
		.map((entity) =>
			ctx.message.text.slice(entity.offset, entity.offset + entity.length)
		)

	if (!urls?.length) return

	for (const url of urls) {
		const medias = await scraper.scrape(url).catch((e) => {
			console.error(url, e)
			return []
		})
		for (let i = 0; i < medias.length; i += 10) {
			const group = await Promise.all(
				medias.slice(i, i + 10).map(async (media) => ({
					type: media.type,
					media: {
						source: Buffer.from(await fetch(media.url, { headers: media.headers }).then((r) => r.arrayBuffer()) as ArrayBuffer),
						filename: media.type === 'video' ? 'video.mp4' : 'photo.jpg',
					},
				}))
			)
			if (group.length == 0) return;
			await ctx.telegram.sendMediaGroup(
				ctx.chat.id,
				group,
				{
					reply_parameters: {
						message_id: ctx.msg.message_id
					}
				},
			);
		}
	}
})

app.get('/', (c) => {
	return c.json({
		message: 'Welcome'
	})
})


app.post('/webhook', async (c) => {
	const update = await c.req.json()

	await bot.handleUpdate(update)

	return c.json({ ok: true })
})


export default app
