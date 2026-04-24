"use server";

import { getHomeCatalog } from "@/lib/catalog";

export async function fetchMoreCatalog(limit: number, cursor: number) {
  return getHomeCatalog(limit, cursor);
}