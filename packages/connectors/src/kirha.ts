/**
 * Kirha connector for Flue.
 *
 * Wraps the Kirha SDK as a Flue `SearchProvider`. Configure once via `init({ search })`
 * and the LLM gets a built-in `search` tool backed by Kirha's planner + data
 * providers.
 *
 * @example
 * ```typescript
 * import { kirha } from '@flue/connectors/kirha';
 *
 * const agent = await init({
 *   model: 'anthropic/claude-sonnet-4-6',
 *   search: kirha({ apiKey: env.KIRHA_API_KEY, vertical: 'crypto' }),
 * });
 *
 * // Per-call vertical override:
 * await session.prompt('Summarize the top three Phase 1 trials for Alzheimer\'s.', {
 *   search: kirha({ apiKey: env.KIRHA_API_KEY, vertical: 'medical' }),
 * });
 * ```
 */
import type { SearchProvider, SearchResult } from '@flue/sdk/client';
import { Kirha } from 'kirha';

// ─── Options ────────────────────────────────────────────────────────────────

export interface KirhaConnectorOptions {
	apiKey: string;
	/** Domain vertical (e.g. 'crypto', 'medical'). Omit for cross-vertical (beta). */
	vertical?: string;
	/**
	 * Summarization model used to turn raw provider data into the `text` field
	 * the LLM consumes. Defaults to `'kirha-flash'` (cheapest, fastest).
	 *
	 * - String: use that model with default formatting.
	 * - Object: pass a `{ model, instruction }` config to Kirha.
	 * - `false`: skip Kirha summarization. The `text` field falls back to a
	 *   compact JSON dump of `result.data` — usable but not pretty. Prefer the
	 *   default unless you have a reason.
	 */
	summarization?: 'kirha' | 'kirha-flash' | false | { model: 'kirha' | 'kirha-flash'; instruction?: string };
	/** Forward Kirha's plan into the tool result `details.data.planning`. Default: false. */
	includePlanning?: boolean;
	/**
	 * Override the provider name used in tool result `details` and event logs.
	 * Useful when configuring multiple Kirha providers (e.g. one per vertical)
	 * and you want them distinguishable in traces.
	 */
	name?: string;
	/** Override the tool description shown to the LLM. */
	description?: string;
}

// Minimal local view of `kirha.search()`'s response. The Kirha SDK's surface
// may grow, but Flue only needs `summary | data | planning` — narrowing here
// keeps us honest about what we depend on.
interface KirhaSearchResponse {
	summary?: string;
	data?: unknown;
	planning?: unknown;
}

// ─── Factory ────────────────────────────────────────────────────────────────

export function kirha(options: KirhaConnectorOptions): SearchProvider {
	const client = new Kirha({ apiKey: options.apiKey, vertical: options.vertical });
	const summarization = options.summarization ?? 'kirha-flash';
	const includePlanning = options.includePlanning ?? false;
	const name = options.name ?? (options.vertical ? `kirha:${options.vertical}` : 'kirha');

	return {
		name,
		description:
			options.description ??
			`Search Kirha${options.vertical ? ` (${options.vertical} vertical)` : ''}: domain-specialist data ` +
				`(crypto, financial, medical, ...) executed via Kirha's planner. ` +
				`Use for fresh, structured information the agent does not already have.`,
		async search(query: string, _signal?: AbortSignal): Promise<SearchResult> {
			const kirhaOptions: Record<string, unknown> = { includePlanning };
			if (summarization !== false) {
				kirhaOptions.summarization = summarization;
			}

			const response = (await client.search(query, kirhaOptions)) as KirhaSearchResponse;

			const text =
				summarization !== false && typeof response.summary === 'string'
					? response.summary
					: JSON.stringify(response.data ?? response, null, 2);

			return {
				text,
				data: includePlanning
					? { data: response.data, planning: response.planning }
					: response.data,
			};
		},
	};
}
