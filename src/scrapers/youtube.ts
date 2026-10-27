import { env } from "../env.js";
import { Media } from "../types/media.js";
import { IScraper } from "./scraper.js";

// iOS app client: returns direct stream URLs without a login
const UA = 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)'
// YouTube blocks cloud IPs (Vercel), so then we ask an Invidious server, it fetches and streams the video for us
const INVIDIOUS_URL = env.INVIDIOUS_URL ?? 'https://yt.chocolatemoo53.com'
const MB = 1000 * 1000;

interface Format {
	url: string;
	mimeType: string;
	width?: number;
	height?: number;
	bitrate: number;
	contentLength?: number;
}

interface Video {
	formats: Array<Format>;
	duration?: number;
	headers?: Record<string, string>;
}

export class YoutubeScraper implements IScraper {
	domains = ['youtube.com', 'www.youtube.com', 'm.youtube.com']
	private parseIdFromURL(url: string): (string | null) {
		const urlObject = new URL(url);
		const hostname = urlObject.hostname.toLowerCase();
		if (!this.domains.some(domain => hostname === domain)) {
			return null;
		}
		return urlObject.pathname.match(/^\/shorts\/([\w-]{11})/)?.[1] ?? null;
	}

	isScrapable(url: string): boolean {
		return this.parseIdFromURL(url) !== null;
	}

	private async fetchDirect(id: string): Promise<Video> {
		const res = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
			method: 'POST',
			headers: {
				'User-Agent': UA,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				videoId: id,
				context: {
					client: {
						clientName: 'IOS',
						clientVersion: '20.10.4',
						deviceModel: 'iPhone16,2',
						hl: 'en',
					},
				},
			}),
		})

		const json: any = await res.json()
		const formats: any[] = json.streamingData?.adaptiveFormats ?? []
		if (!formats.length) throw new Error(`Youtube: no video (${json.playabilityStatus?.status}: ${json.playabilityStatus?.reason})`);
		return {
			formats: formats.map((f) => ({
				url: f.url,
				mimeType: f.mimeType,
				width: f.width,
				height: f.height,
				bitrate: f.bitrate,
				contentLength: Number(f.contentLength) || undefined,
			})),
			duration: Number(json.videoDetails?.lengthSeconds) || undefined,
			headers: { 'User-Agent': UA },
		}
	}

	private async fetchInvidious(id: string): Promise<Video> {
		// local=true: stream URLs point to the Invidious server, not to YouTube
		const res = await fetch(`${INVIDIOUS_URL}/api/v1/videos/${id}?local=true`)
		const json: any = await res.json()
		const formats: any[] = json.adaptiveFormats ?? []
		if (!formats.length) throw new Error(`Youtube: no video from Invidious (${res.status}: ${json.error})`);
		return {
			formats: formats.map((f) => {
				const [width, height] = (f.size ?? '').split('x').map(Number)
				return {
					url: f.url,
					mimeType: f.type,
					width,
					height,
					bitrate: Number(f.bitrate),
					contentLength: Number(f.clen) || undefined,
				}
			}),
			duration: Number(json.lengthSeconds) || undefined,
		}
	}

	async scrape(url: string): Promise<Array<Media>> {
		const id = this.parseIdFromURL(url);
		if (!id) throw Error(`Youtube: invalid URL: ${url}`)
		const { formats, duration, headers } = await this.fetchDirect(id).catch((e) => {
			console.error(e)
			return this.fetchInvidious(id)
		})

		// video and audio come separately, index.ts joins them with ffmpeg
		// H.264 up to 720p: plays everywhere in Telegram and stays small
		const v = formats
			.filter((f) => f.url && f.mimeType.startsWith('video/mp4; codecs="avc1') && f.width && f.height && Math.min(f.width, f.height) <= 720)
			.reduce<Format | null>((a, b) => (!a || b.width! * b.height! > a.width! * a.height! ? b : a), null)
		// videos with auto-dubs have one audio track per language, the original one is tagged in the URL: xtags=acont=original:lang=en-US
		const audios = formats.filter((f) => f.url && f.mimeType.startsWith('audio/mp4'))
		const originals = audios.filter((f) => new URL(f.url, INVIDIOUS_URL).searchParams.get('xtags')?.includes('acont=original'))
		const a = (originals.length ? originals : audios)
			.reduce<Format | null>((a, b) => (!a || b.bitrate > a.bitrate ? b : a), null)
		if (!v) throw new Error(`Youtube: no mp4 video`);

		const size = (v.contentLength ?? 0) + (a?.contentLength ?? 0)
		if (size > 300 * MB) throw Error(`Youtube: video size is too large: ${size}`);
		return [{
			type: 'video',
			url: v.url,
			audioUrl: a?.url,
			headers,
			width: v.width,
			height: v.height,
			duration,
			thumbnail: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
		}];
	}
}
