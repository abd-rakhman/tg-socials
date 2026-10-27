import { Media } from "../types/media.js";
import { InstagramScraper } from "./instragram.js";
import { TiktokScraper } from "./tiktok.js";
import { YoutubeScraper } from "./youtube.js";

export interface IScraper {
	isScrapable(url: string): boolean;
	scrape(url: string): Promise<Array<Media>>;
}

export class Scraper implements IScraper {
	scrapers: Array<IScraper> = [
		new InstagramScraper(),
		new TiktokScraper(),
		new YoutubeScraper(),
	];

	isScrapable(url: string): boolean {
		return this.scrapers.some(scraper => scraper.isScrapable(url));
	}

	async scrape(url: string): Promise<Array<Media>> {
		const scraper = this.scrapers.find(scraper => scraper.isScrapable(url));
		if (!scraper) throw new Error(`No scraper for URL: ${url}`);
		return scraper.scrape(url);
	}
}
