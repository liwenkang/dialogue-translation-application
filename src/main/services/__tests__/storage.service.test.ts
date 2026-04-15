import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock electron app module before importing StorageService
vi.mock("electron", () => ({
  app: {
    getPath: () => "/tmp/test-dialogue-app",
  },
}));

// Fully mock better-sqlite3 with an in-memory store
function createMockDatabase() {
  const tables: Record<string, Record<string, unknown>[]> = {};

  function matchWhere(row: Record<string, unknown>, sql: string, params: unknown[]): boolean {
    const m = sql.match(/WHERE\s+(\w+)\s*=\s*\?/i);
    if (!m) return true;
    return row[m[1]] === params[params.length - 1];
  }

  const db = {
    pragma: vi.fn(),
    exec: vi.fn((sql: string) => {
      const createMatch = sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/i);
      if (createMatch && !tables[createMatch[1]]) {
        tables[createMatch[1]] = [];
      }
      const deleteMatch = sql.match(/DELETE FROM (\w+)/i);
      if (deleteMatch && tables[deleteMatch[1]]) {
        tables[deleteMatch[1]] = [];
      }
    }),
    prepare: vi.fn((sql: string) => {
      const insertMatch = sql.match(/INSERT INTO (\w+)\s*\(([^)]+)\)/i);
      const selectMatch = sql.match(/SELECT .+ FROM (\w+)/i);
      const updateMatch = sql.match(/UPDATE (\w+)\s+SET/i);

      if (insertMatch) {
        const tableName = insertMatch[1];
        const cols = insertMatch[2].split(",").map((c) => c.trim());
        return {
          run: (...values: unknown[]) => {
            if (!tables[tableName]) tables[tableName] = [];
            const row: Record<string, unknown> = {};
            cols.forEach((col, i) => (row[col] = values[i]));
            tables[tableName].push(row);
          },
        };
      }

      if (selectMatch) {
        const tableName = selectMatch[1];
        return {
          all: (...params: unknown[]) => {
            let rows = (tables[tableName] || []).map((r, i) => ({ ...r, _idx: i }));
            // Handle WHERE clause
            const whereMatch = sql.match(/WHERE\s+(\w+)\s*<\s*\?/i);
            if (whereMatch && params.length > 0) {
              const col = whereMatch[1];
              const val = params[0] as number;
              rows = rows.filter((r) => (r[col] as number) < val);
            }
            // Parse ORDER BY direction
            const isDesc = /ORDER BY .+DESC/i.test(sql);
            rows.sort((a, b) => {
              const diff = (a.created_at as number) - (b.created_at as number);
              if (diff !== 0) return isDesc ? -diff : diff;
              // Tiebreak by insertion order (simulates rowid)
              return isDesc ? b._idx - a._idx : a._idx - b._idx;
            });
            // Parse LIMIT
            const limitMatch = sql.match(/LIMIT\s*\?/i);
            if (limitMatch && params.length > 0) {
              const limitVal = params[params.length - 1] as number;
              rows = rows.slice(0, limitVal);
            }
            return rows.map(({ _idx, ...rest }) => rest);
          },
        };
      }

      if (updateMatch) {
        const tableName = updateMatch[1];
        // Parse SET columns: e.g. "translation = ?, target_lang = ?, updated_at = ?"
        const setClause = sql.match(/SET\s+(.+?)\s+WHERE/i);
        const setCols = setClause
          ? setClause[1].split(",").map((c) => c.split("=")[0].trim())
          : [];
        return {
          run: (...values: unknown[]) => {
            const whereVal = values[setCols.length]; // the WHERE param
            const rows = tables[tableName] || [];
            for (const row of rows) {
              if (row.id === whereVal) {
                setCols.forEach((col, i) => (row[col] = values[i]));
              }
            }
          },
        };
      }

      return { run: vi.fn(), all: vi.fn(() => []) };
    }),
  };
  return db;
}

vi.mock("better-sqlite3", () => {
  return {
    default: class MockDatabase {
      constructor() {
        const instance = createMockDatabase();
        return instance as any;
      }
    },
  };
});

// Import after mocks are set up
const { StorageService } = await import(
  "../storage.service"
);

describe("StorageService", () => {
  let service: InstanceType<typeof StorageService>;

  beforeEach(() => {
    service = new StorageService();
  });

  describe("saveMessage", () => {
    it("should save and return a message with generated id and timestamps", () => {
      const msg = service.saveMessage({
        text: "Hello",
        detectedLang: "en",
        inputType: "keyboard",
      });

      expect(msg.id).toBeDefined();
      expect(msg.text).toBe("Hello");
      expect(msg.detectedLang).toBe("en");
      expect(msg.inputType).toBe("keyboard");
      expect(msg.createdAt).toBeTypeOf("number");
      expect(msg.updatedAt).toBeTypeOf("number");
      expect(msg.translation).toBeUndefined();
    });

    it("should save a message with translation", () => {
      const msg = service.saveMessage({
        text: "你好",
        detectedLang: "zh",
        inputType: "voice",
        translation: "Hello",
        targetLang: "en",
      });

      expect(msg.translation).toBe("Hello");
      expect(msg.targetLang).toBe("en");
    });
  });

  describe("getMessages", () => {
    it("should return empty array when no messages", () => {
      const messages = service.getMessages();
      expect(messages).toEqual([]);
    });

    it("should return saved messages in chronological order", () => {
      service.saveMessage({
        text: "First",
        detectedLang: "en",
        inputType: "keyboard",
      });
      service.saveMessage({
        text: "Second",
        detectedLang: "en",
        inputType: "keyboard",
      });

      const messages = service.getMessages();
      expect(messages).toHaveLength(2);
      expect(messages[0].text).toBe("First");
      expect(messages[1].text).toBe("Second");
    });
  });

  describe("updateTranslation", () => {
    it("should update translation for an existing message", () => {
      const msg = service.saveMessage({
        text: "Hello",
        detectedLang: "en",
        inputType: "keyboard",
      });

      service.updateTranslation(msg.id, "你好", "zh");

      const messages = service.getMessages();
      expect(messages[0].translation).toBe("你好");
      expect(messages[0].targetLang).toBe("zh");
    });
  });

  describe("clearMessages", () => {
    it("should remove all messages", () => {
      service.saveMessage({
        text: "Hello",
        detectedLang: "en",
        inputType: "keyboard",
      });
      service.saveMessage({
        text: "World",
        detectedLang: "en",
        inputType: "keyboard",
      });

      service.clearMessages();
      const messages = service.getMessages();
      expect(messages).toEqual([]);
    });
  });
});
