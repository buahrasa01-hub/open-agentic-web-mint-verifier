# Mint Verifier

An open agentic website: check a BNB Smart Chain contract **before** you mint, buy, or send anything. Paste a contract address and the page reads its public on-chain facts — contract code, token metadata, owner, paused state, max supply, likely mint functions — and returns a plain verdict. No wallet, no signing, no transactions.

Built for the [Open Agentic Web Challenge](https://cognizant-agenticweb.devpost.com/) (Cognizant, $10,000; deadline 11 Jan 2027). It conforms to the [Worldwide Agentic Web MVP spec](https://github.com/cognizant-ai-labs/agentic-web/blob/main/docs/worldwide_agentic_web_mvp_spec.md): the agent network is published as public JSON, a browser runtime runs it, and the visitor brings their own LLM key (BYOK) — the site pays for no inference.

## Run it locally

```shell
node ../spec/skills/agentify-website/scripts/serve_site.mjs . --port 8080
```

Then open http://127.0.0.1:8080/. The Verify button works with no key at all. The assistant chat needs a key: open **AI model settings** in the page and paste an OpenAI-compatible provider key (Otari by default, or any provider URL + model).

## Files

- `index.html`, `styles.css`, `script.js` — the page. `script.js` holds the BSC reads and the verdict logic; the Verify button and the assistant share it.
- `mint_verifier_network.hocon` — the agent network source (Neuro SAN HOCON). Build it with:
  ```shell
  node ../spec/skills/agentify-website/scripts/build_network.mjs mint_verifier_network.hocon --manifest agent-manifest.json
  ```
  This writes `mint_verifier_network.network.json` (the published, resolved network) plus the discovery files. Never edit the generated files by hand.
- `agent-manifest.json` — the public index of the site's networks, router, and peer policy.
- `links.json` — the peer-network link map (empty: this site calls no other site).
- `site-actions.js` — the two read-only site actions the agents can call: `website_get_site_state` and `website_verify_contract`.
- `site.js` — mounts the assistant in the page.
- `runtime/` — the browser runtime (nsDeploy runtime as shipped by the spec's agentify-website skill, unchanged).
- `tests/` — Node tests for the verdict logic and the site actions.

## Network

- Front agent `mint_verifier`: owns the two website tools, delegates reading to `contract_reader` and the plain verdict to `verdict_writer`.
- `contract_reader`: calls `website_verify_contract` for one address and returns the facts as plain text.
- `verdict_writer`: turns facts into the short plain-language verdict. It never says a contract is safe.
- Network URL (once hosted): the folder holding `agent-manifest.json`, then the network name `mint_verifier_network`.

## What it cannot do

It cannot mint, buy, or send anything. It cannot check off-chain promises, audit reports, or unverified source code. It only reads BNB Smart Chain (chain id 56). Passing every public check does not make a contract safe.

## License

MIT. See LICENSE.
