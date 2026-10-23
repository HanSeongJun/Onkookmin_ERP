import { redirect } from "next/navigation"

import { buildProductModalHref } from "@/lib/products/schema"

/**
 * "/products/<id>/edit" (old edit page): opens the list with the 상품 수정
 * modal for this product instead.
 */
export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  redirect(buildProductModalHref("", { mode: "edit", id }))
}
