import { addressApi } from "@/lib/address-api";
export async function GET() { return addressApi("list", (book, userId) => book.list(userId)); }
export async function POST(request: Request) { return addressApi("create", async (book, userId) => book.create(userId, await request.json())); }
