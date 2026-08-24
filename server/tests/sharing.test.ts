// Sharing a trip: the invite link, and the member list it feeds.
import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { getDataStore, type DataStore } from '../src/lib/datastore.js'
import { hashToken } from '../src/services/invites.js'
import { OUTSIDER_USER, OWNER_USER, PARTNER_USER, VIEWER_USER } from '../testing/fixture.js'
import { tokenFor } from './auth.js'

const app = createApp()
const as = (t: string) => ({ Authorization: `Bearer ${t}` })

let store: DataStore

const addMember = (userId: string, role: 'owner' | 'partner' | 'viewer') =>
  store.upsertTripMember({ trip_id: 'trip-1', user_id: userId, role })

beforeEach(async () => {
  store = await getDataStore()
})

async function mint(token: string, body: Record<string, unknown>) {
  return request(app).post('/api/trips/trip-1/invites').set(as(token)).send(body)
}

describe('minting an invite', () => {
  it('returns the token exactly once and stores only its hash', async () => {
    const res = await mint(tokenFor(OWNER_USER), { role: 'viewer' })
    expect(res.status).toBe(201)
    expect(typeof res.body.token).toBe('string')

    // The row carries no token, and the list never hands one back.
    expect(res.body.invite).not.toHaveProperty('token')
    expect(res.body.invite).not.toHaveProperty('token_hash')
    const list = await request(app)
      .get('/api/trips/trip-1/invites')
      .set(as(tokenFor(OWNER_USER)))
    expect(JSON.stringify(list.body)).not.toContain(res.body.token)

    // …but the hash of that token does find it, which is how accept works.
    expect(await store.getInviteByTokenHash(hashToken(res.body.token))).toBeTruthy()
  })

  it('defaults documents off and the rest on', async () => {
    const res = await mint(tokenFor(OWNER_USER), { role: 'viewer' })
    expect(res.body.invite).toMatchObject({
      can_see_stays: true,
      can_see_flight: true,
      can_see_shopping: true,
      can_see_documents: false,
    })
  })

  it('lets a partner invite a viewer', async () => {
    await addMember(PARTNER_USER.id, 'partner')
    const res = await mint(tokenFor(PARTNER_USER), { role: 'viewer' })
    expect(res.status).toBe(201)
  })

  /**
   * The case `canInvite` takes a target role for. Without it a partner could
   * invite another partner, who invites another — write access spreading
   * sideways with no owner ever in the loop.
   */
  it('stops a partner inviting another partner', async () => {
    await addMember(PARTNER_USER.id, 'partner')
    const res = await mint(tokenFor(PARTNER_USER), { role: 'partner' })
    expect(res.status).toBe(403)
  })

  it('never lets a viewer invite anyone', async () => {
    await addMember(VIEWER_USER.id, 'viewer')
    const res = await mint(tokenFor(VIEWER_USER), { role: 'viewer' })
    expect(res.status).toBe(403)
  })

  it('refuses owner as a role — it is ungrantable by invite', async () => {
    const res = await mint(tokenFor(OWNER_USER), { role: 'owner' })
    expect(res.status).toBe(400)
  })
})

describe('accepting', () => {
  const accept = (token: string, jwt: string) =>
    request(app).post(`/api/invites/${token}/accept`).set(as(jwt))

  it('turns the holder into a member with the promised role and visibility', async () => {
    const { body } = await mint(tokenFor(OWNER_USER), { role: 'viewer', can_see_documents: true })
    const res = await accept(body.token, tokenFor(OUTSIDER_USER))
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ trip_id: 'trip-1', role: 'viewer', already_member: false })

    const member = await store.getTripMember('trip-1', OUTSIDER_USER.id)
    expect(member).toMatchObject({ role: 'viewer', can_see_documents: true })

    // And the trip now shows up as theirs.
    const trips = await request(app)
      .get('/api/trips')
      .set(as(tokenFor(OUTSIDER_USER)))
    expect(trips.body.trips.map((t: { id: string }) => t.id)).toEqual(['trip-1'])
  })

  it('is single use', async () => {
    const { body } = await mint(tokenFor(OWNER_USER), { role: 'viewer' })
    await accept(body.token, tokenFor(OUTSIDER_USER)).expect(200)
    await accept(body.token, tokenFor(PARTNER_USER)).expect(404)
  })

  it('is idempotent for someone already on the trip, and never a downgrade', async () => {
    const { body } = await mint(tokenFor(OWNER_USER), { role: 'viewer' })
    await addMember(PARTNER_USER.id, 'partner')

    const res = await accept(body.token, tokenFor(PARTNER_USER))
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ role: 'partner', already_member: true })
    expect((await store.getTripMember('trip-1', PARTNER_USER.id))!.role).toBe('partner')
  })

  it('binds to an email when one was given', async () => {
    const { body } = await mint(tokenFor(OWNER_USER), {
      role: 'viewer',
      email: 'friend@example.com',
    })
    await accept(body.token, tokenFor(OUTSIDER_USER)).expect(403)
    await accept(body.token, tokenFor(VIEWER_USER)).expect(200)
  })

  it('404s an unknown, revoked or expired token', async () => {
    await accept('not-a-real-token', tokenFor(OUTSIDER_USER)).expect(404)

    const revoked = await mint(tokenFor(OWNER_USER), { role: 'viewer' })
    await request(app)
      .delete(`/api/trips/trip-1/invites/${revoked.body.invite.id}`)
      .set(as(tokenFor(OWNER_USER)))
      .expect(204)
    await accept(revoked.body.token, tokenFor(OUTSIDER_USER)).expect(404)
  })

  it('refuses an unauthenticated caller — an invite names an account', async () => {
    const { body } = await mint(tokenFor(OWNER_USER), { role: 'viewer' })
    await accept(body.token, 'not-a-real-token').expect(401)
  })
})

describe('the preview before signing in', () => {
  it('names the trip and what the link grants, and nothing else', async () => {
    const { body } = await mint(tokenFor(OWNER_USER), { role: 'viewer', can_see_documents: true })
    const res = await request(app)
      .get(`/api/invites/${body.token}`)
      .set(as(tokenFor(OUTSIDER_USER)))
    expect(res.status).toBe(200)
    expect(res.body.invite).toMatchObject({
      trip_name: 'Test Trip',
      role: 'viewer',
      shows: { stays: true, flight: true, documents: true, shopping: true },
    })
    // An unaccepted invitation is not access.
    expect(res.body.invite).not.toHaveProperty('trip_id')
    expect(JSON.stringify(res.body)).not.toContain('Ramen')
  })
})

describe('the member list', () => {
  it('is visible to everyone on the trip', async () => {
    await addMember(VIEWER_USER.id, 'viewer')
    const res = await request(app)
      .get('/api/trips/trip-1/members')
      .set(as(tokenFor(VIEWER_USER)))
    expect(res.status).toBe(200)
    expect(res.body.members.map((m: { role: string }) => m.role)).toEqual(['owner', 'viewer'])
  })

  it('lets an owner change a role and a viewer’s visibility', async () => {
    await addMember(VIEWER_USER.id, 'viewer')
    const res = await request(app)
      .patch(`/api/trips/trip-1/members/${VIEWER_USER.id}`)
      .set(as(tokenFor(OWNER_USER)))
      .send({ can_see_documents: true })
    expect(res.status).toBe(200)
    expect(res.body.member.can_see_documents).toBe(true)
  })

  it('does not let a partner edit the roster', async () => {
    await addMember(PARTNER_USER.id, 'partner')
    await addMember(VIEWER_USER.id, 'viewer')
    await request(app)
      .patch(`/api/trips/trip-1/members/${VIEWER_USER.id}`)
      .set(as(tokenFor(PARTNER_USER)))
      .send({ role: 'partner' })
      .expect(403)
  })

  /**
   * The invariant Postgres cannot express: a trip with no owner is unreachable
   * by anyone, forever, since membership is the only way in.
   */
  it('refuses to leave a trip without an owner', async () => {
    const demote = await request(app)
      .patch(`/api/trips/trip-1/members/${OWNER_USER.id}`)
      .set(as(tokenFor(OWNER_USER)))
      .send({ role: 'viewer' })
    expect(demote.status).toBe(400)

    const remove = await request(app)
      .delete(`/api/trips/trip-1/members/${OWNER_USER.id}`)
      .set(as(tokenFor(OWNER_USER)))
    expect(remove.status).toBe(400)
  })

  it('allows it once a second owner exists', async () => {
    await addMember(PARTNER_USER.id, 'owner')
    await request(app)
      .patch(`/api/trips/trip-1/members/${OWNER_USER.id}`)
      .set(as(tokenFor(OWNER_USER)))
      .send({ role: 'viewer' })
      .expect(200)
  })

  it('lets a viewer leave under their own steam', async () => {
    await addMember(VIEWER_USER.id, 'viewer')
    await request(app)
      .delete(`/api/trips/trip-1/members/${VIEWER_USER.id}`)
      .set(as(tokenFor(VIEWER_USER)))
      .expect(204)

    const trips = await request(app)
      .get('/api/trips')
      .set(as(tokenFor(VIEWER_USER)))
    expect(trips.body.trips).toEqual([])
  })

  it('does not let a viewer remove anyone else', async () => {
    await addMember(VIEWER_USER.id, 'viewer')
    await request(app)
      .delete(`/api/trips/trip-1/members/${OWNER_USER.id}`)
      .set(as(tokenFor(VIEWER_USER)))
      .expect(403)
  })
})
