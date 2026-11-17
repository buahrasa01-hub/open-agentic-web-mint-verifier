// Registers this website's operations with the agent runtime.
// agent-manifest.json loads this module through "actions.module". Only the names in
// "actions.agentTools" become model tools, called website_<name>.
//
// Both actions are read-only: they read public BSC facts and return them. Nothing is
// signed, nothing is sent on-chain, and nothing the visitor cannot undo happens here.
import { App } from "./script.js";

/**
 * Describes the site's operations as actions the agents can call.
 *
 * Each action wraps a function the page already uses, so the assistant and the manual
 * UI share one set of rules. The runtime validates arguments against inputSchema
 * before execute runs.
 */
class SiteActions {
  /**
   * Register every site action with the runtime.
   *
   * :param actions: The runtime registry facade with a register(definition) method.
   */
  static registerActions(actions) {
    actions.register(SiteActions.getSiteStateAction());
    actions.register(SiteActions.verifyContractAction());
  }

  /**
   * Describe the read action that returns the page's data and current state.
   *
   * :return: The action definition.
   */
  static getSiteStateAction() {
    return {
      name: "get_site_state",
      description:
        "Read the Mint Verifier page state: the last address checked, its verdict, the page version, the list of supported checks, and the BSC endpoint used.",
      effect: "read",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      execute: SiteActions.getSiteState,
    };
  }

  /**
   * Return a fresh copy of the page state.
   *
   * :return: The page state as plain JSON data.
   */
  static getSiteState() {
    return App.page.getState();
  }

  /**
   * Describe the read action that verifies one BSC contract address.
   *
   * :return: The action definition.
   */
  static verifyContractAction() {
    return {
      name: "verify_contract",
      description:
        "Verify one BNB Smart Chain contract address against live public on-chain facts: whether contract code exists, token metadata (name, symbol, decimals, total supply), owner address, paused state, max supply, and likely mint-like functions. Returns the plain verdict with facts and flags. Read-only: no wallet, no signing, no transaction.",
      effect: "read",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["address"],
        properties: {
          address: {
            type: "string",
            // No "pattern" here: the runtime's schema checker does not support it.
            // verifyContract refuses a malformed address with {ok: false, reason}.
            description: "The BSC contract address to verify: 0x followed by 40 hex characters.",
          },
        },
      },
      execute: SiteActions.verifyContract,
    };
  }

  /**
   * Verify through the site's own function, the same one the Verify button uses.
   *
   * :param args: The validated arguments with address.
   * :return: The verdict object, or {ok: false, reason} when the site refuses.
   */
  static async verifyContract(args) {
    return App.page.verifyContract(args.address);
  }
}

// The runtime calls the module's registerActions export.
export const registerActions = SiteActions.registerActions;
