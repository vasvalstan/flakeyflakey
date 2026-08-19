import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import type {
  StudioSavedFlow,
  StudioSavedFlowId,
  StudioSavedFlowSummary,
} from "../src/studio/types";

const SAVED_FLOW_SCHEMA_VERSION = 1;
const MAX_SAVED_FLOWS = 250;
const MAX_SAVED_FLOW_PAYLOAD_BYTES = 5_000_000;
const MAX_SCREENSHOT_BYTES = 5_000_000;
const MAX_SAVED_FLOW_SCREENSHOT_BYTES = 100_000_000;
const MAX_SAVED_FLOW_DATABASE_BYTES = 2_000_000_000;
const SAFE_ID = /^[A-Za-z0-9-]{1,80}$/;

type SavedFlowRow = {
  id: string;
  name: string;
  description: string | null;
  initial_url: string;
  final_url: string;
  page_title: string;
  action_count: number;
  assertion_count: number;
  screenshot_count: number;
  enriched_action_count: number;
  recorded_at: string;
  created_at: string;
  updated_at: string;
};

type SavedFlowPayloadRow = {
  payload_json: string;
};

type ScreenshotRow = {
  image: Uint8Array;
};

export type SavedFlowScreenshot = {
  actionId: string;
  phase: "before" | "after";
  image: Uint8Array;
};

function assertSafeId(value: string, label: string): void {
  if (!SAFE_ID.test(value)) throw new Error(`${label} is invalid`);
}

function summaryFromRow(row: SavedFlowRow): StudioSavedFlowSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    initialUrl: row.initial_url,
    finalUrl: row.final_url,
    pageTitle: row.page_title,
    actionCount: row.action_count,
    assertionCount: row.assertion_count,
    screenshotCount: row.screenshot_count,
    enrichedActionCount: row.enriched_action_count,
    recordedAt: row.recorded_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseSavedFlow(payload: string): StudioSavedFlow {
  const value = JSON.parse(payload) as Partial<StudioSavedFlow>;
  if (
    value.schemaVersion !== SAVED_FLOW_SCHEMA_VERSION
    || typeof value.id !== "string"
    || typeof value.name !== "string"
    || !Array.isArray(value.actions)
    || typeof value.generatedCode !== "string"
  ) {
    throw new Error("Saved flow payload is invalid");
  }
  return value as StudioSavedFlow;
}

export class SavedFlowStore {
  private readonly database: Database;

  constructor(databasePath: string) {
    const resolvedPath = resolve(databasePath);
    mkdirSync(dirname(resolvedPath), { recursive: true });
    this.database = new Database(resolvedPath, { create: true, strict: true });
    this.database.exec("PRAGMA journal_mode = WAL");
    this.database.exec("PRAGMA foreign_keys = ON");
    this.database.exec("PRAGMA busy_timeout = 5000");
    this.database.exec("PRAGMA synchronous = NORMAL");
    this.database.exec("PRAGMA secure_delete = ON");
    const version = this.database.query("PRAGMA user_version").get() as {
      user_version: number;
    };
    if (version.user_version > SAVED_FLOW_SCHEMA_VERSION) {
      this.database.close(false);
      throw new Error(
        `Saved flow database version ${version.user_version} is newer than this app supports`,
      );
    }
    if (version.user_version === 0) {
      this.database.exec(`
        CREATE TABLE IF NOT EXISTS saved_flows (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          initial_url TEXT NOT NULL,
          final_url TEXT NOT NULL,
          page_title TEXT NOT NULL,
          action_count INTEGER NOT NULL,
          assertion_count INTEGER NOT NULL,
          screenshot_count INTEGER NOT NULL,
          enriched_action_count INTEGER NOT NULL,
          recorded_at TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          payload_json TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS saved_flows_updated_at
          ON saved_flows(updated_at DESC);

        CREATE TABLE IF NOT EXISTS saved_flow_screenshots (
          flow_id TEXT NOT NULL,
          action_id TEXT NOT NULL,
          phase TEXT NOT NULL CHECK (phase IN ('before', 'after')),
          image BLOB NOT NULL,
          PRIMARY KEY (flow_id, action_id, phase),
          FOREIGN KEY (flow_id) REFERENCES saved_flows(id) ON DELETE CASCADE
        );

        PRAGMA user_version = ${SAVED_FLOW_SCHEMA_VERSION};
      `);
    }
  }

  list(): StudioSavedFlowSummary[] {
    const rows = this.database.query(`
      SELECT id, name, description, initial_url, final_url, page_title,
        action_count, assertion_count, screenshot_count, enriched_action_count,
        recorded_at, created_at, updated_at
      FROM saved_flows
      ORDER BY updated_at DESC
    `).all() as SavedFlowRow[];
    return rows.map(summaryFromRow);
  }

  get(flowId: StudioSavedFlowId): StudioSavedFlow | null {
    assertSafeId(flowId, "Saved flow ID");
    const row = this.database.query(
      "SELECT payload_json FROM saved_flows WHERE id = ?1",
    ).get(flowId) as SavedFlowPayloadRow | null;
    return row ? parseSavedFlow(row.payload_json) : null;
  }

  save(flow: StudioSavedFlow, screenshots: SavedFlowScreenshot[]): StudioSavedFlow {
    assertSafeId(flow.id, "Saved flow ID");
    for (const screenshot of screenshots) {
      assertSafeId(screenshot.actionId, "Action ID");
      if (screenshot.image.byteLength > MAX_SCREENSHOT_BYTES) {
        throw new Error("Saved flow screenshot is too large");
      }
    }
    const screenshotBytes = screenshots.reduce(
      (total, screenshot) => total + screenshot.image.byteLength,
      0,
    );
    if (screenshotBytes > MAX_SAVED_FLOW_SCREENSHOT_BYTES) {
      throw new Error("Saved flow screenshots are too large");
    }
    const payloadJson = JSON.stringify(flow);
    const payloadBytes = new TextEncoder().encode(payloadJson).byteLength;
    if (payloadBytes > MAX_SAVED_FLOW_PAYLOAD_BYTES) {
      throw new Error("Saved flow payload is too large");
    }
    const existingBytes = this.database.query(`
      SELECT
        (
          SELECT COALESCE(SUM(length(CAST(payload_json AS BLOB))), 0)
          FROM saved_flows
          WHERE id <> ?1
        ) + (
          SELECT COALESCE(SUM(length(image)), 0)
          FROM saved_flow_screenshots
          WHERE flow_id <> ?1
        ) AS bytes
    `).get(flow.id) as { bytes: number };
    if (existingBytes.bytes + payloadBytes + screenshotBytes > MAX_SAVED_FLOW_DATABASE_BYTES) {
      throw new Error("Saved flow storage limit reached");
    }

    const existing = this.database.query(
      "SELECT 1 AS present FROM saved_flows WHERE id = ?1",
    ).get(flow.id) as { present: number } | null;
    if (!existing) {
      const count = this.database.query(
        "SELECT COUNT(*) AS count FROM saved_flows",
      ).get() as { count: number };
      if (count.count >= MAX_SAVED_FLOWS) {
        throw new Error(`Saved flow limit of ${MAX_SAVED_FLOWS} reached`);
      }
    }

    const persist = this.database.transaction(() => {
      this.database.query(`
        INSERT INTO saved_flows (
          id, name, description, initial_url, final_url, page_title,
          action_count, assertion_count, screenshot_count, enriched_action_count,
          recorded_at, created_at, updated_at, payload_json
        ) VALUES (
          $id, $name, $description, $initialUrl, $finalUrl, $pageTitle,
          $actionCount, $assertionCount, $screenshotCount, $enrichedActionCount,
          $recordedAt, $createdAt, $updatedAt, $payloadJson
        )
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          description = excluded.description,
          initial_url = excluded.initial_url,
          final_url = excluded.final_url,
          page_title = excluded.page_title,
          action_count = excluded.action_count,
          assertion_count = excluded.assertion_count,
          screenshot_count = excluded.screenshot_count,
          enriched_action_count = excluded.enriched_action_count,
          recorded_at = excluded.recorded_at,
          updated_at = excluded.updated_at,
          payload_json = excluded.payload_json
      `).run({
        id: flow.id,
        name: flow.name,
        description: flow.description ?? null,
        initialUrl: flow.initialUrl,
        finalUrl: flow.finalUrl,
        pageTitle: flow.pageTitle,
        actionCount: flow.actionCount,
        assertionCount: flow.assertionCount,
        screenshotCount: flow.screenshotCount,
        enrichedActionCount: flow.enrichedActionCount,
        recordedAt: flow.recordedAt,
        createdAt: flow.createdAt,
        updatedAt: flow.updatedAt,
        payloadJson,
      });

      this.database.query(
        "DELETE FROM saved_flow_screenshots WHERE flow_id = ?1",
      ).run(flow.id);
      const insertScreenshot = this.database.query(`
        INSERT INTO saved_flow_screenshots (flow_id, action_id, phase, image)
        VALUES ($flowId, $actionId, $phase, $image)
      `);
      for (const screenshot of screenshots) {
        insertScreenshot.run({
          flowId: flow.id,
          actionId: screenshot.actionId,
          phase: screenshot.phase,
          image: screenshot.image,
        });
      }
    });

    persist.immediate();
    return structuredClone(flow);
  }

  delete(flowId: StudioSavedFlowId): boolean {
    assertSafeId(flowId, "Saved flow ID");
    return this.database.query(
      "DELETE FROM saved_flows WHERE id = ?1",
    ).run(flowId).changes > 0;
  }

  screenshot(
    flowId: StudioSavedFlowId,
    actionId: string,
    phase: "before" | "after",
  ): Uint8Array | null {
    assertSafeId(flowId, "Saved flow ID");
    assertSafeId(actionId, "Action ID");
    const row = this.database.query(`
      SELECT image
      FROM saved_flow_screenshots
      WHERE flow_id = ?1 AND action_id = ?2 AND phase = ?3
    `).get(flowId, actionId, phase) as ScreenshotRow | null;
    if (!row) return null;
    const image = new Uint8Array(row.image.byteLength);
    image.set(row.image);
    return image;
  }

  close(): void {
    this.database.close(false);
  }
}
