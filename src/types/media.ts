export interface Media {
	type: 'photo' | 'video';
	url: string;
	// separate audio track, joined with the video before sending
	audioUrl?: string;
	headers?: Record<string, string>;
	width?: number;
	height?: number;
	duration?: number;
	thumbnail?: string;
}
