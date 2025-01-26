import * as v from 'valibot';
import { MANIFEST_FILE } from '../../constants';
import { type Manifest, categorySchema } from '../../types';
import { Err, Ok, type Result } from '../blocks/types/result';
import { azure } from './azure';
import { bitbucket } from './bitbucket';
import { github } from './github';
import { gitlab } from './gitlab';
import { http } from './http';
import type { RegistryProvider, RegistryProviderState } from './types';

export const providers = [github, gitlab, bitbucket, azure, http];

export const selectProvider = (url: string): RegistryProvider | undefined => {
	const provider = providers.find((p) => p.matches(url));

	return provider;
};

export type FetchOptions = {
	token: string;
	/** Override the fetch method. If you are using this in a node environment you will want to pass `node-fetch` */
	fetch?: typeof fetch;
	verbose: (str: string) => void;
};

export const fetchRaw = async (
	state: RegistryProviderState,
	resourcePath: string,
	{ verbose, fetch: f = fetch, token }: Partial<FetchOptions> = {}
): Promise<Result<string, string>> => {
	const url = await state.provider.resolveRaw(state, resourcePath);

	verbose?.(`Trying to fetch from ${url}`);

	try {
		const headers = new Headers();

		if (token !== undefined && state.provider.authHeader) {
			const [key, value] = state.provider.authHeader(token);

			headers.append(key, value);
		}

		const response = await f(url, { headers });

		verbose?.(`Got a response from ${url} ${response.status} ${response.statusText}`);

		if (!response.ok) {
			return Err(
				state.provider.formatFetchError(
					state,
					resourcePath,
					`${response.status} ${response.statusText}`
				)
			);
		}

		return Ok(await response.text());
	} catch (err) {
		return Err(state.provider.formatFetchError(state, resourcePath, err));
	}
};

export const fetchManifest = async (
	state: RegistryProviderState,
	{ fetch: f = fetch, ...rest }: Partial<FetchOptions> = {}
): Promise<Result<Manifest, string>> => {
	const manifest = await fetchRaw(state, MANIFEST_FILE, { fetch: f, ...rest });

	if (manifest.isErr()) return Err(manifest.unwrapErr());

	const categories = v.safeParse(v.array(categorySchema), JSON.parse(manifest.unwrap()));

	if (!categories.success) {
		return Err(`Error parsing categories: ${categories.issues}`);
	}

	return Ok(categories.output);
};

export * from './types';

export { github, gitlab, bitbucket, azure, http };
