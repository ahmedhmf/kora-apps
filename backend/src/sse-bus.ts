import { Response } from 'express';

// ─── In-process SSE Client Registry ──────────────────────────────────────────
// All connected admin SSE clients are tracked here. When a new submission
// is saved, broadcastSubmission() fans it out to every open connection.

const clients = new Set<Response>();

export function addSseClient(res: Response): void {
  clients.add(res);
}

export function removeSseClient(res: Response): void {
  clients.delete(res);
}

export function broadcastSubmission(data: Record<string, unknown>): void {
  const payload = `event: submission\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    try {
      client.write(payload);
    } catch {
      // Client disconnected mid-write — remove it
      clients.delete(client);
    }
  }
}

export function broadcastHeartbeat(): void {
  const payload = `: heartbeat\n\n`;
  for (const client of clients) {
    try {
      client.write(payload);
    } catch {
      clients.delete(client);
    }
  }
}
