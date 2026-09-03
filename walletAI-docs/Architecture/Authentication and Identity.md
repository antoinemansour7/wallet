# Authentication and Identity

The durable decision behind [[Home|WallAI]]'s sign-in system. Implementation
work is tracked in [the authentication epic](https://github.com/antoinemansour7/wallet/issues/46);
this note records the boundary that work must preserve and why the alternatives
were rejected.

Decision made 2026-09-03 in
[#47](https://github.com/antoinemansour7/wallet/issues/47). **It is not fully
implemented yet.** Today the app still signs in with Google through a popup.

## The decision

WallAI will offer two ways in:

1. **Google**, kept for the people already using it.
2. **Email and password**, the first provider added.

Email and password is familiar, works for anyone with an email address, has no
paid third-party prerequisite, and leaves password storage with Firebase rather
than WallAI. The surrounding work is part of the feature, not polish: email
verification, password reset, neutral error messages, attempt throttling and
correct password-manager fields all have to ship with it.

A blocked Google popup will fall back to a Google redirect. That is a fallback
for the same provider, not a third way to create an account.

## The invariant: one person, one Firebase user

Every user-owned record is keyed by Firebase's `uid`:

| Data | Key |
|---|---|
| Portfolio | `users/{uid}/portfolio/current` |
| Daily history | `users/{uid}/portfolio-history/{date}` |
| Brokerage connections | `users/{uid}/plaid/{itemId}` |
| Device cache | `wallai:portfolio:{uid}` |

The same person signing in with Google and with a password must receive the
**same uid**. If the providers create two Firebase users, their portfolio has
not technically been deleted, but it disappears just as completely because the
second uid points at an empty path.

Firebase's **One account per email address** setting therefore must be enabled
before the second provider ships. The multiple-accounts-per-email mode is not
compatible with WallAI's data model. Verify the live project's setting rather
than assuming its current value.

The second credential must be linked to the authenticated Firebase user rather
than used to create another one. An existing Google user adds a password to the
Google-backed account; a password user adding Google does the inverse. Provider
linking must be proven in a Firebase test project before production is changed:
sign out after linking, use each method in turn, and assert both sessions have
the same uid and see the same holdings.

There is no existing migration to write. Google is the only provider today, so
the application cannot already have created a second-provider identity. A data
migration becomes necessary only if testing discovers duplicate users; writing
one speculatively would put real portfolios at risk for no benefit.

## Do not look up an email's provider publicly

The original identity plan proposed `fetchSignInMethodsForEmail` so the page
could say that an address already uses Google. That API is now deprecated, and
Firebase deliberately returns an empty list when Email Enumeration Protection
is enabled. Revealing whether a named address has an account would also give an
attacker the fact the protection exists to hide.

Keep public failure copy neutral. Resolve a credential collision by asking the
person to authenticate with their existing method, then link the new credential
inside that authenticated session. Do not create a fresh user as a fallback.

## Why not the other options

### Email link

Passwordless links verify ownership and avoid password-reset work, but they add
an inbox round trip to every sign-in. More decisively, Firebase's current Spark
quota is only **five sign-in-link emails per day**. It may make sense later as a
recovery option after billing and demand are known; it is not the first second
provider.

### Apple

Deferred until a native iOS product makes it necessary. Configuration requires
paid Apple Developer Program membership, a Service ID and private key, plus
policy work for Apple's private-relay addresses. That prerequisite does not
earn its cost for the web app today.

### Redirect by itself

A redirect rescues a blocked Google popup but still excludes everybody without
Google. It ships as fallback behavior alongside email/password, not as the
answer to the provider decision.

## Redirect is configuration, not one function call

The current `authDomain` is `wallai-9f983.firebaseapp.com`, while the app is
served from Vercel. Modern Safari, Firefox and Chrome restrict the cross-origin
storage used by Firebase's redirect helper, so calling `signInWithRedirect`
under that configuration would replace one unreliable path with another.

Before enabling the fallback, serve Firebase's `/__/auth/*` helper from the app
origin through a transparent proxy (or put the app on a Firebase-backed custom
auth domain), update `authDomain`, and verify the redirect on those browsers.

## Order of work

1. [#48 — prove identity linking and uid preservation](https://github.com/antoinemansour7/wallet/issues/48).
2. [#49 — build the email/password sign-in and sign-up flow](https://github.com/antoinemansour7/wallet/issues/49).
3. Enable the provider and one-account-per-email setting only with that flow
   ready.
4. Add and verify the same-origin Google redirect fallback.

The independent card and theme decisions can move separately; they do not
change identity.

## Primary references

- [Firebase account linking](https://firebase.google.com/docs/auth/web/account-linking)
- [Firebase Auth security checklist](https://firebase.google.com/support/guides/security-checklist)
- [Redirect sign-in and third-party storage](https://firebase.google.com/docs/auth/web/redirect-best-practices)
- [Firebase Authentication limits](https://firebase.google.com/docs/auth/limits)
- [Email-link authentication](https://firebase.google.com/docs/auth/web/email-link-auth)
- [Sign in with Apple through Firebase](https://firebase.google.com/docs/auth/web/apple)
