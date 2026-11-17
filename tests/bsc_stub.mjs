// Shared stubbed BSC RPC for the Mint Verifier tests.
// Answers from fixed data, never touches the real BSC network.
// Imported by mint-verifier.test.mjs and agentified.test.mjs; never import a
// .test.mjs file (its tests would run again).
import { Bsc } from "../script.js";

export const TOKEN = "0x10b80088fDAf9363d83671BE66b64f231f9e92f6";
export const ZERO = "0x0000000000000000000000000000000000000000";
export const PLAIN_CONTRACT = "0x1111111111111111111111111111111111111111";
export const OWNER = "0x8c0300e6df2b154c0de05f5f2f3b1de16e20aca1";

export function encodeUint(value) {
  return "0x" + BigInt(value).toString(16).padStart(64, "0");
}

export function encodeString(text) {
  const bytes = new TextEncoder().encode(text);
  const length = encodeUint(bytes.length).slice(2);
  let data = "";
  for (const byte of bytes) data += byte.toString(16).padStart(2, "0");
  data = data.padEnd(Math.ceil(data.length / 64) * 64, "0");
  return "0x" + encodeUint(32).slice(2) + length + data;
}

export function encodeAddress(address) {
  return "0x" + "00".repeat(12) + address.slice(2).toLowerCase();
}

/** Stubbed BSC RPC: answers from fixed data, never touches the real network. */
export function stubFetch(url, options) {
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

/** Point the page's BSC layer at the stub. Call once per test file. */
export function installBscStub() {
  Bsc.setFetch(stubFetch);
}
