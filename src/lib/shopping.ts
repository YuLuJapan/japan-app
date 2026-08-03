// Shared behaviour for the shopping screens: ticking an item off and naming the
// city an item is tied to. Kept in one place so the home, category and detail
// pages all tick items off the same way.
import { useTrip } from '../api/hooks'
import { useUpdateShoppingItem } from '../api/mutations'
import type { ShoppingItem } from '../api/types'

export function useShoppingActions() {
  const trip = useTrip()
  const update = useUpdateShoppingItem()

  return {
    update,
    /** Name of the city an item's shop sits in, when it names one. */
    zoneName: (zoneId: string | null) =>
      trip.data?.steps.find((s) => s.zone?.id === zoneId)?.zone?.name,
    toggleBought: (item: ShoppingItem) =>
      update.mutate({ id: item.id, patch: { bought: !item.bought } }),
    isToggling: (itemId: string) => update.isPending && update.variables?.id === itemId,
  }
}
