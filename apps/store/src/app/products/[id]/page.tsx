import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  buildProductMetadata,
  getCachedProductDetail,
} from "@/features/products/get-product-detail";
import ProductDetailClient from "./ProductDetailClient";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const product = await getCachedProductDetail(id);
  return buildProductMetadata(product);
}

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const product = await getCachedProductDetail(id);

  if (!product) {
    notFound();
  }

  return <ProductDetailClient product={product} />;
}
