import { readerFromStreamReader } from "https://deno.land/std@0.170.0/streams/reader_from_stream_reader.ts";
import { WebClient, LogLevel } from "https://deno.land/x/slack_web_api@6.7.2/mod.js"
import { ensureDir } from "https://deno.land/std@0.170.0/fs/ensure_dir.ts";
import { copy } from "https://deno.land/std@0.170.0/streams/copy.ts";
import config from "./config.json" assert { type: "json" }

const client = new WebClient(config.token, { logLevel: LogLevel.DEBUG });
Deno.serve({ port: 60626 }, async (req) => {
	let urlPath = new URL(req.url).pathname;
	if (!urlPath.endsWith('/'))
		urlPath += '/';

 	if (urlPath == '/auth/') {
		try {
			const accessObj = {
				client_id: config.auth.SLACK_CLIENT_ID,
				client_secret: config.auth.SLACK_CLIENT_SECRET,
				code: new URL(req.url).searchParams.get('code')!,
			};

			const response = await client.oauth.v2.access({
				client_id: config.auth.SLACK_CLIENT_ID,
				client_secret: config.auth.SLACK_CLIENT_SECRET,
				code: new URL(req.url).searchParams.get('code')!
			});

			// At this point you can assume the user has logged in successfully with their account.
			return new Response(JSON.stringify(response), {
				"headers": { "Content-Type": "application/json" },
				"status": 200
			});
		} catch (eek) {
			console.error(eek);
			return new Response(JSON.stringify(eek), {
				"headers": { "Content-Type": "application/json" },
				"status": 500
			});
		}
	} else if (urlPath == '/commands/scrape/') {
		const channelConfig = new URLSearchParams(await req.text());
		if (channelConfig.get("user_id") !== "U04DCRDL370")
			return new Response("This command can only be ran by its creator.");

		const result = await client.conversations.history({ channel: channelConfig.get("channel_id") });
		const messages = result.messages!;

		const filesObj = messages.filter((message) => "files" in message).map((message) => message.files).flat()
		const fileLinks = filesObj
			.filter((media) => media!.mimetype?.startsWith('image'))
			.map((imageMedia) => imageMedia?.url_private_download).filter(Boolean)

		console.log(fileLinks.length + " files to download")
		for (const link of fileLinks) {
			console.log(`[${fileLinks.indexOf(link)}/${fileLinks.length}] ${link}`)
			ensureDir(`./${channelConfig.get("channel_name")}`);
        	let path = `./${channelConfig.get("channel_name")}/` + link!.split('/').at(-1)!;
        	while (await exists(path)) {
				const filename:string[] = [path.split(".").at(-2) + '_1', path.split(".").at(-1)!]
				path = path.split(".").splice(0, path.split(".").length - 2)
					.concat(filename).join('.');
			}
			await fileDownload(link!, path)
		}

		return new Response("Download Complete!")
	}

	return new Response(JSON.stringify({
		"error": "404",
		"text": "Page not found."
	}), {
		"headers": { "Content-Type": "application/json" },
		"status": 404
	});
});


async function fileDownload (url:string, path:string) {
	const rsp = await fetch(url, {headers: new Headers({ cookie: config.cookie })});
	const rdr = rsp.body?.getReader();
	if (rdr) {
		const r = readerFromStreamReader(rdr);
		const f = await Deno.open(path, {create: true, write: true});
		await copy(r, f);
		f.close();
		}
}

async function exists (filename: string): Promise<boolean> {
	try {
		await Deno.stat(filename);
		// successful, file or directory must exist
		return true;
	} catch (error) {
		if (error instanceof Deno.errors.NotFound) {
			// file or directory does not exist
			return false;
		} else {
			// unexpected error, maybe permissions, pass it along
			throw error;
		}
	}
}
