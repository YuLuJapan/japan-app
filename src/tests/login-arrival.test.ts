// Reading the return leg of a sign-in off the URL.
//
// This is the only thing that can tell a tapped email link from a Google
// redirect, and — for the case worth watching — a link that was tapped and
// refused from one nobody opened at all: both leave the person on the gate
// with no session, and only the URL says which happened.
import { describe, expect, it } from 'vitest'
import { readLoginArrival } from '../lib/login-arrival'

const at = (url: string) => readLoginArrival(`https://onward.app${url}`)

describe('readLoginArrival', () => {
  it('says nothing happened on an ordinary visit to the gate', () => {
    expect(at('/gate')).toEqual({ redirect: false, link: null, errorCode: null })
  })

  it('names the magic link that carried the session', () => {
    const arrival = at('/gate#access_token=jwt&expires_in=3600&type=magiclink')
    expect(arrival).toEqual({ redirect: true, link: 'magic_link', errorCode: null })
  })

  it('tells a sign-up confirmation apart from a magic link', () => {
    expect(at('/gate#access_token=jwt&type=signup').link).toBe('signup')
    expect(at('/gate#access_token=jwt&type=invite').link).toBe('invite')
    expect(at('/gate#access_token=jwt&type=recovery').link).toBe('recovery')
  })

  it('calls a link kind it has never seen unknown rather than guessing', () => {
    expect(at('/gate#access_token=jwt&type=email_change').link).toBe('unknown')
  })

  it('leaves Google unlabelled — a provider redirect names no link', () => {
    const arrival = at('/gate#access_token=jwt&provider_token=ya29&expires_in=3600')
    expect(arrival).toEqual({ redirect: true, link: null, errorCode: null })
  })

  it('counts an expired link as a link that was opened', () => {
    const arrival = at(
      '/gate#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid'
    )
    // Which kind of link it was is not in the error, so it is not guessed.
    expect(arrival).toEqual({ redirect: true, link: 'unknown', errorCode: 'otp_expired' })
  })

  it('does not claim a cancelled Google prompt was a link', () => {
    const arrival = at('/gate#error=access_denied&error_description=User+denied')
    expect(arrival).toEqual({ redirect: true, link: null, errorCode: 'access_denied' })
  })

  it('reads the PKCE shape too, in case the flow is ever switched', () => {
    expect(at('/gate?code=auth-code').redirect).toBe(true)
  })

  it('lets the query win over the fragment, exactly as supabase-js does', () => {
    expect(at('/gate?type=recovery#type=magiclink&access_token=jwt').link).toBe('recovery')
  })

  it('survives a URL it cannot parse rather than taking the gate down', () => {
    expect(readLoginArrival('not-a-url')).toEqual({
      redirect: false,
      link: null,
      errorCode: null,
    })
  })
})
