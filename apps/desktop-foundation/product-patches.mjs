// Copyright (c) 2026 AIKING.
// Product experience over the pinned runtime: AIKINGBOT account sign-in for workspaces (first-party Auth API email codes,
// with this server's People list as the membership authority) and access errors that say which sign-in or role fixes them.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const PRODUCT_PATCHED_FILES = ["src/state/store.tsx", "server/account-signin.ts", "server/index.ts", "src/pair/PairPage.tsx"];

export function patchProduct(source) {
  const edit = (path, ...pairs) => {
    const file = join(source, path); let text = readFileSync(file, "utf8").replaceAll("\r\n", "\n");
    for (const [before, after] of pairs) {
      if (!text.includes(before)) throw new Error(`Product patch anchor changed: ${path}: ${before.slice(0, 80)}`);
      text = text.replace(before, after);
    }
    writeFileSync(file, text);
  };

  edit("src/state/store.tsx",
    ['import { useChatErrorClear } from "./chat-error";', 'import { useChatErrorClear } from "./chat-error";\nimport { friendlyAccessError } from "@/aiking/access-errors";'],
    ['    throw new ApiError(message, res.status, body);\n  }\n  return body;\n}', '    throw new ApiError(friendlyAccessError(res.status, message), res.status, body);\n  }\n  return body;\n}']);

  // AIKING_ACCOUNT_API_URL selects the AIKINGBOT Auth API; without it the upstream control plane contract is unchanged.
  edit("server/account-signin.ts",
    ['import type { Scope } from "./sessions.ts";', 'import type { Scope } from "./sessions.ts";\nimport { accountApiOrigin, createAikingAccountClient } from "./aiking/account-api.ts";'],
    ['    if (client) return client;\n', '    if (client) return client;\n    const aikingOrigin = accountApiOrigin(env.AIKING_ACCOUNT_API_URL);\n    if (aikingOrigin) {\n      client = createAikingAccountClient({ baseURL: aikingOrigin, fetchImpl: options.fetchImpl }) as unknown as ControlPlaneClient;\n      return client;\n    }\n'],
    ['        await controlPlane().requestOTP(email);\n      } catch (error) {\n', '        await controlPlane().requestOTP(email);\n      } catch (error) {\n        if (error instanceof ControlPlaneError && error.status === 429) {\n          return { ok: false, status: 429, error: "too many codes were requested for this address; wait a few minutes, then request a new one" };\n        }\n'],
    ['"enter the 8-digit code from the email"', '"enter the 8-character code from the email"'],
    ['"this email is not on this server\'s sign-in list; ask the server\'s owner to add it"', '"this email is not a member of this workspace yet; ask the workspace owner to invite it in Settings → People"']);

  // AIKING_WORKSPACE_OWNERS: operator-set owner addresses that are always admins, so a hosted workspace has a first owner
  // without a pairing code. They cannot be removed from the UI and are not written to config.json.
  edit("server/index.ts",
    ['  admins: parseAllowList(config.signIn?.admins?.join(",")),', '  admins: [...parseAllowList(process.env.AIKING_WORKSPACE_OWNERS), ...parseAllowList(config.signIn?.admins?.join(","))],']);

  edit("src/pair/PairPage.tsx",
    ['`We emailed an 8-digit code to ${email}. It works once and expires in ten minutes.`', '`We emailed an 8-character code to ${email} from AIKINGBOT. It works once and expires in ten minutes. Check your spam folder if it has not arrived.`'],
    ['                  placeholder="12345678"\n                  autoComplete="one-time-code"\n                  inputMode="numeric"', '                  placeholder="ABCD-EFGH"\n                  autoComplete="one-time-code"\n                  autoCapitalize="characters"'],
    ['(sent && otp.replace(/\\D/g, "").length < 8)', '(sent && otp.replace(/[^a-z0-9]/gi, "").length < 8)'],
    ['              Have a pairing code instead?', '              Advanced: connect with a pairing code']);
}
