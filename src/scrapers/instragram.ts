import { Media } from "../types/media.js";
import { IScraper } from "./scraper.js";

// yt-dlp pattern: the post code is the media id in base 64 with this alphabet
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

export class InstagramScraper implements IScraper {
	domains = ['instagram.com', 'www.instagram.com']
	private parseCodeFromURL(url: string): (string | null) {
		const urlObject = new URL(url);
		const hostname = urlObject.hostname.toLowerCase();
		if (!this.domains.some(domain => hostname === domain)) {
			return null;
		}
		const code = urlObject.pathname.match(/\/(?:p|reel)\/([^/]+)/)?.[1];
		return code ?? null;
	}

	isScrapable(url: string): boolean {
		return this.parseCodeFromURL(url) !== null;
	}

	async scrape(url: string): Promise<Array<Media>> {
		const code = this.parseCodeFromURL(url);
		if (!code) throw Error(`Instagram: invalid URL: {url}`)
		const id = [...code].reduce((n, c) => n * 64n + BigInt(ALPHABET.indexOf(c)), 0n);

		// yt-dlp pattern: the logged-out post query, it needs the LSD token from the home page
		const home = await fetch('https://www.instagram.com/');
		const lsd = (await home.text()).match(/"LSD",\[\],\{"token":"([^"]+)"/)?.[1] ?? '';
		const res = await fetch('https://www.instagram.com/api/graphql', {
			method: 'POST',
			headers: {
				'X-FB-LSD': lsd,
			},
			body: new URLSearchParams({
				lsd,
				doc_id: '27130156389949648',
				variables: JSON.stringify({ media_id: id.toString() }),
			}),
		})

		const json: any = await res.json()
		const post = json.data?.xig_polaris_media?.if_not_gated_logged_out

		if (!post) throw new Error(`Instagram: no post (${res.status})`);

		// media_type: 1 = photo, 2 = video, 8 = carousel (several items)
		const items = post.carousel_media ?? [post]
		return items.map((m: any) => {
			if (!m.video_versions?.length) {
				return { type: 'photo', url: m.image_versions2.candidates[0].url }
			}
			// smallest version: plays faster in Telegram
			const v = m.video_versions.reduce((a: any, b: any) => (b.width < a.width ? b : a))
			// smallest cover: Telegram wants thumbnails up to 320px
			const cover = m.image_versions2?.candidates?.reduce((a: any, b: any) => (b.width < a.width ? b : a))
			return {
				type: 'video',
				url: v.url,
				width: v.width ?? m.original_width,
				height: v.height ?? m.original_height,
				duration: Math.round(m.video_duration ?? 0) || undefined,
				thumbnail: cover?.url,
			}
		})
	}
}
