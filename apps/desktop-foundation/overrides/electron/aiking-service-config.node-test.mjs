// Copyright (c) 2026 AIKING.
import assert from "node:assert/strict";
import { it } from "node:test";
import { serviceOrigin } from "./aiking-service-config.mjs";
it("leaves hosted services unconfigured until explicitly selected", () => { assert.equal(serviceOrigin(undefined), ""); assert.equal(serviceOrigin(""), ""); });
it("accepts an operator's own HTTPS origin", () => { assert.equal(serviceOrigin("https://cloud.example.test"), "https://cloud.example.test"); });
it("rejects insecure, credentialed or path-based service configuration", () => { for (const value of ["http://example.test", "https://user:pass@example.test", "https://example.test/path", "https://example.test/?key=secret"]) assert.throws(() => serviceOrigin(value)); });
