import { Chat } from '../core/components/Chat'
import { TextSizeToggle } from '../core/components/TextSizeToggle'
import '../core/theme.css'

function ShieldIcon() {
  return (
    <svg
      width="36"
      height="36"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M12 2 4 5v6c0 5 3.4 8.7 8 9 4.6-.3 8-4 8-9V5l-8-3Z"
        fill="var(--color-accent)"
      />
      <path
        d="m9 12 2 2 4-4"
        stroke="var(--color-accent-contrast)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export default function App() {
  return (
    <div className="app">
      <header className="app__header">
        <div className="app__brand">
          <ShieldIcon />
          <div>
            <h1>Alerta Estafa</h1>
            <p className="app__tagline">
              Te ayudamos a detectar estafas y a aprender a reconocerlas
            </p>
          </div>
        </div>
        <TextSizeToggle />
      </header>
      <main className="app__main">
        <Chat />
      </main>
    </div>
  )
}
