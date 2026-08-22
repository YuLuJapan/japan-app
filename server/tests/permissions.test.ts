// The capability rules, as truth tables. Pure functions, so this file needs no
// server, no store and no HTTP — which is the reason to keep the rules pure.
import { describe, expect, it } from 'vitest'
import {
  TRIP_ROLES,
  canDeleteTrip,
  canEditTrip,
  canInvite,
  canManageMembers,
  canWrite,
  isTripRole,
  type TripRole,
} from '../src/lib/permissions.js'

const table = <T>(fn: (r: TripRole) => T) =>
  Object.fromEntries(TRIP_ROLES.map((r) => [r, fn(r)])) as Record<TripRole, T>

describe('verbs by role', () => {
  it('lets owners and partners write, viewers read', () => {
    expect(table(canWrite)).toEqual({ owner: true, partner: true, viewer: false })
    expect(table(canEditTrip)).toEqual({ owner: true, partner: true, viewer: false })
  })

  it('reserves deleting the trip and managing members for the owner', () => {
    expect(table(canDeleteTrip)).toEqual({ owner: true, partner: false, viewer: false })
    expect(table(canManageMembers)).toEqual({ owner: true, partner: false, viewer: false })
  })
})

describe('canInvite', () => {
  it('lets a partner bring in viewers', () => {
    expect(canInvite('partner', 'viewer')).toBe(true)
  })

  /**
   * The case the target argument exists for. Without it a partner could invite
   * another partner, who invites another — write access spreading sideways with
   * no owner ever in the loop.
   */
  it('stops a partner inviting another partner', () => {
    expect(canInvite('partner', 'partner')).toBe(false)
  })

  it('lets an owner invite either', () => {
    expect(canInvite('owner', 'partner')).toBe(true)
    expect(canInvite('owner', 'viewer')).toBe(true)
  })

  it('never lets a viewer invite anyone', () => {
    expect(canInvite('viewer', 'viewer')).toBe(false)
    expect(canInvite('viewer', 'partner')).toBe(false)
  })
})

describe('isTripRole', () => {
  it('accepts the three roles and nothing else', () => {
    expect(TRIP_ROLES.every(isTripRole)).toBe(true)
    // 'owner' is ungrantable by invite, but it is still a role; 'admin' is not.
    expect(['admin', 'guest', '', null, undefined, 3].some(isTripRole)).toBe(false)
  })
})
