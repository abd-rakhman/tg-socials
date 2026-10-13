import { env } from "../env.js";
import { Media } from "../types/media.js";
import { IScraper } from "./scraper.js";

const UA = env.USER_AGENT ?? 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
const MB = 1000 * 1000;

export class TiktokScraper implements IScraper {
	domains = ['tiktok.com', 'vt.tiktok.com', 'vm.tiktok.com', 'www.tiktok.com', 'm.tiktok.com']
	isScrapable(url: string): boolean {
		const urlObject = new URL(url);
		const hostname = urlObject.hostname.toLowerCase();
		return this.domains.some(domain => hostname === domain);
	}

	async scrape(url: string): Promise<Array<Media>> {
		const { url: fullUrl } = await fetch(url, {
			method: 'HEAD',
			headers: {
				'User-Agent': UA
			}
		});
		const page = await fetch(fullUrl.replace('/photo/', '/video/'), {
			headers: {
				'User-Agent': UA
			}
		});
		const token = page.headers.getSetCookie()
			.join(';')
			.match(/tt_chain_token=([^;]+)/)?.[1] ?? '';
		const headers = {
			'User-Agent': UA,
			'Referer': 'https://www.tiktok.com/',
			'Cookie': `tt_chain_token=${token}`,
		};

		const html = await page.text();
		const data = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>(.*?)<\/script>/s)?.[1];
		const post = data && JSON.parse(data).__DEFAULT_SCOPE__?.['webapp.video-detail']?.itemInfo?.itemStruct;
		if (!post) throw new Error(`Tiktok: no post (${page.status})`);

		if (post.imagePost) {
			return post.imagePost.images.map((m: any) => ({
				type: 'photo',
				url: m.imageURL.urlList[0],
				headers,
			}));
		}

		if (post.video.size > 40 * MB) throw Error(`Tiktok: video size is too large: ${post.video.size}`);
		return [{
			type: 'video',
			url: post.video.playAddr,
			headers,
		}];
	}
}
