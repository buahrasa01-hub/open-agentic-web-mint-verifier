// Phase 1 tests for Mint Verifier.
// Run: node --test "tests/*.test.mjs"   (quote the glob; Node 22 does not accept a bare folder.)
// These tests cover the verdict logic, the BSC read layer (with a stubbed RPC), the
// site actions, and the published network + manifest conformance. They do not call an
// LLM provider and they do not touch the real BSC network.
// The full template integration suite (scripted model driving the real runtime) is a
// Phase 2 item; see PLAN.md.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  App,
  Bsc,
  buildVerdict,
  decodeAbiString,
  decodeAddress,
  decodeBool,
  decodeUint,
  formatAmount,
  isAddress,
} from "../script.js";
import { registerActions } from "../site-actions.js";
import { AgentNetwork, validateNetwork } from "../runtime/kernel.js";

const TOKEN = "0x10b80088fDAf9363d83671BE66b64f231f9e92f6";
const ZERO = "0x0000000000000000000000000000000000000000";
const PLAIN_CONTRACT = "0x1111111111111111111111111111111111111111";
const OWNER = "0x8c0300e6df2b154c0de05f5f2f3b1de16e20aca1";

// --- ABI encoding helpers for the stubbed RPC -------------------------------

function encodeUint(value) {
  return "0x" + BigInt(value).toString(16).padStart(64, "0");
}

function encodeString(text) {
  const bytes = new TextEncoder().encode(text);
  const length = encodeUint(bytes.length).slice(2);
  let data = "";
  for (const byte of bytes) data += byte.toString(16).padStart(2, "0");
  data = data.padEnd(Math.ceil(data.length / 64) * 64, "0");
  return "0x" + encodeUint(32).slice(2) + length + data;
}

function encodeAddress(address) {
  return "0x" + "00".repeat(12) + address.slice(2).toLowerCase();
}

/** Stubbed BSC RPC: answers from fixed data, never touches the real network. */
function stubFetch(url, options) {
  const { method, params } = JSON.parse(options.body);
  let result = "0x";
  if (method === "eth_getCode") {
    const address = params[0].toLowerCase();
    if (address === TOKEN.toLowerCase()) {
      // Fake runtime bytecode that contains the mint(address,uint256) selector.
      result = "0x608060405234801561001057600080fd5b5040c10f19600080fd5b50";
    } else if (address === PLAIN_CONTRACT.toLowerCase()) {
      result = "0x608060405234801561001057600080fd5b50";
    } else {
      result = "0x";
    }
  } else if (method === "eth_call") {
    const call = params[0];
    const to = call.to.toLowerCase();
    const data = call.data;
    if (to === TOKEN.toLowerCase()) {
      if (data === "0x06fdde03") result = encodeString("PACTURE");
      else if (data === "0x95d89b41") result = encodeString("PACTURE");
      else if (data === "0x313ce567") result = encodeUint(18);
      else if (data === "0x18160ddd") result = encodeUint(10n ** 24n);
      else if (data === "0x8da5cb5b") result = encodeAddress(OWNER);
      else if (data === "0x5c975abb") result = encodeUint(0);
      else if (data === "0xd5abeb01") throw new Error("execution reverted");
    }
    // Any other eth_call returns "0x" (empty): the decoder treats it as absent.
  }
  return Promise.resolve({
    json: () => Promise.resolve({ jsonrpc: "2.0", id: 1, result }),
  });
}

Bsc.setFetch(stubFetch);

// --- Pure decoding and verdict logic ----------------------------------------

test("isAddress accepts only 0x + 40 hex chars", () => {
  assert.equal(isAddress(TOKEN), true);
  assert.equal(isAddress(ZERO), true);
  assert.equal(isAddress("0x1234"), false);
  assert.equal(isAddress("not an address"), false);
  assert.equal(isAddress(""), false);
  assert.equal(isAddress(null), false);
});

test("decodeAbiString reads real strings and bytes32-style returns", () => {
  assert.equal(decodeAbiString(encodeString("PACTURE")), "PACTURE");
  assert.equal(decodeAbiString(encodeString("A very long token name here")), "A very long token name here");
  const bytes32 = "0x" + Buffer.from("OLD").toString("hex").padEnd(64, "0");
  assert.equal(decodeAbiString(bytes32), "OLD");
  assert.equal(decodeAbiString("0x"), null);
  assert.equal(decodeAbiString(null), null);
});

test("decodeUint / decodeAddress / decodeBool", () => {
  assert.equal(decodeUint(encodeUint(18)), 18n);
  assert.equal(decodeUint(encodeUint(10n ** 24n)), 10n ** 24n);
  assert.equal(decodeUint("0x"), null);
  assert.equal(decodeAddress(encodeAddress(OWNER)), OWNER);
  assert.equal(decodeAddress("0x"), null);
  assert.equal(decodeBool(encodeUint(0)), false);
  assert.equal(decodeBool(encodeUint(1)), true);
  assert.equal(decodeBool("0x"), null);
});

test("formatAmount renders whole and fractional supplies", () => {
  assert.equal(formatAmount(10n ** 24n, 18), "1000000");
  assert.equal(formatAmount(1500000000000000000n, 18), "1.5");
  assert.equal(formatAmount(0n, 18), "0");
  assert.equal(formatAmount(null, 18), null);
});

test("buildVerdict: no contract", () => {
  const verdict = buildVerdict(ZERO, {
    isContract: false,
    isToken: false,
    name: null,
    symbol: null,
    decimals: null,
    totalSupply: null,
    owner: null,
    paused: null,
    maxSupply: null,
    mintFunctions: [],
  });
  assert.equal(verdict.ok, true);
  assert.equal(verdict.level, "clear");
  assert.match(verdict.summary, /nothing to mint/);
});

test("buildVerdict: contract but not a token", () => {
  const verdict = buildVerdict(PLAIN_CONTRACT, {
    isContract: true,
    isToken: false,
    name: null,
    symbol: null,
    decimals: null,
    totalSupply: null,
    owner: null,
    paused: null,
    maxSupply: null,
    mintFunctions: [],
  });
  assert.equal(verdict.level, "caution");
  assert.match(verdict.summary, /does not behave like a token/);
});

test("buildVerdict: token with owner and mint function", () => {
  const verdict = buildVerdict(TOKEN, {
    isContract: true,
    isToken: true,
    name: "PACTURE",
    symbol: "PACTURE",
    decimals: 18,
    totalSupply: 10n ** 24n,
    owner: OWNER,
    paused: false,
    maxSupply: null,
    mintFunctions: ["mint(address,uint256)"],
  });
  assert.equal(verdict.level, "facts");
  assert.match(verdict.summary, /PACTURE/);
  assert.match(verdict.summary, /Total supply: 1000000/);
  assert.match(verdict.summary, /cannot see hidden owner powers/);
  assert.equal(verdict.flags.length, 2);
  assert.match(verdict.flags[0], /Has an owner/);
  assert.match(verdict.flags[1], /mint-like function/);
});

// --- Page + site actions with the stubbed RPC --------------------------------

test("verifyContract: token address returns facts, flags, and updates state", async () => {
  const verdict = await App.page.verifyContract(TOKEN);
  assert.equal(verdict.ok, true);
  assert.equal(verdict.level, "facts");
  assert.equal(verdict.isToken, true);
  assert.equal(verdict.facts.name, "PACTURE");
  assert.equal(verdict.facts.symbol, "PACTURE");
  assert.equal(verdict.facts.decimals, 18);
  assert.equal(verdict.facts.owner, OWNER);
  assert.equal(verdict.facts.paused, false);
  assert.deepEqual(verdict.facts.mintFunctions, ["mint(address,uint256)"]);
  assert.equal(verdict.facts.maxSupply, null);
  const state = App.page.getState();
  assert.equal(state.address, TOKEN);
  assert.equal(state.verdict.level, "facts");
  assert.equal(state.version, 1);
});

test("verifyContract: zero address is not a contract", async () => {
  const verdict = await App.page.verifyContract(ZERO);
  assert.equal(verdict.ok, true);
  assert.equal(verdict.level, "clear");
  assert.equal(verdict.isContract, false);
});

test("verifyContract: contract without token metadata is caution", async () => {
  const verdict = await App.page.verifyContract(PLAIN_CONTRACT);
  assert.equal(verdict.ok, true);
  assert.equal(verdict.level, "caution");
  assert.equal(verdict.isToken, false);
});

test("verifyContract: bad address is refused without a network call", async () => {
  const before = App.page.getState().version;
  const verdict = await App.page.verifyContract("hello");
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /does not look like/);
  assert.equal(App.page.getState().version, before);
});

test("site actions register exactly get_site_state and verify_contract", async () => {
  const registered = [];
  registerActions({ register: (definition) => registered.push(definition) });
  assert.deepEqual(
    registered.map((d) => d.name).sort(),
    ["get_site_state", "verify_contract"],
  );
  assert.ok(registered.every((d) => d.effect === "read"));
  const state = registered.find((d) => d.name === "get_site_state").execute();
  assert.equal(state.chain, "BNB Smart Chain (chain id 56)");
  const verdict = await registered.find((d) => d.name === "verify_contract").execute({ address: TOKEN });
  assert.equal(verdict.ok, true);
  assert.equal(verdict.level, "facts");
});

// --- Published network + manifest conformance --------------------------------

test("manifest lists the network and the runtime validator accepts it", async () => {
  const manifest = JSON.parse(await readFile(new URL("../agent-manifest.json", import.meta.url), "utf8"));
  assert.equal(manifest.networks.length, 1);
  assert.equal(manifest.networks[0].name, "mint_verifier_network");
  assert.equal(manifest.networks[0].front_man, "mint_verifier");
  assert.equal(manifest.networks[0].hocon, "./mint_verifier_network.network.json");
  assert.equal(manifest.peer_policy.mode, "closed");
  assert.deepEqual(manifest.allowed_peers, []);
  assert.equal(manifest.llm_router.mock, false);

  const networkJson = JSON.parse(
    await readFile(new URL("../mint_verifier_network.network.json", import.meta.url), "utf8"),
  );
  const network = new AgentNetwork(networkJson, "mint_verifier_network");
  const { errors } = validateNetwork(network);
  assert.deepEqual(errors, []);
  const names = network.config.tools.map((t) => t.name);
  assert.deepEqual(names, ["mint_verifier", "contract_reader", "verdict_writer"]);
  assert.deepEqual(network.config.tools[0].tools, ["contract_reader", "verdict_writer"]);
});

test("links.json declares the network with no peers", async () => {
  const links = JSON.parse(await readFile(new URL("../links.json", import.meta.url), "utf8"));
  assert.equal(links.version, 1);
  assert.deepEqual(links.networks, { mint_verifier_network: {} });
});
