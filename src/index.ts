import { Hono } from 'hono'
import { Telegraf } from 'telegraf'
import { message } from 'telegraf/filters'
import { env } from './env.js'
import { Scraper } from './scrapers/scraper.js'

const app = new Hono()
const bot = new Telegraf(env.BOT_TOKEN);
const scraper = new Scraper();

bot.telegram.setWebhook(`${env.API_URL}/webhook`)

const download = async (url: string, headers?: Record<string, string>): Promise<Buffer> => {
	return Buffer.from(await fetch(url, { headers }).then((r) => r.arrayBuffer()) as ArrayBuffer)
}

// thumbnail is optional: on failure send the video without it
const downloadThumbnail = async (url?: string, headers?: Record<string, string>) => {
	if (!url) return undefined
	const res = await fetch(url, { headers }).catch((e) => {
		console.error(url, e)
		return null
	})
	if (!res?.ok) return undefined
	const source = await res.arrayBuffer().then((b) => Buffer.from(b)).catch(() => null)
	return source ? { source, filename: 'thumbnail.jpg' } : undefined
}

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
						source: await download(media.url, media.headers),
						filename: media.type === 'video' ? 'video.mp4' : 'photo.jpg',
					},
					...(media.type === 'video' && {
						supports_streaming: true,
						width: media.width,
						height: media.height,
						duration: media.duration,
						thumbnail: await downloadThumbnail(media.thumbnail, media.headers),
					}),
				}))
			)
			if (group.length == 0) return;
			await ctx.telegram.sendMediaGroup(
				ctx.chat.id,
				group,
				{
					// telegraf only JSON-encodes known fields in multipart uploads, and reply_parameters isn't one
					reply_parameters: JSON.stringify({ message_id: ctx.msg.message_id }) as any,
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
