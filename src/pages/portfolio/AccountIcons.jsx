export default function AccountIcon({ name = 'bank', size = 20, ...props }) {
  const paths = {
    bank: <><path d="m3 9 9-6 9 6M4 10h16M5 19h14M3 22h18M6 10v8m6-8v8m6-8v8" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
    chevron: <path d="m9 5 7 7-7 7" />,
    file: <><path d="M14 3H6v18h12V7l-4-4Zm0 0v5h4M9 12h6m-6 4h6" /></>,
    link: <><path d="M9 17H7A5 5 0 0 1 7 7h2" /><path d="M15 7h2a5 5 0 1 1 0 10h-2" /><path d="M8 12h8" /></>,
    shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z" /><path d="m8 12 3 3 5-5" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    back: <path d="M19 12H5m6-6-6 6 6 6" />,
    trash: <><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5m4-5v5" /></>,
    upload: <><path d="M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6" /></>,
    lock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v3" /></>,
    wallet: <><rect x="3" y="6" width="18" height="15" rx="3" /><path d="M3 9V5a2 2 0 0 1 2-2h12v3m0 7h4v4h-4z" /></>,
    search: <><circle cx="10" cy="10" r="6" /><path d="m15 15 5 5" /></>,
  }
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name] || paths.bank}</svg>
}
