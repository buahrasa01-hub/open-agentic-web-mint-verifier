// Mint Verifier — the page's own logic.
// Reads public BSC facts about a contract address and returns a plain verdict.
// Read-only: no wallet, no signing, no transactions, no keys anywhere.
// The assistant (site-actions.js) and the page's Verify button share these functions.

export const BSC_RPC_URL = "https://bsc-dataseed1.binance.org";
const RPC_TIMEOUT_MS = 15000;

// 4-byte selectors for the read-only calls we make.
const SELECTORS = {
  name: "0x06fdde03",
  symbol: "0x95d89b41",
  decimals: "0x313ce567",
  totalSupply: "0x18160ddd",
  owner: "0x8da5cb5b",
  paused: "0x5c975abb",
  maxSupply: "0xd5abeb01",
};

// Mint-like selectors. We do NOT call them (a call with dummy arguments proves
// nothing: an unknown selector returns empty data instead of reverting). We search
// the deployed bytecode for the selector bytes and report "likely present".
const MINT_SELECTORS = [
  { selector: "40c10f19", label: "mint(address,uint256)" },
  { selector: "a0712d68", label: "mint(uint256)" },
  { selector: "6a627842", label: "mint(address)" },
  { selector: "4e71d92d", label: "claim()" },
];

/** True when the text looks like a 0x-prefixed 40-hex-char BSC address. */
export function isAddress(value) {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value.trim());
}

function hexToBytes(hex) {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = [];
  for (let i = 0; i < clean.length; i += 2) {
    bytes.push(parseInt(clean.slice(i, i + 2), 16));
  }
  return bytes;
}

/** Decode an ABI-encoded string result. Handles real strings and bytes32-style returns. Returns null when undecodable. */
export function decodeAbiString(result) {
  if (!result || result === "0x") return null;
  const clean = result.slice(2);
  try {
    if (clean.length >= 128) {
      const offset = parseInt(clean.slice(0, 64), 16);
      const length = parseInt(clean.slice(64, 128), 16);
      if (offset === 32 && length > 0 && length <= 1024) {
        const bytes = hexToBytes(clean.slice(128, 128 + length * 2));
        return new TextDecoder().decode(new Uint8Array(bytes));
      }
    }
    if (clean.length === 64) {
      const bytes = hexToBytes(clean).filter((b) => b !== 0);
      if (bytes.length === 0) return null;
      return new TextDecoder().decode(new Uint8Array(bytes));
    }
  } catch {
    return null;
  }
  return null;
}

/** Decode a uint256 result as a BigInt. Returns null on empty/invalid input. */
export function decodeUint(result) {
  if (!result || result === "0x") return null;
  try {
    return BigInt(result);
  } catch {
    return null;
  }
}

/** Decode an address result (last 20 bytes). Returns null on empty/invalid input. */
export function decodeAddress(result) {
  if (!result || result === "0x") return null;
  const clean = result.slice(2);
  if (clean.length < 40) return null;
  const address = "0x" + clean.slice(-40).toLowerCase();
  return isAddress(address) ? address : null;
}

/** Decode a bool result. Returns null on empty/invalid input. */
export function decodeBool(result) {
  if (!result || result === "0x") return null;
  const clean = result.slice(2);
  if (clean.length < 2) return null;
  return clean.slice(-2) === "01";
}

/** Format a raw token amount with its decimals into a human-readable string. */
export function formatAmount(raw, decimals) {
  if (raw === null || decimals === null) return null;
  const base = 10n ** BigInt(decimals);
  const whole = raw / base;
  const frac = raw % base;
  if (frac === 0n) return whole.toString();
  let fracText = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  if (fracText.length > 4) fracText = fracText.slice(0, 4);
  return `${whole.toString()}.${fracText}`;
}

// ---------------------------------------------------------------------------
// BSC JSON-RPC layer (read-only). `fetchFn` is injectable so Node tests can stub it.
// ---------------------------------------------------------------------------
export const Bsc = {
  _fetch: null,

  /** Override the fetch implementation (tests only). Pass null to restore global fetch. */
  setFetch(fn) {
    this._fetch = fn;
  },

  async rpc(method, params) {
    const doFetch = this._fetch || fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);
    try {
      const response = await doFetch(BSC_RPC_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: controller.signal,
      });
      const body = await response.json();
      if (body.error) throw new Error(body.error.message || "BSC RPC error");
      return body.result;
    } finally {
      clearTimeout(timer);
    }
  },

  /** eth_call a read-only function. Returns the raw hex result, or null when the call itself fails. */
  async call(to, data) {
    try {
      return await this.rpc("eth_call", [{ to, data }, "latest"]);
    } catch {
      return null;
    }
  },

  async getCode(address) {
    return this.rpc("eth_getCode", [address, "latest"]);
  },
};

// ---------------------------------------------------------------------------
// Verdict logic — pure given the facts object, so it is easy to test.
// ---------------------------------------------------------------------------
export function buildVerdict(address, facts) {
  // Tool results are serialized as JSON, which cannot hold a BigInt: hand the
  // verdict back with supplies as decimal strings. The page renders
  // totalSupplyText, so nothing it shows changes.
  const safeFacts = {
    ...facts,
    totalSupply:
      facts.totalSupply === null || facts.totalSupply === undefined
        ? null
        : String(facts.totalSupply),
    maxSupply:
      facts.maxSupply === null || facts.maxSupply === undefined
        ? null
        : String(facts.maxSupply),
    mintFunctions: facts.mintFunctions,
  };
  const flags = [];
  if (facts.owner) {
    flags.push(`Has an owner: one address (${facts.owner}) can change the contract.`);
  }
  if (facts.mintFunctions.length > 0) {
    flags.push(
      `Has a mint-like function (likely): ${facts.mintFunctions.join(", ")} — new tokens can be created.`,
    );
  }
  if (facts.paused === true) {
    flags.push("Currently paused: minting and transfers may be blocked right now.");
  }

  if (!facts.isContract) {
    return {
      ok: true,
      address,
      level: "clear",
      summary: "No contract lives at this address. There is nothing to mint here — do not send money to it.",
      isContract: false,
      isToken: false,
      flags,
      facts: safeFacts,
      checkedAt: new Date().toISOString(),
    };
  }

  if (!facts.isToken) {
    return {
      ok: true,
      address,
      level: "caution",
      summary:
        "A contract exists here, but it does not behave like a token. The usual mint checks do not apply. Read its source before interacting.",
      isContract: true,
      isToken: false,
      flags,
      facts: safeFacts,
      checkedAt: new Date().toISOString(),
    };
  }

  const supplyText = formatAmount(facts.totalSupply, facts.decimals);
  const lines = [`This is a token contract: ${facts.name || "unnamed"} (${facts.symbol || "?"})`];
  if (supplyText !== null) lines.push(`Total supply: ${supplyText} ${facts.symbol || ""}`.trim());
  if (facts.maxSupply !== null && facts.maxSupply !== undefined) {
    const maxText = formatAmount(facts.maxSupply, facts.decimals);
    if (maxText !== null) lines.push(`Max supply: ${maxText} ${facts.symbol || ""}`.trim());
  }
  lines.push(
    "This checks public on-chain facts only. It cannot see hidden owner powers, unverified source code, or off-chain promises.",
  );
  return {
    ok: true,
    address,
    level: "facts",
    summary: lines.join(" "),
    isContract: true,
    isToken: true,
    flags,
    facts: {
      ...safeFacts,
      totalSupplyText: supplyText,
    },
    checkedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// The page object: shared by the Verify button and the assistant's site actions.
// ---------------------------------------------------------------------------
class MintVerifierPage {
  constructor() {
    this.address = "";
    this.verdict = null;
    this.version = 0;
    this.supportedChecks = [
      "contract exists (code at address)",
      "token metadata (name, symbol, decimals, total supply)",
      "owner address",
      "paused state",
      "max supply",
      "mint-like functions (bytecode heuristic)",
    ];
  }

  getState() {
    return {
      address: this.address,
      verdict: this.verdict,
      version: this.version,
      supportedChecks: [...this.supportedChecks],
      chain: "BNB Smart Chain (chain id 56)",
      rpc: BSC_RPC_URL,
      partner: {
        name: "Tidewhistle Guesthouse",
        url: "https://mint-verifier-guesthouse-partner-buahrasa01.vercel.app/",
      },
    };
  }

  /** Verify one contract address. Returns the verdict object. Updates page state and renders it. */
  async verifyContract(address) {
    const clean = typeof address === "string" ? address.trim() : "";
    if (!isAddress(clean)) {
      return {
        ok: false,
        reason: "That does not look like a BSC contract address. It must be 0x followed by 40 hex characters.",
        field: "address",
      };
    }
    this.address = clean;
    let code;
    try {
      code = await Bsc.getCode(clean);
    } catch (error) {
      return {
        ok: false,
        reason: `Could not reach the BSC network (${error.message || "network error"}). Try again.`,
      };
    }
    const isContract = typeof code === "string" && code !== "0x" && code.length > 2;

    const facts = {
      isContract,
      isToken: false,
      name: null,
      symbol: null,
      decimals: null,
      totalSupply: null,
      owner: null,
      paused: null,
      maxSupply: null,
      mintFunctions: [],
    };

    if (isContract) {
      const [nameRes, symbolRes, decimalsRes, supplyRes, ownerRes, pausedRes, maxSupplyRes] =
        await Promise.all([
          Bsc.call(clean, SELECTORS.name),
          Bsc.call(clean, SELECTORS.symbol),
          Bsc.call(clean, SELECTORS.decimals),
          Bsc.call(clean, SELECTORS.totalSupply),
          Bsc.call(clean, SELECTORS.owner),
          Bsc.call(clean, SELECTORS.paused),
          Bsc.call(clean, SELECTORS.maxSupply),
        ]);
      facts.name = decodeAbiString(nameRes);
      facts.symbol = decodeAbiString(symbolRes);
      facts.decimals = decodeUint(decimalsRes) === null ? null : Number(decodeUint(decimalsRes));
      facts.totalSupply = decodeUint(supplyRes);
      facts.owner = decodeAddress(ownerRes);
      facts.paused = decodeBool(pausedRes);
      facts.maxSupply = decodeUint(maxSupplyRes);
      facts.isToken = facts.name !== null || facts.symbol !== null || facts.decimals !== null;
      const codeLower = code.toLowerCase();
      for (const entry of MINT_SELECTORS) {
        if (codeLower.includes(entry.selector)) facts.mintFunctions.push(entry.label);
      }
    }

    const verdict = buildVerdict(clean, facts);
    this.verdict = verdict;
    this.version += 1;
    this.render();
    return verdict;
  }

  clearResult() {
    this.address = "";
    this.verdict = null;
    this.version += 1;
    this.render();
    return this.getState();
  }

  /** Render the current verdict into the result card. No-op when there is no DOM. */
  render() {
    if (typeof document === "undefined") return;
    const card = document.querySelector("#result");
    if (!card) return;
    const verdict = this.verdict;
    if (!verdict) {
      card.hidden = true;
      card.innerHTML = "";
      return;
    }
    card.hidden = false;
    const levelLabel = { clear: "No contract", caution: "Not a token", facts: "Token facts" }[verdict.level] || "";
    const flagItems = verdict.flags.map((flag) => `<li>${escapeHtml(flag)}</li>`).join("");
    const facts = verdict.facts || {};
    const rows = [];
    if (facts.name) rows.push(["Name", facts.name]);
    if (facts.symbol) rows.push(["Symbol", facts.symbol]);
    if (facts.decimals !== null && facts.decimals !== undefined) rows.push(["Decimals", String(facts.decimals)]);
    if (facts.totalSupplyText) rows.push(["Total supply", facts.totalSupplyText]);
    if (facts.owner) rows.push(["Owner", facts.owner]);
    if (facts.paused !== null && facts.paused !== undefined) rows.push(["Paused", facts.paused ? "yes" : "no"]);
    const rowsHtml = rows.map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`).join("");
    card.innerHTML = `
      <h3>${escapeHtml(levelLabel)} — <code>${escapeHtml(verdict.address)}</code></h3>
      <p>${escapeHtml(verdict.summary)}</p>
      ${rowsHtml ? `<table>${rowsHtml}</table>` : ""}
      ${flagItems ? `<ul>${flagItems}</ul>` : ""}
      <p class="muted">Checked ${escapeHtml(verdict.checkedAt)} against ${escapeHtml(BSC_RPC_URL)}.</p>
    `;
  }

  /** Wire the page's own Verify form. No-op when there is no DOM (Node tests). */
  bind() {
    if (typeof document === "undefined") return;
    const form = document.querySelector("#verify-form");
    const input = document.querySelector("#contract-address");
    const clearButton = document.querySelector("#clear-result");
    const status = document.querySelector("#verify-status");
    if (!form || !input) return;
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (status) status.textContent = "Checking the BSC network…";
      const verdict = await this.verifyContract(input.value);
      if (status) {
        status.textContent = verdict.ok
          ? "Done. The result is below."
          : verdict.reason || "That address could not be checked.";
      }
    });
    if (clearButton) {
      clearButton.addEventListener("click", () => {
        this.clearResult();
        input.value = "";
        if (status) status.textContent = "";
      });
    }
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export const App = { page: new MintVerifierPage() };

// Bind the form only in a real browser, not when Node imports this module for tests.
if (typeof document !== "undefined" && typeof window !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => App.page.bind());
  } else {
    App.page.bind();
  }
}
