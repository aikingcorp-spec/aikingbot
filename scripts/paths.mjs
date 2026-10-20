// Copyright (c) 2026 AIKING.
// Where things are, for every script. AIKING_RUNTIME_ROOT moves the build output (default: .build in the repository).
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
export const foundationRoot = dirname(fileURLToPath(import.meta.url));
export const repositoryRoot = resolve(foundationRoot, "..");
export const coreRoot = join(repositoryRoot, "packages/core");
export const sourceRoot = join(repositoryRoot, "apps/desktop");
export const runtimeRoot = process.env.AIKING_RUNTIME_ROOT ? resolve(process.env.AIKING_RUNTIME_ROOT) : join(repositoryRoot, ".build");
