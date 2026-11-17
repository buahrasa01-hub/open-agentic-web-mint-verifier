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
- `links.json` — the peer-network link map (no link slots; the partner is called by its exact URL, not a slot).
- `site-actions.js` — the two read-only site actions the agents can call: `website_get_site_state` and `website_verify_contract`.
- `site.js` — mounts the assistant in the page.
- `runtime/` — the browser runtime (nsDeploy runtime as shipped by the spec's agentify-website skill, unchanged).
- `tests/` — Node tests: the verdict logic and site actions (`mint-verifier.test.mjs`), the shared stubbed BSC RPC (`bsc_stub.mjs`), and the full template integration suite with a scripted model (`agentified.test.mjs`, incl. partner-tool and consent tests).

## Network

- Front agent `mint_verifier`: owns the two website tools, delegates reading to `contract_reader` and the plain verdict to `verdict_writer`. It can also ask the linked Tidewhistle Guesthouse network (see below).
- `contract_reader`: calls `website_verify_contract` for one address and returns the facts as plain text.
- `verdict_writer`: turns facts into the short plain-language verdict. It never says a contract is safe.
- Network URL: https://buahrasa01-hub.github.io/open-agentic-web-mint-verifier/mint_verifier_network (folder holding `agent-manifest.json`, then the network name). Live site: https://buahrasa01-hub.github.io/open-agentic-web-mint-verifier/

## Linked site

The assistant can ask the **Tidewhistle Guesthouse** demo network what it offers:

- Partner network URL: https://mint-verifier-guesthouse-partner-buahrasa01.vercel.app/tidewhistle_guesthouse (the spec's own guesthouse example, deployed as a static site on Vercel with `Access-Control-Allow-Origin: *`; its own agent-manifest and bridge are public there).
- The consent card shows "Tidewhistle Guesthouse", its host, and the first 140 characters of the request, before anything is sent. **Always allow** skips the card for that host until the page is reloaded.
- A request is one short question, such as "What do you offer, and how do I book?" The assistant is told never to put names, emails, phone numbers or booking codes in it, though the runtime does not filter it, so the visitor checks it on the card.
- The partner's network runs in this browser on the visitor's key, with none of the partner's site tools, so it cannot give live availability or prices — only what its instructions say it offers and how to book — and a call costs more than the card's token estimate. The guesthouse network itself links a harbor-tours demo on `localhost:8081`, which is not served: allowing that nested call fails fast and the guesthouse agent still answers from its instructions.

## What it cannot do

It cannot mint, buy, or send anything. It cannot check off-chain promises, audit reports, or unverified source code. It only reads BNB Smart Chain (chain id 56). Passing every public check does not make a contract safe.

## License

MIT. See LICENSE.
