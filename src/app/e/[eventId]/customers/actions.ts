"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  createSale,
  deleteCustomer,
  takeCashPayment,
  updateCustomer,
  type DuplicateMatch,
  type SaleInput,
} from "@/domain/customers";
import { renameGroup } from "@/domain/groups";
import { AppError } from "@/lib/errors";
import { requireUser } from "@/lib/session";

export type SaleActionResult =
  | { status: "created"; groupId: string; count: number }
  | { status: "duplicate"; matches: DuplicateMatch[] }
  | { status: "error"; error: string };

async function run<T>(fn: () => Promise<T>): Promise<T | { status: "error"; error: string }> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AppError) return { status: "error", error: err.message };
    throw err;
  }
}

export async function saleAction(eventId: string, input: SaleInput): Promise<SaleActionResult> {
  const user = await requireUser();
  const result = await run(() => createSale({ userId: user.id }, eventId, input));
  if (result.status === "created") {
    revalidatePath(`/e/${eventId}/customers`);
    return { status: "created", groupId: result.groupId, count: result.customerIds.length };
  }
  return result;
}

export async function updateCustomerAction(
  customerId: string,
  input: { name: string; phone: string; email: string; notes: string; confirmDuplicates?: boolean },
) {
  const user = await requireUser();
  return run(() => updateCustomer({ userId: user.id }, customerId, input));
}

export async function deleteCustomerAction(eventId: string, customerId: string) {
  const user = await requireUser();
  await deleteCustomer({ userId: user.id }, customerId);
  revalidatePath(`/e/${eventId}/customers`);
  redirect(`/e/${eventId}/customers`);
}

export async function takeCashAction(eventId: string, customerIds: string[]) {
  const user = await requireUser();
  const result = await run(async () => {
    await takeCashPayment({ userId: user.id }, eventId, customerIds);
    return { status: "saved" as const };
  });
  revalidatePath(`/e/${eventId}/customers`);
  return result;
}

export async function renameGroupAction(groupId: string, name: string) {
  const user = await requireUser();
  return run(async () => {
    await renameGroup({ userId: user.id }, groupId, name);
    return { status: "saved" as const };
  });
}
