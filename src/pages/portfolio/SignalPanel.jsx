// The read on a chart, expressed as two numbers rather than one.
//
// The previous panel showed a verdict and a single "strength 73/100", which
// conflated two different things: which way the chart leans, and how much the
// evidence agrees. A chart pulling in opposite directions on thin volume looked
// identical to a decisive one. Direction and confidence are now separate, and
// anything arguing the other way is named rather than averaged away.

const VERDICT_TONE = {
  BUY: { text: 'text-gain', bg: 'bg-gain/[0.08]', ring: 'border-gain/20', dot: 'bg-gain' },
  SELL: { text: 'text-loss', bg: 'bg-loss/[0.08]', ring: 'border-loss/20', dot: 'bg-loss' },
  HOLD: { text: 'text-warning', bg: 'bg-warning/[0.07]', ring: 'border-warning/20', dot: 'bg-warning' },
}

function confidenceLabel(confidence) {
  if (confidence >= 75) return 'strong agreement'
  if (confidence >= 55) return 'moderate agreement'
  if (confidence >= 35) return 'weak agreement'
  return 'conflicted'
}

/** Where the lean sits on a sell↔buy axis. */
function DirectionScale({ score }) {
  const pos = Math.max(2, Math.min(98, (score + 100) / 2))
  return (
    <div>
      <div
        className="relative h-2 rounded-full"
        style={{ background: 'linear-gradient(90deg, #fb7185 0%, #3a3a42 50%, #34d399 100%)' }}
      >
        {/* The neutral band the verdict actually uses, drawn so the gauge and
            the wording cannot disagree about what counts as HOLD. */}
        <span className="absolute inset-y-0 left-[42.5%] w-[15%] rounded-sm bg-black/25" />
        <span
          className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-wall-bg bg-white shadow-card transition-all duration-500 ease-ws"
          style={{ left: `${pos}%` }}
        />
      </div>
      <div className="mt-2 flex justify-between text-[10.5px] font-medium uppercase tracking-[0.1em] text-white/30">
        <span>Sell</span><span>Neutral</span><span>Buy</span>
      </div>
    </div>
  )
}

/** One indicator's contribution, signed and to scale. */
function ComponentBar({ label, value, detail }) {
  const pct = Math.min(50, Math.abs(value) * 50)
  const positive = value > 0
  return (
    <div className="flex items-center gap-3 py-1.5">
      <span className="w-[68px] shrink-0 text-[12px] text-white/55">{label}</span>
      <div className="relative h-1.5 w-[72px] shrink-0 rounded-full bg-white/[0.06]">
        <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-white/15" />
        <span
          className={`absolute inset-y-0 rounded-full ${positive ? 'bg-gain/70' : 'bg-loss/70'}`}
          style={positive ? { left: '50%', width: `${pct}%` } : { right: '50%', width: `${pct}%` }}
        />
      </div>
      <span className="min-w-0 flex-1 truncate text-[12px] text-white/40">{detail}</span>
    </div>
  )
}

export default function SignalPanel({ signal }) {
  if (!signal) return null

  const verdict = signal.verdict ?? 'HOLD'
  const tone = VERDICT_TONE[verdict] ?? VERDICT_TONE.HOLD
  const confidence = signal.confidence ?? 0
  const conflicts = signal.conflicts ?? []
  const components = signal.components ?? []

  return (
    <div className="rounded-card border border-white/[0.06] bg-wall-surface px-5 py-5 shadow-card sm:px-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-white/35">Technical read</p>
          <div className="mt-2 flex items-center gap-2.5">
            <span className={`inline-flex items-center gap-2 rounded-lg border px-2.5 py-1 ${tone.bg} ${tone.ring}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
              <span className={`font-display text-[22px] font-semibold leading-none ${tone.text}`}>{verdict}</span>
            </span>
          </div>
        </div>

        <div className="text-right">
          <p className="font-mono text-[22px] font-semibold leading-none tabular text-white/85">{confidence}</p>
          <p className="mt-1 text-[10.5px] text-white/35">confidence</p>
        </div>
      </div>

      <p className="mt-3 text-[12.5px] leading-relaxed text-white/45">
        {confidenceLabel(confidence)} across {signal.coverage ?? '0/4'} indicators
        {signal.relativeVolume != null && ` · volume ${signal.relativeVolume}× normal`}
        {signal.thinVolume && ', so the reading is damped'}
      </p>

      <div className="mt-4">
        <DirectionScale score={signal.score ?? 0} />
      </div>

      {components.length > 0 && (
        <div className="mt-4 border-t border-white/[0.06] pt-2">
          {components.map((c) => (
            <ComponentBar key={c.key} label={c.label} value={c.value} detail={c.detail} />
          ))}
        </div>
      )}

      {/* Naming the dissent is the point. "Selling, but RSI is oversold and
          nobody is trading it" is a different message from "selling". */}
      {conflicts.length > 0 && (
        <div className="mt-3 rounded-xl bg-white/[0.03] px-3.5 py-3">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-white/40">
            Arguing the other way
          </p>
          <ul className="mt-1.5 space-y-1">
            {conflicts.map((c) => (
              <li key={c} className="text-[12.5px] leading-snug text-white/55">{c}</li>
            ))}
          </ul>
        </div>
      )}

      <p className="mt-4 text-[11px] leading-relaxed text-white/25">
        A weighted read of daily trend, momentum, RSI and today&rsquo;s move, damped when volume is
        light. Deterministic, not a recommendation, and it knows nothing about why the stock is
        moving — check the news before acting on it.
      </p>
    </div>
  )
}
