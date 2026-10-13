export interface Media {
	type: 'photo' | 'video';
	url: string;
	headers?: Record<string, string>;
}
