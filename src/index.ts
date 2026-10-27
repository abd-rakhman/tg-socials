import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { waitUntil } from '@vercel/functions'
import ffmpegPath from 'ffmpeg-static'
import { Hono } from 'hono'
import { Telegraf } from 'telegraf'
import { message } from 'telegraf/filters'
import { env } from './env.js'
import { Scraper } from './scrapers/scraper.js'
import { Media } from './types/media.js'

const app = new Hono()
const bot = new Telegraf(env.BOT_TOKEN, { handlerTimeout: 3 * 60 * 1000 });
const scraper = new Scraper();

bot.telegram.setWebhook(`${env.API_URL}/webhook`)
bot.catch((e) => console.error(e))

const download = async (url: string, headers?: Record<string, string>): Promise<Buffer> => {
	return Buffer.from(await fetch(url, { headers }).then((r) => r.arrayBuffer()) as ArrayBuffer)
}

const MB = 1000 * 1000
const compress = async (video: Buffer, duration?: number): Promise<Buffer> => {
	if (video.length > 300 * MB) throw new Error(`video size is too large: ${video.length}`)
	if (video.length <= 10 * MB) return video
	const dir = await mkdtemp(join(tmpdir(), 'video-'))
	const input = join(dir, 'in.mp4'), output = join(dir, 'out.mp4')
	try {
		await writeFile(input, video)
		const kbps = duration ? Math.floor(45 * 8000 / duration) - 128 : 0
		await promisify(execFile)(ffmpegPath as unknown as string, [
			'-v', 'fatal', '-max_error_rate', '1', '-y', '-i', input,
			'-fpsmax', '30',
			'-vf', 'scale=1280:1280:force_original_aspect_ratio=decrease:force_divisible_by=2',
			'-c:v', 'libx264', '-preset', 'veryfast',
			'-crf', '28',
			...(kbps > 0 ? ['-maxrate', `${kbps}k`, '-bufsize', `${kbps * 2}k`] : []),
			'-c:a', 'aac', '-b:a', '128k',
			'-movflags', '+faststart',
			output,
		])
		return await readFile(output)
	} finally {
		await rm(dir, { recursive: true, force: true })
	}
}

// joins separate video and audio tracks without re-encoding
const mergeVideoAndAudio = async (video: Buffer, audio: Buffer): Promise<Buffer> => {
	const dir = await mkdtemp(join(tmpdir(), 'merge-'))
	const videoPath = join(dir, 'video.mp4'), audioPath = join(dir, 'audio.m4a'), output = join(dir, 'out.mp4')
	try {
		await writeFile(videoPath, video)
		await writeFile(audioPath, audio)
		await promisify(execFile)(ffmpegPath as unknown as string, [
			'-v', 'fatal', '-y', '-i', videoPath, '-i', audioPath,
			'-map', '0:v:0', '-map', '1:a:0', '-c', 'copy',
			'-movflags', '+faststart',
			output,
		])
		return await readFile(output)
	} finally {
		await rm(dir, { recursive: true, force: true })
	}
}

// downloads video (+ separate audio track if any), merges them, compresses if too big
const downloadAndPrepareVideo = async (media: Media): Promise<Buffer> => {
	const [video, audio] = await Promise.all([
		download(media.url, media.headers),
		media.audioUrl ? download(media.audioUrl, media.headers) : undefined,
	])
	return compress(audio ? await mergeVideoAndAudio(video, audio) : video, media.duration)
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
						source: media.type === 'video'
							? await downloadAndPrepareVideo(media)
							: await download(media.url, media.headers),
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

	waitUntil(bot.handleUpdate(update).catch((e) => console.error(e)))

	return c.json({ ok: true })
})


export default app
