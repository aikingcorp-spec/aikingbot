// Copyright (c) 2026 AIKING.
// Continue the pinned provider drivers' own authentication; never exchange or invent provider tokens here.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function patchProviderOnboarding(source) {
  const edit = (path, pairs) => {
    const file = join(source, path);
    let text = readFileSync(file, "utf8").replaceAll("\r\n", "\n");
    for (const [before, after] of pairs) {
      if (!text.includes(before)) throw new Error(`Provider onboarding anchor changed: ${path}: ${before.slice(0, 80)}`);
      text = text.replace(before, after);
    }
    writeFileSync(file, text);
  };
  edit("src/components/EngineSetup.tsx", [
    ['return instance.driverKind === "grokAgent" && needsCli(instance) && !serverTerminal(cloudHome);',
      'return instance.driverKind === "grokAgent" && needsCli(instance) && !instance.install?.server && !instance.install?.managed && !serverTerminal(cloudHome);'],
    ['function ManagedEngineSetup({ instance, signInOnly }: { instance: InstanceInfo; signInOnly: boolean }) {',
      'function ManagedEngineSetup({ instance, signInOnly, authorizeAfterInstall }: { instance: InstanceInfo; signInOnly: boolean; authorizeAfterInstall: boolean }) {'],
    ['const timer = window.setInterval(() => void refreshInstances(), 2_000);',
      'const timer = window.setInterval(() => void refreshInstances().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause))), 2_000);'],
    ['  const run = async (kind: NonNullable<typeof busy>, action: () => Promise<void>) => {',
      '  useEffect(() => {\n    if (!flow || !instance.snapshot.authenticated) return;\n    void refreshModels(instance.instanceId).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));\n  }, [flow, instance.snapshot.authenticated, instance.instanceId, refreshModels]);\n\n  const run = async (kind: NonNullable<typeof busy>, action: () => Promise<void>) => {'],
    ['      await api(`/api/instances/${encodeURIComponent(instance.instanceId)}/install`, { method: "POST" });',
      '      const { instances } = await api(`/api/instances/${encodeURIComponent(instance.instanceId)}/install`, { method: "POST" });\n      const installed = (instances as InstanceInfo[] | undefined)?.find((candidate) => candidate.instanceId === instance.instanceId);\n      if (installed?.snapshot.state !== "available") {\n        throw new Error(t("engineSetup.installNotVerified", { reason: installed?.snapshot.reason ?? t("engineSetup.noReason") }));\n      }\n      if (authorizeAfterInstall && installed.snapshot.authenticated === false) await beginSignIn();'],
    ['  const signIn = () => run("signin", async () => {', '  const beginSignIn = async () => {'],
    ['  const complete = () => run("complete", async () => {', '  const signIn = () => run("signin", beginSignIn);\n\n  const complete = () => run("complete", async () => {'],
    ['    else window.open(auth.authorizationUrl, "_blank", "noopener,noreferrer");\n  });',
      '    else window.open(auth.authorizationUrl, "_blank", "noopener,noreferrer");\n  };'],
    ['const [connectAfterInstall, setConnectAfterInstall] = useState(false);',
      'const [connectAfterInstall, setConnectAfterInstall] = useState<string | null>(null);'],
    ['autoStart={connectAfterInstall} />', 'autoStart={connectAfterInstall === instance.instanceId} />'],
    ['autoStart={connectAfterInstall} />', 'autoStart={connectAfterInstall === instance.instanceId} />'],
    ['onInstalled={() => setConnectAfterInstall(true)}', 'onInstalled={() => setConnectAfterInstall(instance.instanceId)}'],
    ['<ManagedEngineSetup instance={instance} signInOnly={signInOnly} />',
      '<ManagedEngineSetup key={instance.instanceId} instance={instance} signInOnly={signInOnly} authorizeAfterInstall={intent === "cloud"} />'],
  ]);
  for (const path of ["src/components/DeviceSignIn.tsx", "src/components/ClaudeSignIn.tsx"]) {
    edit(path, [
      ['import { useEffect, useState } from "react";', 'import { useEffect, useState } from "react";\nimport { useAutoProviderSignIn } from "@/aiking/use-auto-provider-sign-in";'],
      ['useEffect(() => { if (autoStart) void start(); }, [autoStart]);', 'useAutoProviderSignIn(instanceId, autoStart, start);'],
    ]);
  }
  edit("src/components/ClaudeSignIn.tsx", [
    ['import { api } from "@/state/store";', 'import { api } from "@/state/store";\nimport { openExternalLink } from "@/lib/app-links";'],
    ['      if (next.phase === "succeeded") await refresh();',
      '      if (next.phase === "succeeded") await refresh();\n      else if (next.phase === "waiting") {\n        const link = claudeSignInLink(next.authorizationUrl);\n        if (link) await openExternalLink(link);\n      }'],
  ]);
  edit("src/components/DeviceSignIn.tsx", [
    ['else if (browserPkce && next.phase === "waiting") {\n        const link = chatgptPlanLink(next.authorizationUrl);',
      'else if (next.phase === "waiting") {\n        const link = browserPkce ? chatgptPlanLink(next.authorizationUrl) : isDeviceSignInCode(provider, next.userCode) ? deviceSignInLink(provider, next.authorizationUrl, next.userCode) : null;'],
  ]);
}
