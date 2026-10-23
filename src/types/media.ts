export interface Media {
	type: 'photo' | 'video';
	url: string;
	headers?: Record<string, string>;
	width?: number;
	height?: number;
	duration?: number;
	thumbnail?: string;
}
