import { useState } from 'react'

export default function NotFoundPreview() {
  const [honked, setHonked] = useState(false)

  return (
    <main className="not-found-preview">
      <meta name="robots" content="noindex" />
      <h1 className="not-found-announcement">404 — Page not found</h1>
      <p className="not-found-announcement">
        Looks like this page flew the coop. Maybe it took a wrong turn… or just got lost.
      </p>
      <div className="not-found-poster">
        <img src="/404-goose.webp" alt="" width="1254" height="1254" fetchPriority="high" />
        <img
          className="not-found-honk-frame"
          src="/404-goose-sad-honk.webp"
          alt=""
          width="1254"
          height="1254"
          fetchPriority="low"
          decoding="async"
          data-visible={honked}
        />
        <button
          className="not-found-goose"
          type="button"
          aria-label="Make the goose honk"
          onClick={() => setHonked((previous) => !previous)}
        />
        <a className="not-found-home" href="/" aria-label="Back to Upgrade Brief" />
      </div>
      <p className="not-found-announcement" role="status">{honked ? 'Sad honk' : 'Honk… :('}</p>
    </main>
  )
}
