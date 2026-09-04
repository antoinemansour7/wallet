/**
 * Firebase auth error codes, translated into sentences a person can act on.
 *
 * This lives apart from AuthContext deliberately. It is a pure mapping with no
 * Firebase dependency of its own, and importing it should not initialise the
 * SDK — `firebase/config` calls `getAuth()` at module load and throws
 * `auth/invalid-api-key` wherever the keys are absent, which is every CI
 * machine. A screen that only needs the copy should not have to boot an
 * authentication client to get it.
 *
 * Two rules govern every string here:
 *   · Never say which of the email or the password was wrong.
 *   · Never say which provider an existing account uses.
 * Both would let someone with a list of addresses learn which ones have
 * accounts here, and how their owners sign in.
 */

const EXISTING_ACCOUNT_MESSAGE = 'An account with this email already exists. Try signing in instead.'
const LINK_COLLISION_MESSAGE = 'This email is already linked to a different account.'
const GENERIC_MESSAGE = 'Could not complete the request. Please try again.'

export function getAuthErrorMessage(err, context = 'signin') {
  switch (err?.code) {
    case 'auth/email-already-in-use':
      return context === 'link' ? LINK_COLLISION_MESSAGE : EXISTING_ACCOUNT_MESSAGE
    case 'auth/account-exists-with-different-credential':
      return EXISTING_ACCOUNT_MESSAGE
    case 'auth/credential-already-in-use':
      return LINK_COLLISION_MESSAGE
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Incorrect email or password.'
    case 'auth/invalid-email':
      return 'Enter a valid email address.'
    case 'auth/weak-password':
      return 'Choose a password with at least 6 characters.'
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a few minutes and try again.'
    case 'auth/requires-recent-login':
      return 'Please sign in again, then try adding a password.'
    case 'auth/unauthorized-domain':
      return 'This domain is not allowed in Firebase Auth. Add the Vercel domain to Firebase Authentication authorized domains.'
    case 'auth/invalid-api-key':
    case 'auth/api-key-not-valid':
      return 'Firebase API key is missing or invalid in Vercel environment variables.'
    case 'auth/configuration-not-found':
    case 'auth/operation-not-allowed':
      return 'This sign-in provider is not enabled for this Firebase project.'
    case 'auth/popup-blocked':
      return 'The Google sign-in popup was blocked by your browser.'
    case 'auth/popup-closed-by-user':
      return 'The Google sign-in popup was closed before sign-in finished.'
    default:
      // An unmapped auth/* code gets the generic sentence rather than its raw
      // Firebase text: several of those sentences confirm an account exists
      // (auth/user-disabled says so outright). Non-Firebase errors keep their
      // message — that is what renders the guard's own thrown Error.
      if (err?.code?.startsWith('auth/')) return GENERIC_MESSAGE
      return err?.message || GENERIC_MESSAGE
  }
}
