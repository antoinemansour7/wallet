import { useId, useState } from 'react'

function articleUrl(article) {
  try {
    const url = new URL(article.link || article.url)
    return ['https:', 'http:'].includes(url.protocol) ? url.href : null
  } catch { return null }
}

export default function ResearchSources({ research, ideaCount = 0, belowCount = 0 }) {
  const [open, setOpen] = useState(false)
  const detailId = useId()
  const signalCount = research?.signalCount ?? research?.tweetCount ?? 0
  const [showAll, setShowAll] = useState(false)
  const articles = (research?.articles ?? []).filter((article) => article?.title)
  const counts = [
    ['Ideas found', ideaCount],
    ['Signals reviewed', signalCount],
    ['Posts from traders we follow', research?.xBreakdown?.accountSignals],
    ['Other posts found by searching', research?.xBreakdown?.searchSignals],
    ['News articles', Array.isArray(research?.articles) ? research.articles.length : null],
    ['Searches run', research?.queryCount],
  ].filter(([, value]) => value != null)
  return <section className="research-sources" id="research-sources" aria-labelledby="research-sources-title">
    <div className="research-support-heading">
      <div><h2 id="research-sources-title">Run details</h2><p className="research-run-summary">{ideaCount} idea{ideaCount === 1 ? '' : 's'} · {signalCount.toLocaleString()} signals · {Array.isArray(research?.articles) ? research.articles.length.toLocaleString() : '—'} article{research?.articles?.length === 1 ? '' : 's'}</p></div>
      <button type="button" className="research-text-button" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-controls={detailId}>{open ? 'Hide sources' : 'View sources'}<span aria-hidden="true">{open ? '↑' : '↓'}</span></button>
    </div>
    <div id={detailId} className="research-source-details" hidden={!open}>
      <p className="research-source-note">What fed this research run. Idea-specific sources are listed with each pick.</p>
      {belowCount > 0 && <p className="research-source-note">{belowCount} below threshold</p>}
    {counts.length > 0 && <dl className="research-source-counts">{counts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{Number(value).toLocaleString()}</dd></div>)}</dl>}
    {articles.length > 0 ? <>
      <ul className="research-article-list">{(showAll ? articles : articles.slice(0, 4)).map((article, index) => {
        const url = articleUrl(article)
        return <li key={`${article.link || article.url || article.title}-${index}`}><span className="research-notebook-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span><div><span className="research-micro">{article.source || 'News article'}</span>{url ? <a href={url} target="_blank" rel="noopener noreferrer">{article.title}<span aria-hidden="true">↗</span><span className="sr-only"> (opens in a new tab)</span></a> : <p>{article.title}</p>}</div></li>
      })}</ul>
      {articles.length > 4 && <button type="button" className="research-text-button" onClick={() => setShowAll((value) => !value)} aria-expanded={showAll}>{showAll ? 'Show fewer articles' : `Read all ${articles.length} articles`}<span aria-hidden="true">{showAll ? '−' : '+'}</span></button>}
    </> : <p className="research-source-note">{research?.generatedAt ? 'Article links were not included in this run.' : 'Source details will appear with the next research briefing.'}</p>}
    </div>
  </section>
}
