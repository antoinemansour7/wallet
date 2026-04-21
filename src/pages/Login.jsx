import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function Login() {
  const { user, signInWithGoogle } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (user) navigate('/portfolio', { replace: true })
  }, [user, navigate])

  const handleSignIn = async () => {
    try {
      await signInWithGoogle()
    } catch (err) {
      console.error('Sign-in failed:', err)
    }
  }

  return (
    <div className="min-h-screen bg-wall-bg bg-dot-grid flex items-center justify-center relative overflow-hidden">
      {/* Ambient glow blobs */}
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-blue-600/[0.07] rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 left-1/4 w-72 h-72 bg-indigo-700/[0.06] rounded-full blur-3xl pointer-events-none" />

      <div className="relative w-full max-w-[380px] mx-4">
        {/* Card */}
        <div className="bg-wall-surface border border-white/[0.07] rounded-2xl p-8 shadow-2xl">

          {/* Brand */}
          <div className="flex flex-col items-center mb-8">
            <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center mb-4 shadow-lg shadow-blue-600/30 glow-blue">
              <LogoIcon />
            </div>
            <h1 className="text-[22px] font-semibold text-slate-100 tracking-tight">WallAI</h1>
            <p className="text-slate-500 text-sm mt-1 text-center">Your intelligent portfolio tracker</p>
          </div>

          {/* Divider */}
          <div className="flex items-center gap-3 mb-5">
            <div className="flex-1 h-px bg-white/[0.06]" />
            <span className="text-slate-600 text-xs">Sign in to continue</span>
            <div className="flex-1 h-px bg-white/[0.06]" />
          </div>

          {/* Google button */}
          <button
            onClick={handleSignIn}
            className="w-full flex items-center justify-center gap-3 bg-white hover:bg-slate-50 active:bg-slate-100 active:scale-[0.98] text-slate-800 font-medium text-sm px-4 py-[11px] rounded-xl transition-all duration-150 cursor-pointer shadow-sm"
          >
            <GoogleIcon />
            Continue with Google
          </button>

          <p className="text-slate-700 text-[11px] text-center mt-5 leading-relaxed">
            By continuing you agree to our Terms of Service<br />and Privacy Policy
          </p>
        </div>

        {/* Bottom hint */}
        <p className="text-slate-700 text-xs text-center mt-4">
          Secured by Firebase Authentication
        </p>
      </div>
    </div>
  )
}

function LogoIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
      <path d="M2 16L7 9L11 13L15 6L20 10" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2 19h18" stroke="white" strokeWidth="1.5" strokeLinecap="round" opacity="0.4" />
    </svg>
  )
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  )
}
