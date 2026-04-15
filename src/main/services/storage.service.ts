import Database from "better-sqlite3";
import path from "path";
import { app } from "electron";
import { randomUUID } from "crypto";
import { DB_NAME } from "../../shared/constants";
import type { Message } from "../../shared/types";

export class StorageService {
  private db: Database.Database;

  constructor() {
    const dbPath = path.join(app.getPath("userData"), DB_NAME);
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.initTables();
  }

  private initTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        detected_lang TEXT NOT NULL,
        input_type TEXT NOT NULL CHECK(input_type IN ('keyboard', 'voice')),
        translation TEXT,
        target_lang TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
    this.db.exec(
      "CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at)",
    );
  }

  getMessages(limit?: number, beforeTimestamp?: number): Message[] {
    let sql =
      "SELECT id, text, detected_lang, input_type, translation, target_lang, created_at, updated_at FROM messages";
    const params: unknown[] = [];

    if (beforeTimestamp !== undefined) {
      sql += " WHERE created_at < ?";
      params.push(beforeTimestamp);
    }

    sql += " ORDER BY created_at DESC, rowid DESC";

    if (limit !== undefined) {
      sql += " LIMIT ?";
      params.push(limit);
    }

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as Array<{
      id: string;
      text: string;
      detected_lang: string;
      input_type: string;
      translation: string | null;
      target_lang: string | null;
      created_at: number;
      updated_at: number;
    }>;

    return rows.map((row) => ({
      id: row.id,
      text: row.text,
      detectedLang: row.detected_lang,
      inputType: row.input_type as "keyboard" | "voice",
      translation: row.translation ?? undefined,
      targetLang: row.target_lang ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })).reverse(); // Reverse to get chronological order (ASC)
  }

  saveMessage(
    message: Omit<Message, "id" | "createdAt" | "updatedAt">,
  ): Message {
    const id = randomUUID();
    const now = Date.now();

    const stmt = this.db.prepare(
      "INSERT INTO messages (id, text, detected_lang, input_type, translation, target_lang, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    );
    stmt.run(
      id,
      message.text,
      message.detectedLang,
      message.inputType,
      message.translation ?? null,
      message.targetLang ?? null,
      now,
      now,
    );

    return {
      id,
      text: message.text,
      detectedLang: message.detectedLang,
      inputType: message.inputType,
      translation: message.translation,
      targetLang: message.targetLang,
      createdAt: now,
      updatedAt: now,
    };
  }

  updateTranslation(
    messageId: string,
    translation: string,
    targetLang: string,
  ): void {
    const now = Date.now();
    const stmt = this.db.prepare(
      "UPDATE messages SET translation = ?, target_lang = ?, updated_at = ? WHERE id = ?",
    );
    stmt.run(translation, targetLang, now, messageId);
  }

  deleteMessage(messageId: string): void {
    const stmt = this.db.prepare("DELETE FROM messages WHERE id = ?");
    stmt.run(messageId);
  }

  clearMessages(): void {
    this.db.exec("DELETE FROM messages");
  }

  exportMessages(format: "txt" | "csv"): string {
    const messages = this.getMessages();

    if (format === "csv") {
      const header = "ID,Text,DetectedLang,InputType,Translation,TargetLang,CreatedAt,UpdatedAt";
      const rows = messages.map((m) => {
        const escape = (s: string | undefined) => {
          if (!s) return "";
          // Prevent CSV injection: prefix formula-triggering characters with a single quote
          let safe = s;
          if (/^[=+\-@\t\r]/.test(safe)) {
            safe = "'" + safe;
          }
          return `"${safe.replace(/"/g, '""')}"`;
        };
        return [
          escape(m.id),
          escape(m.text),
          m.detectedLang,
          m.inputType,
          escape(m.translation),
          m.targetLang ?? "",
          new Date(m.createdAt).toISOString(),
          new Date(m.updatedAt).toISOString(),
        ].join(",");
      });
      return [header, ...rows].join("\n");
    }

    // TXT format
    return messages
      .map((m) => {
        const time = new Date(m.createdAt).toLocaleString();
        const lines = [`[${time}] (${m.detectedLang}, ${m.inputType})`, m.text];
        if (m.translation) {
          lines.push(`→ [${m.targetLang}] ${m.translation}`);
        }
        return lines.join("\n");
      })
      .join("\n\n");
  }
}
