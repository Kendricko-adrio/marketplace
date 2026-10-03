import { addressApi } from "@/lib/address-api";
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) { return addressApi("set-default", async (book, userId) => book.setDefault(userId, (await params).id)); }
