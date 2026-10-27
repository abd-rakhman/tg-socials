import { Media } from "../types/media.js";
import { IScraper } from "./scraper.js";

// iOS app client: returns direct stream URLs without a login
const UA = 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)'
const MB = 1000 * 1000;

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

	async scrape(url: string): Promise<Array<Media>> {
		const id = this.parseIdFromURL(url);
		if (!id) throw Error(`Youtube: invalid URL: ${url}`)
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

		// video and audio come separately, index.ts joins them with ffmpeg
		// H.264 up to 720p: plays everywhere in Telegram and stays small
		const v = formats
			.filter((f) => f.url && f.mimeType.startsWith('video/mp4; codecs="avc1') && Math.min(f.width, f.height) <= 720)
			.reduce((a, b) => (!a || b.width * b.height > a.width * a.height ? b : a), null)
		const a = formats
			.filter((f) => f.url && f.mimeType.startsWith('audio/mp4'))
			.reduce((a, b) => (!a || b.bitrate > a.bitrate ? b : a), null)
		if (!v) throw new Error(`Youtube: no mp4 video`);

		const size = Number(v.contentLength ?? 0) + Number(a?.contentLength ?? 0)
		if (size > 300 * MB) throw Error(`Youtube: video size is too large: ${size}`);
		return [{
			type: 'video',
			url: v.url,
			audioUrl: a?.url,
			headers: { 'User-Agent': UA },
			width: v.width,
			height: v.height,
			duration: Number(json.videoDetails?.lengthSeconds) || undefined,
			thumbnail: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
		}];
	}
}
