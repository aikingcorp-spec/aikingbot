import { rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeMessageDb, deleteThread, insertMessage } from "./message-db.ts";
import { buildRecall, foldedConversationHits, foldedMemoryPassages } from "./recall.ts";
import { foldVietnamese } from "./vi-fold.ts";
import { MEMORY_CORE_BYTES, memoryCore, memorySystemPrompt, writeMemoryFile, writeMemoryTopic, WORKSPACES_DIR } from "./workspace.ts";

const BOT = "bot-recall-vi-test";
const filler = Array.from({ length: 40 }, (_, i) => `- Ghi chú phụ số ${i}: không quan trọng lắm`).join("\n");
const FACTS = [
  "- Sếp thích uống cà phê đen không đường",
  "- Sinh nhật của vợ sếp là ngày 12 tháng 3",
  "- Số tài khoản ngân hàng dùng cho lương là Vietcombank",
  "- Con trai học trường Lê Quý Đôn ở quận 3",
  "- Họp giao ban mỗi thứ Hai lúc 9 giờ sáng",
];

describe("1.9 memory core ≤ 1.5 KB, top-k recall, diacritic folding", () => {
  beforeAll(() => {
    rmSync(join(WORKSPACES_DIR, BOT), { recursive: true, force: true });
    writeMemoryFile(BOT, `# Memory\n- Tên sếp là Khoa\n${filler}\n${FACTS.join("\n")}\n`);
    writeMemoryTopic(BOT, "du-lich.md", "---\ntitle: Du lịch\naliases: [chuyến đi, travel]\n---\n- Chuyến đi Đà Nẵng tháng 11 đã đặt khách sạn Mường Thanh\n- Hãng bay ưa thích là Vietnam Airlines\n");
    writeMemoryTopic(BOT, "suc-khoe.md", "---\ntitle: Sức khỏe\naliases: [health]\n---\n- Bác sĩ nha khoa là bác sĩ Tuấn ở Nha Khoa Kim\n- Dị ứng tôm cua\n");
  });
  afterAll(() => { closeMessageDb(); rmSync(join(WORKSPACES_DIR, BOT), { recursive: true, force: true }); });

  it("folds Vietnamese diacritics and đ", () => {
    expect(foldVietnamese("Cà phê ĐEN đường")).toBe("ca phe den duong");
  });

  it("puts only the core (≤ 1.5 KB) of MEMORY.md in the prompt", () => {
    const prompt = memorySystemPrompt(BOT, { managedWrites: true, fileTools: false });
    const block = prompt.split("Your memory (MEMORY.md):\n")[1]!.split(" [MEMORY.md is")[0]!;
    expect(Buffer.byteLength(block, "utf8")).toBeLessThanOrEqual(MEMORY_CORE_BYTES);
    expect(block).toContain("Tên sếp là Khoa");
    expect(block).not.toContain("cà phê đen");
    expect(memoryCore("a\nb", 10)).toEqual({ text: "a\nb", cut: false });
  });

  const QUESTIONS: Array<[string, string]> = [
    ["sep thich uong ca phe gi", "cà phê đen"],
    ["sinh nhat vo sep ngay nao", "ngày 12 tháng 3"],
    ["tai khoan ngan hang luong", "Vietcombank"],
    ["con trai hoc truong nao", "Lê Quý Đôn"],
    ["hop giao ban luc may gio", "9 giờ sáng"],
    ["khach san chuyen di da nang", "Mường Thanh"],
    ["hang bay ua thich", "Vietnam Airlines"],
    ["bac si nha khoa ten gi", "bác sĩ Tuấn"],
    ["sếp có dị ứng gì không", "tôm cua"],
    ["Cà phê sếp uống có đường không", "không đường"],
  ];
  it.each(QUESTIONS)("recalls across sessions: %s", (question, expected) => {
    const recall = buildRecall({ botId: BOT, message: question, threadIds: [], label: () => "", author: () => "" });
    expect(recall?.text).toContain(expected);
    expect(recall!.notes).toBeLessThanOrEqual(4);
  });

  it("returns only the top few lines, never the whole file", () => {
    const hits = foldedMemoryPassages(BOT, "ghi chu phu khong quan trong");
    expect(hits.length).toBeLessThanOrEqual(4);
  });
});

describe("1.9 chat history recall folds Vietnamese", () => {
  const THREAD = "th-recall-vi-folded";
  const say = (id: string, text: string, at: number) => insertMessage(THREAD, { id, role: "user", kind: "text", text, at });
  beforeAll(() => {
    say("m1", "Nhớ giúp tôi: chuyến công tác Đà Nẵng đi ngày 14 tháng 11", 1);
    say("m2", "Mật mã wifi văn phòng mới là cá-heo-xanh", 2);
    say("m3", "Hôm nay trời đẹp", 3);
  });
  afterAll(() => { deleteThread(THREAD); closeMessageDb(); });
  const recall = (message: string) => buildRecall({ botId: "bot-recall-vi-chat", message, threadIds: [THREAD], label: () => "Chat", author: () => "Khoa" });

  it("finds an earlier message written with diacritics and đ from a query typed without them", () => {
    expect(foldedConversationHits([THREAD], "cong tac da nang ngay nao").map((hit) => hit.messageId)).toEqual(["m1"]);
    const text = recall("chuyen cong tac da nang ngay nao")?.text ?? "";
    expect(text).toContain("14 tháng 11");
    expect(text).not.toContain("trời đẹp");
  });
  it("keeps the exact FTS path and does not duplicate a hit", () => {
    const result = recall("mật mã wifi văn phòng");
    expect(result?.conversations).toBe(1);
    expect(result?.text).toContain("cá-heo-xanh");
  });
});
