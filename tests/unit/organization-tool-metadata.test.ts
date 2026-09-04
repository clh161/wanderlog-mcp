import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AppContext } from "../../src/context.ts";
import { buildServer } from "../../src/server.ts";

describe("organization MCP tool metadata", () => {
  let client: Client;
  let server: ReturnType<typeof buildServer>;

  beforeEach(async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    server = buildServer({} as AppContext);
    client = new Client({ name: "metadata-test", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  it("publishes the new tools with explicit write annotations and input schemas", async () => {
    const response = await client.listTools();
    const byName = new Map(response.tools.map((tool) => [tool.name, tool]));

    for (const name of [
      "wanderlog_move_place",
      "wanderlog_reorder_places",
      "wanderlog_reorder_sections",
    ]) {
      expect(byName.get(name)?.annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
    }

    expect(byName.get("wanderlog_delete_section")?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    });
    expect(byName.get("wanderlog_add_section")?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    });
    expect(byName.get("wanderlog_update_section")?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });

    const moveSchema = byName.get("wanderlog_move_place")?.inputSchema;
    expect(moveSchema?.properties).toMatchObject({
      trip_key: { type: "string" },
      place_ref: { type: "string" },
      target_section: { type: "string" },
      target_day: { type: "string" },
      position: { type: "integer", exclusiveMinimum: 0 },
    });
    expect(moveSchema?.required).toEqual(expect.arrayContaining(["trip_key", "place_ref"]));

    const reorderSchema = byName.get("wanderlog_reorder_places")?.inputSchema;
    expect(reorderSchema?.required).toEqual(
      expect.arrayContaining(["trip_key", "place_ref", "position"]),
    );
  });
});
