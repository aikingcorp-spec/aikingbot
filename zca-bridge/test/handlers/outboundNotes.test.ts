import { describe, it, expect } from "vitest";
import type { OutgoingEvent } from "../../src/chatwoot/webhookServer.js";
import {
  messageRef,
  errorReason,
  noSessionNote,
  downloadFailedNote,
  fileRejectedNote,
  windowNote,
  deadLetterNote,
  permanentSendNote,
} from "../../src/handlers/outboundNotes.js";

function evt(over: Partial<OutgoingEvent> = {}): OutgoingEvent {
  return { sourceId: "user:84900", content: "", chatwootMessageId: 679, inboxId: 3, attachments: [], ...over };
}

describe("messageRef", () => {
  it("names attachment files and includes the chatwoot message id", () => {
    const ref = messageRef(evt({ attachments: [{ dataUrl: "http://c/báo giá.pdf?x=1", fileType: "file" }, { dataUrl: "http://c/a.jpg", fileType: "image" }] }));
    expect(ref).toContain("«báo giá.pdf»");
    expect(ref).toContain("«a.jpg»");
    expect(ref).toContain("#679");
  });

  it("uses a content snippet when there are no attachments", () => {
    const ref = messageRef(evt({ content: "Xin chào anh, báo giá nhé" }));
    expect(ref).toContain("Xin chào anh");
    expect(ref).toContain("#679");
  });

  it("truncates a long content snippet", () => {
    const long = "a".repeat(200);
    const ref = messageRef(evt({ content: long }));
    expect(ref).toContain("…");
    expect(ref.length).toBeLessThan(long.length);
  });

  it("falls back to a generic word when there is neither attachment nor content", () => {
    expect(messageRef(evt())).toContain("#679");
  });
});

describe("errorReason", () => {
  it("returns the message of an Error", () => {
    expect(errorReason(new Error("OA upload failed: -210 file is invalid"))).toBe("OA upload failed: -210 file is invalid");
  });
  it("stringifies a non-Error", () => {
    expect(errorReason("boom")).toBe("boom");
  });
});

describe("failure notes", () => {
  it("deadLetterNote carries the message reference and the verbatim error reason", () => {
    const note = deadLetterNote(evt({ attachments: [{ dataUrl: "http://c/photo.jpg", fileType: "image" }] }), new Error("OA upload failed: -210 file is invalid. The file must be smaller than or equal 1MB"));
    expect(note).toMatch(/đã thử lại nhiều lần/);
    expect(note).toContain("«photo.jpg»");
    expect(note).toContain("#679");
    expect(note).toContain("OA upload failed: -210 file is invalid. The file must be smaller than or equal 1MB");
  });

  it("fileRejectedNote names the file, references the message, and shows the reason", () => {
    const note = fileRejectedNote(evt(), "big.png", new Error("OA upload failed: -210"));
    expect(note).toContain("«big.png»");
    expect(note).toContain("#679");
    expect(note).toContain("OA upload failed: -210");
    expect(note).toMatch(/Không gửi được tệp/);
  });

  it("downloadFailedNote names the file and references the message", () => {
    const note = downloadFailedNote(evt(), "doc.pdf");
    expect(note).toContain("«doc.pdf»");
    expect(note).toContain("#679");
    expect(note).toMatch(/Không tải được/i);
  });

  it("noSessionNote references the message and mentions the disconnect", () => {
    const note = noSessionNote(evt({ content: "hello" }));
    expect(note).toMatch(/mất kết nối/);
    expect(note).toContain("#679");
  });

  it("windowNote references the message and (when given) the verbatim reason", () => {
    const plain = windowNote(evt({ content: "hi" }));
    expect(plain).toMatch(/người dùng/);
    expect(plain).toContain("#679");

    const withReason = windowNote(evt({ content: "hi" }), new Error("OA send failed: -230 no interaction in 7 days"));
    expect(withReason).toContain("OA send failed: -230 no interaction in 7 days");
    expect(withReason).toContain("#679");
  });

  it("permanentSendNote references the message and shows the verbatim reason", () => {
    const note = permanentSendNote(evt({ content: "hi" }), new Error("OA send failed: -211 Out of quota"));
    expect(note).toMatch(/Không gửi được/);
    expect(note).toContain("OA send failed: -211 Out of quota");
    expect(note).toContain("#679");
  });
});
