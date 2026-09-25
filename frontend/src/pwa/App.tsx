import { Chat } from '../core/components/Chat'
import { TextSizeToggle } from '../core/components/TextSizeToggle'
import { ShieldIcon } from '../core/components/ShieldIcon'
import '../core/theme.css'

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
