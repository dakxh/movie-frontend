import { getHomeCatalog } from '@/lib/catalog'
import SearchOverlay from '@/components/SearchOverlay';
import InfiniteCatalogGrid from '@/components/InfiniteCatalogGrid';

export const revalidate = 3

export default async function CatalogGrid() {
  // Fetch the first 24 items on the server
  const initialPayload = await getHomeCatalog(24, 0)

  return (
    <main className="max-w-screen-2xl mx-auto p-4 md:p-8">
      {/* Pass the complete payload to TanStack Query for initial hydration */}
      <InfiniteCatalogGrid initialData={initialPayload} />
      <SearchOverlay />
    </main>
  )
}