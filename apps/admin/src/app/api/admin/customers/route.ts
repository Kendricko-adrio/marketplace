import { NextRequest, NextResponse } from "next/server";
import { listCustomers } from "@/features/customers/customer-list-repository";
import { createModuleLogger, withRequestContext } from "@/lib/logger";
import { parsePagination } from "@/lib/pagination";
import { guard } from "@/lib/rbac/guard";

const log = createModuleLogger("admin-customers");
const privateHeaders = { "Cache-Control": "private, no-store" };

async function listCustomerRows(request: NextRequest): Promise<Response> {
  const access = await guard("customers", "view");
  if (!access.ok) return access.response;

  try {
    const params = request.nextUrl.searchParams;
    const { page, limit } = parsePagination(params.get("page"), params.get("limit"), 10);
    const search = params.get("search")?.trim() ?? "";
    const result = await listCustomers({ page, limit, search });
    log.info(`customers.list (page ${result.page}, limit ${limit}, total ${result.total}, hasSearch ${search !== ""}, outcome success)`);
    return NextResponse.json({
      success: true,
      data: result.rows,
      pagination: { page: result.page, limit, total: result.total, totalPages: result.totalPages },
    }, { headers: privateHeaders });
  } catch {
    // Never expose SQL, search input or profile fields from a caught error.
    log.error("customers.list gagal (outcome error)", new Error("customer list query failed"));
    return NextResponse.json({ success: false, error: "Gagal memuat customer." }, {
      status: 500, headers: privateHeaders,
    });
  }
}

export const GET = withRequestContext(listCustomerRows, "admin-customers");
