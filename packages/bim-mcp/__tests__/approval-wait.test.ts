/**
 * @jest-environment node
 *
 * A person takes their time: the approval box in their assistant (MCP
 * elicitation) stays open until they answer it, not for the MCP library's
 * 60 s request default. Fails when the box is asked with the default
 * timeout: a "yes" given after a minute is thrown away and the change
 * doesn't land.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { APPROVAL_BOX_WAIT_MS, approvalIoFromRequest } from "@permitzip/bim-mcp";

/** A server whose one tool asks the person to approve, and a client whose person answers after `answerAfterMs`. */
async function connect(answerAfterMs: number, approve: boolean): Promise<Client> {
  const server = new McpServer({ name: "approval-wait", version: "0.0.0" });
  server.registerTool("land", { description: "Asks the person, then says what they answered." }, async (extra) => {
    const said = await approvalIoFromRequest(extra).confirm("Land this change?");
    return { content: [{ type: "text" as const, text: said }] };
  });
  const client = new Client({ name: "person", version: "0.0.0" }, { capabilities: { elicitation: {} } });
  client.setRequestHandler(ElicitRequestSchema, async () => {
    await new Promise((resolve) => setTimeout(resolve, answerAfterMs));
    return { action: "accept" as const, content: { approve } };
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return client;
}

/** Calls the tool with no client-side timeout of its own, moving the clock past the person's answer. */
async function land(client: Client, answerAfterMs: number): Promise<string> {
  const call = client.callTool({ name: "land", arguments: {} }, undefined, { timeout: 60 * 60_000 });
  await jest.advanceTimersByTimeAsync(answerAfterMs + 1_000);
  const result = (await call) as { content: { type: string; text: string }[] };
  return result.content[0]?.text ?? "";
}

describe("the approval box waits for the person", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("keeps a yes given after 90 seconds (past the MCP library's 60 s default)", async () => {
    const client = await connect(90_000, true);
    await expect(land(client, 90_000)).resolves.toBe("approved");
  });

  it("keeps a no given after 90 seconds", async () => {
    const client = await connect(90_000, false);
    await expect(land(client, 90_000)).resolves.toBe("declined");
  });

  it("waits several minutes, not one", () => {
    expect(APPROVAL_BOX_WAIT_MS).toBeGreaterThanOrEqual(5 * 60_000);
  });
});
