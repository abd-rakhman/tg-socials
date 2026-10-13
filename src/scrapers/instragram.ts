import { env } from "../env.js";
import { Media } from "../types/media.js";
import { IScraper } from "./scraper.js";

const UA = env.USER_AGENT ?? 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'

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
		const home = await fetch('https://www.instagram.com/', {
			headers: {
				'User-Agent': UA
			}
		});
		const csrf = home.headers.getSetCookie()
			.join(';')
			.match(/csrftoken=([^;]+)/)?.[1] ?? '';

		const res = await fetch('https://www.instagram.com/graphql/query', {
			method: 'POST',
			headers: {
				'User-Agent': UA,
				'X-IG-App-ID': '936619743392459',
				'X-CSRFToken': csrf,
				'Cookie': `csrftoken=${csrf}`,
				'Referer': 'https://www.instagram.com/',
			},
			body: new URLSearchParams({
				doc_id: '27128499623469141',
				variables: JSON.stringify({
					shortcode: code,
					__relay_internal__pv__PolarisAIGMMediaWebLabelEnabledrelayprovider: false,
				}),
				server_timestamps: 'true',
			}),
		})

		const json: any = await res.json()
		const post = json.data?.xdt_api__v1__media__shortcode__web_info?.items?.[0]

		if (!post) throw new Error(`Instagram: no post (${res.status})`);

		// media_type: 1 = photo, 2 = video, 8 = carousel (several items)
		const items = post.carousel_media ?? [post]
		return items.map((m: any) =>
			m.video_versions?.length
				? {
					type: 'video', url: m.video_versions[0].url
				}
				: {
					type: 'photo', url:
						m.image_versions2.candidates[0].url
				})
	}
}
