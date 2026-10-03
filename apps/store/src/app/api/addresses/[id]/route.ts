import { addressApi } from "@/lib/address-api";
type Params = { params: Promise<{ id: string }> };
export async function PATCH(request: Request, { params }: Params) { return addressApi("update", async (book, userId) => book.update(userId, (await params).id, await request.json())); }
export async function DELETE(_request: Request, { params }: Params) { return addressApi("remove", async (book, userId) => book.remove(userId, (await params).id)); }
