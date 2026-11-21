import { describe, expect, it } from "vitest";
import {
  FeedbackSupportService,
  sanitizeFeedbackText,
  type FeedbackRepository,
} from "./index.js";

const head = "SYNTHETIC_OPAQUE_PRIVATE_HEAD";
const tail = "SYNTHETIC_OPAQUE_PRIVATE_TAIL";
const escapes = [
  { name: "hex", delimiter: "\\x3d", space: "\\x20" },
  { name: "hex-uppercase", delimiter: "\\x3D", space: "\\x09" },
  { name: "unknown-letter", delimiter: "\\q", space: "\\z" },
  { name: "incomplete-hex", delimiter: "\\x", space: "\\q" },
  { name: "malformed-unicode", delimiter: "\\u00ZZ", space: "\\u0XYZ" },
  { name: "legacy-octal", delimiter: "\\075", space: "\\040" },
  { name: "unknown-uppercase", delimiter: "\\Q", space: "\\Z" },
  { name: "unknown-control", delimiter: "\\cA", space: "\\cB" },
];
const forms = [
  { name: "strict", key: '"', value: '"' },
  { name: "pseudo", key: "'", value: "'" },
  { name: "mixed-value", key: '"', value: "'" },
  { name: "mixed-key", key: "'", value: '"' },
];
const samples = forms.flatMap((form) =>
  escapes.flatMap((escape) =>
    ["password", "token", "api-key", "label"].flatMap((prefix) => {
      // Deliberately keep ONE backslash in the diagnostic token. Calling
      // JSON.stringify on this key would turn it into a valid escaped label.
      const key = prefix + escape.delimiter + head + escape.space + tail;
      const doc =
        "{" +
        form.key +
        key +
        form.key +
        ":" +
        form.value +
        "ordinary" +
        form.value +
        ',"trace":"Рабочий جهاز🙂","id":9007199254740993,' +
        '"amount":1.2300e+30}';
      const name = form.name + "/" + escape.name + "/" + prefix;
      return [
        { name: name + "/direct", text: doc },
        { name: name + "/prose", text: "diagnostic " + doc },
        { name: name + "/severity", text: "[INFO] " + doc },
        {
          name: name + "/nested",
          text:
            '{"diagnostic":' +
            JSON.stringify(doc) +
            ',"outerId":9007199254740995}',
        },
      ];
    }),
  ),
);

async function fourCopies(description: string): Promise<string[]> {
  const copies: string[] = [];
  const repository = {
    createCase: async (
      input: Parameters<FeedbackRepository["createCase"]>[0],
    ) => {
      copies.push(input.description, input.body.description);
      throw new Error("SYNTHETIC_CAPTURE");
    },
    getOwnCase: async () => ({}),
    addFollowup: async (input: { body: string }) => {
      copies.push(input.body);
      throw new Error("SYNTHETIC_CAPTURE");
    },
  } as unknown as FeedbackRepository;
  const service = new FeedbackSupportService(repository);
  const id = "00000000-0000-4000-8000-000000000001";
  await expect(
    service.createCase(id, { accountId: id, category: "OTHER", description }),
  ).rejects.toThrow("SYNTHETIC_CAPTURE");
  await expect(
    service.addUserFollowup(id, id, { description }),
  ).rejects.toThrow("SYNTHETIC_CAPTURE");
  await expect(
    service.addAdminFollowup("SUPPORT", id, id, { description }),
  ).rejects.toThrow("SYNTHETIC_CAPTURE");
  expect(copies).toHaveLength(4);
  return copies;
}

describe("opaque diagnostic keys fail closed without guessed escape semantics", () => {
  it.each(samples)(
    "masks the complete opaque key and value in all four sinks: $name",
    async ({ text }) => {
      for (const output of [
        sanitizeFeedbackText(text),
        ...(await fourCopies(text)),
      ]) {
        expect(output).not.toContain(head);
        expect(output).not.toContain(tail);
        expect(output).not.toContain("ordinary");
        expect(output).toContain("[REDACTED_SECRET]");
        expect(output).toContain("Рабочий جهاز🙂");
        expect(output).toContain("9007199254740993");
        expect(output).toContain("1.2300e+30");
      }
    },
  );

  it.each([
    '{"label\\u0061":"Рабочий جهاز🙂","id":9007199254740993}',
    "{'cafe\\u00e9':'Рабочий جهاز🙂','id':9007199254740993}",
    '{"safe\\tlabel":"ordinary","amount":1.2300e+30}',
    '{"safe\\nlabel":"ordinary","amount":1.2300e+30}',
    '{"safe\\\\label":"ordinary","id":9007199254740993}',
    '{"ключ":"Рабочий جهاز🙂","id":9007199254740993}',
  ])(
    "preserves a fully decoded supported benign key exactly: %s",
    async (text) => {
      expect(sanitizeFeedbackText(text)).toBe(text);
      for (const copy of await fourCopies(text)) {
        expect(copy).toContain(
          text.includes("ordinary") ? "ordinary" : "Рабочий جهاز🙂",
        );
        expect(copy).not.toContain("[REDACTED_SECRET]");
      }
    },
  );

  it.each([
    '{"password\\x3d' + head + "\\x20" + tail,
    "{'token\\q" + head + "\\z" + tail,
    '{"label\\Q' + head + "\\Z" + tail + '":',
    "{'api-key\\cA" + head + "\\cB" + tail + "':",
  ])(
    "also masks a truncated opaque key without a proven value: %s",
    async (text) => {
      for (const output of [
        sanitizeFeedbackText(text),
        ...(await fourCopies(text)),
      ]) {
        expect(output).not.toContain(head);
        expect(output).not.toContain(tail);
        expect(output).toContain("[REDACTED_SECRET]");
      }
    },
  );
});
