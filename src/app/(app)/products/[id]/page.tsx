import { redirect } from "next/navigation"

import { buildProductModalHref } from "@/lib/products/schema"

/**
 * "/products/<id>" (old product page): products are now viewed and changed
 * in the 상품 수정 modal on the list, so this address opens the list with
 * that modal. (The modal says so when there is no such product.)
 */
export default async function ProductPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  redirect(buildProductModalHref("", { mode: "edit", id }))
}
