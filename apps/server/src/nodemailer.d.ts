declare module 'nodemailer' {
	export function createTransport(options: {
		host: string;
		port: number;
		secure: boolean;
		auth: { user: string; pass: string };
	}): {
		sendMail(message: {
			from: string;
			to: string;
			subject: string;
			text: string;
			html: string;
		}): Promise<unknown>;
	};
}
