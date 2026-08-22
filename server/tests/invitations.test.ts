// The invitee's side: an invitation that arrives without the link.
//
// Until phase 7 the token *was* the authorization, so someone who never
// received the link had no way to know they had been invited. An invitation
// addressed to an email address is now claimable by the account holding that
// address — which is what makes sending an email optional rather than the
// mechanism.
//
// The rule these cases exist to pin down: **confirmed** address. Anyone can
// type someone else's email at sign-up, so an unconfirmed one proves nothing.
import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { setDataStore, type DataStore } from '../src/lib/datastore.js'
import { createMemoryStore } from '../src/lib/datastore.memory.js'
import { listMyInvitations } from '../src/services/invites.js'
import { OUTSIDER_USER, OWNER_USER, fixture } from './fixture.js'
import { asOutsider, asOwner, asUnconfirmed, useTestTokens } from './auth.js'

const app = createApp()

let store: DataStore

beforeEach(() => {
  store = createMemoryStore(fixture())
  setDataStore(store)
  useTestTokens()
})

/** Invite an address to trip-1 and return the created row. */
async function invite(email: string | null, body: Record<string, unknown> = {}) {
  const res = await asOwner(request(app).post('/api/trips/trip-1/invites')).send({
    role: 'viewer',
    ...(email ? { email } : {}),
    ...body,
  })
  expect(res.status).toBe(201)
  return res.body.invite as { id: string }
}

const inbox = () => asOutsider(request(app).get('/api/invitations'))

describe('the inbox', () => {
  it('shows an invitation addressed to me, with what it would grant', async () => {
    await invite(OUTSIDER_USER.email, { can_see_documents: true })

    const res = await inbox()
    expect(res.status).toBe(200)
    expect(res.body.invitations).toHaveLength(1)
    expect(res.body.invitations[0]).toMatchObject({
      trip_name: 'Test Trip',
      role: 'viewer',
      invited_by: 'Yuval',
      shows: { stays: true, flight: true, documents: true },
    })
    // An unaccepted invitation is not access.
    expect(JSON.stringify(res.body)).not.toContain('Ramen')
  })

  it('matches the address case-insensitively, as email does', async () => {
    await invite(OUTSIDER_USER.email.toUpperCase())
    expect((await inbox()).body.invitations).toHaveLength(1)
  })

  it('names the trip by its built title, not a blank', async () => {
    // A trip that goes by "Alex and Sam in Japan" has no `name` at all since
    // the title moved server-side; reading the raw column would invite
    // somebody to nothing.
    await store.updateTrip('trip-1', { name: null })
    await invite(OUTSIDER_USER.email)
    expect((await inbox()).body.invitations[0].trip_name).toBe('Alex and Sam in Japan')
  })

  it('does not show one addressed to somebody else', async () => {
    await invite('someone.else@example.com')
    expect((await inbox()).body.invitations).toEqual([])
  })

  it('does not show an open link — that one needs the link', async () => {
    await invite(null)
    expect((await inbox()).body.invitations).toEqual([])
  })

  it('does not show a revoked one', async () => {
    const created = await invite(OUTSIDER_USER.email)
    await asOwner(request(app).delete(`/api/trips/trip-1/invites/${created.id}`)).expect(204)
    expect((await inbox()).body.invitations).toEqual([])
  })

  it('does not show an expired one', async () => {
    await invite(OUTSIDER_USER.email)
    // Invitations last 14 days. Rather than reach in and rewrite the column,
    // ask the service what the inbox looks like a month from now.
    const later = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    const res = await listMyInvitations(store, { ...OUTSIDER_USER, email_confirmed: true }, later)
    expect(res.invitations).toEqual([])
  })

  it('does not show a trip I am already on', async () => {
    await store.upsertTripMember({
      trip_id: 'trip-1',
      user_id: OUTSIDER_USER.id,
      role: 'viewer',
    })
    await invite(OUTSIDER_USER.email)
    expect((await inbox()).body.invitations).toEqual([])
  })
})

describe('an unconfirmed address', () => {
  it('sees nothing, and is told why rather than refused', async () => {
    await invite(OUTSIDER_USER.email)
    const res = await asUnconfirmed(request(app).get('/api/invitations'))
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ invitations: [], email_unconfirmed: true })
  })

  it('cannot accept, however the id was obtained', async () => {
    const created = await invite(OUTSIDER_USER.email)
    const res = await asUnconfirmed(request(app).post(`/api/invitations/${created.id}/accept`))
    expect(res.status).toBe(403)
    expect(res.body.error.message).toMatch(/confirm your email/i)
    expect(await store.getTripMember('trip-1', OUTSIDER_USER.id)).toBeNull()
  })
})

describe('accepting from the inbox', () => {
  it('joins the trip with the role and visibility the invitation promised', async () => {
    const created = await invite(OUTSIDER_USER.email, { can_see_stays: false })

    const res = await asOutsider(request(app).post(`/api/invitations/${created.id}/accept`))
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ trip_id: 'trip-1', role: 'viewer', already_member: false })

    const member = await store.getTripMember('trip-1', OUTSIDER_USER.id)
    expect(member).toMatchObject({ role: 'viewer', can_see_stays: false, can_see_flight: true })

    // …and the trip is now theirs to open.
    await asOutsider(request(app).get('/api/trips/trip-1')).expect(200)
    expect((await inbox()).body.invitations).toEqual([])
  })

  it('is single use', async () => {
    const created = await invite(OUTSIDER_USER.email)
    await asOutsider(request(app).post(`/api/invitations/${created.id}/accept`)).expect(200)
    await asOutsider(request(app).post(`/api/invitations/${created.id}/accept`)).expect(404)
  })

  it("404s on somebody else's invitation rather than confirming it exists", async () => {
    const created = await invite('someone.else@example.com')
    const res = await asOutsider(request(app).post(`/api/invitations/${created.id}/accept`))
    expect(res.status).toBe(404)
    expect(await store.getTripMember('trip-1', OUTSIDER_USER.id)).toBeNull()
  })

  it('404s on an id that names nothing', async () => {
    await asOutsider(request(app).post('/api/invitations/made-up/accept')).expect(404)
  })
})

describe('declining', () => {
  it('drops it from my inbox without joining the trip', async () => {
    const created = await invite(OUTSIDER_USER.email)

    await asOutsider(request(app).post(`/api/invitations/${created.id}/decline`)).expect(204)

    expect((await inbox()).body.invitations).toEqual([])
    expect(await store.getTripMember('trip-1', OUTSIDER_USER.id)).toBeNull()
  })

  it('tells the inviter it was declined, rather than vanishing', async () => {
    // Revoked and declined are different facts, and the person who sent it
    // deserves to know which one happened.
    const created = await invite(OUTSIDER_USER.email)
    await asOutsider(request(app).post(`/api/invitations/${created.id}/decline`)).expect(204)

    const list = await asOwner(request(app).get('/api/trips/trip-1/invites'))
    const row = list.body.invites.find((i: { id: string }) => i.id === created.id)
    expect(row.declined_at).toBeTruthy()
  })

  it('cannot be declined twice, or accepted afterwards', async () => {
    const created = await invite(OUTSIDER_USER.email)
    await asOutsider(request(app).post(`/api/invitations/${created.id}/decline`)).expect(204)
    await asOutsider(request(app).post(`/api/invitations/${created.id}/decline`)).expect(404)
    await asOutsider(request(app).post(`/api/invitations/${created.id}/accept`)).expect(404)
  })
})

describe('the link still works', () => {
  it('accepts by token, for someone who was sent one', async () => {
    const minted = await asOwner(request(app).post('/api/trips/trip-1/invites')).send({
      role: 'partner',
    })
    const res = await asOutsider(request(app).post(`/api/invites/${minted.body.token}/accept`))
    expect(res.status).toBe(200)
    expect(await store.getTripMember('trip-1', OUTSIDER_USER.id)).toMatchObject({
      role: 'partner',
    })
  })

  it('names the trip by its built title in the preview too', async () => {
    await store.updateTrip('trip-1', { name: null })
    const minted = await asOwner(request(app).post('/api/trips/trip-1/invites')).send({
      role: 'viewer',
    })
    const res = await asOutsider(request(app).get(`/api/invites/${minted.body.token}`))
    expect(res.body.invite.trip_name).toBe('Alex and Sam in Japan')
  })
})

// Guards against the fixture drifting under these cases.
describe('fixture assumptions', () => {
  it('the outsider is a member of nothing, and the owner owns trip-1', async () => {
    expect(await store.listMembershipsForUser(OUTSIDER_USER.id)).toEqual([])
    expect(await store.getTripMember('trip-1', OWNER_USER.id)).toMatchObject({ role: 'owner' })
  })
})
