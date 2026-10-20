import { describe, expect, it } from "vitest";

import { resolveAddressBarInput } from "./browser-address";

describe("resolveAddressBarInput", () => {
  it("opens what people type as addresses, with http for a dev server on this machine", () => {
    expect(resolveAddressBarInput("localhost:5173")).toBe("http://localhost:5173/");
    expect(resolveAddressBarInput("127.0.0.1:3000/path")).toBe("http://127.0.0.1:3000/path");
    expect(resolveAddressBarInput("[::1]:3000")).toBe("http://[::1]:3000/");
    expect(resolveAddressBarInput("cnn.com")).toBe("https://cnn.com/");
    expect(resolveAddressBarInput("google.com/maps")).toBe("https://google.com/maps");
    expect(resolveAddressBarInput("my-box.tailnet.ts.net")).toBe("https://my-box.tailnet.ts.net/");
    expect(resolveAddressBarInput("devbox:8080")).toBe("https://devbox:8080/");
    expect(resolveAddressBarInput("192.168.1.5:3000")).toBe("https://192.168.1.5:3000/");
    expect(resolveAddressBarInput(" https://example.com/a b ")).toBe("https://example.com/a%20b");
    expect(resolveAddressBarInput("http://example.com")).toBe("http://example.com/");
  });

  it("searches for a single word and for anything that is not an address", () => {
    expect(resolveAddressBarInput("google")).toBe("https://www.google.com/search?q=google");
    expect(resolveAddressBarInput("weather")).toBe("https://www.google.com/search?q=weather");
    expect(resolveAddressBarInput("how to center a div")).toBe("https://www.google.com/search?q=how%20to%20center%20a%20div");
    expect(resolveAddressBarInput("what is cnn.com")).toBe("https://www.google.com/search?q=what%20is%20cnn.com");
    expect(resolveAddressBarInput("what is 10:30")).toBe("https://www.google.com/search?q=what%20is%2010%3A30");
    expect(resolveAddressBarInput("note: buy milk")).toBe("https://www.google.com/search?q=note%3A%20buy%20milk");
  });

  it("opens nothing for empty input or a scheme the panel does not open", () => {
    for (const input of ["", "   ", "ftp://example.com", "mailto:alice@example.com", "data:text/plain,hello", "javascript:alert(1)", "ftp:21", "tel:5551234"]) {
      expect(resolveAddressBarInput(input)).toBeNull();
    }
  });
});
