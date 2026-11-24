"use server";

import { revalidatePath } from "next/cache";
import {
  addSandboxTestTerminal,
  checkTerminalPairing,
  removeTerminal,
  setSquareLocation,
  startTerminalPairing,
} from "@/domain/square";
import { AppError } from "@/lib/errors";
import { requireUser } from "@/lib/session";

type Result<T = object> = ({ status: "ok" } & T) | { status: "error"; error: string };

async function run<T extends object>(eventId: string, fn: (userId: string) => Promise<T>): Promise<Result<T>> {
  const user = await requireUser();
  try {
    const r = await fn(user.id);
    revalidatePath(`/e/${eventId}/settings`);
    return { status: "ok", ...r };
  } catch (err) {
    if (err instanceof AppError) return { status: "error", error: err.message };
    throw err;
  }
}

export async function setLocationAction(eventId: string, locationId: string) {
  return run(eventId, async (userId) => {
    await setSquareLocation({ userId }, eventId, locationId);
    return {};
  });
}

export async function startPairingAction(eventId: string, name: string) {
  return run(eventId, (userId) => startTerminalPairing({ userId }, eventId, name));
}

export async function checkPairingAction(eventId: string, codeId: string, name: string) {
  return run(eventId, async (userId) => ({ pairing: await checkTerminalPairing({ userId }, eventId, codeId, name) }));
}

export async function addTestTerminalAction(eventId: string) {
  return run(eventId, async (userId) => {
    await addSandboxTestTerminal({ userId }, eventId);
    return {};
  });
}

export async function removeTerminalAction(eventId: string, deviceId: string) {
  return run(eventId, async (userId) => {
    await removeTerminal({ userId }, eventId, deviceId);
    return {};
  });
}
