export async function initializeReservedOrderPayment<T>({
  create,
  persist,
  compensate,
}: {
  create: () => Promise<T>;
  persist: (payment: T) => Promise<void>;
  compensate: (error: unknown) => Promise<void>;
}): Promise<{ payment: T; persistenceError?: unknown }> {
  let payment: T;
  try {
    payment = await create();
  } catch (error) {
    await compensate(error);
    throw error;
  }

  try {
    await persist(payment);
    return { payment };
  } catch (persistenceError) {
    // The external transaction already exists. Never claim it failed or create
    // a second transaction; return it to the caller and let reconciliation
    // repair the local metadata.
    return { payment, persistenceError };
  }
}
