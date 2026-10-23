import { redirect } from "next/navigation"

/**
 * "/products/new" (old address): 상품 등록 is now a modal on the list, so this
 * address opens the list with that modal.
 */
export default function NewProductPage() {
  redirect("/products?modal=new")
}
