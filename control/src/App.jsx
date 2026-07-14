import React, { useState } from 'react'
import { useAppState } from './store.js'
import Header       from './components/Header.jsx'
import MatchTabs    from './components/MatchTabs.jsx'
import MatchPanel   from './components/MatchPanel.jsx'
import OverlayBar   from './components/OverlayBar.jsx'
import CardSearch   from './components/CardSearch.jsx'
import TimerPanel   from './components/TimerPanel.jsx'
import Standings    from './components/Standings.jsx'
import Bracket      from './components/Bracket.jsx'
import Broadcasters from './components/Broadcasters.jsx'
import Roster       from './components/Roster.jsx'

const TABS = ['Match', 'Roster', 'Cards', 'Standings', 'Bracket', 'Talent']

export default function App() {
  const { state, connected, clientCount } = useAppState()
  const [tab, setTab] = useState('Match')

  // Which slot the operator is EDITING. Deliberately separate from
  // state.activeMatchIndex (the slot the overlays are rendering), so you can
  // prep Match B's decklists while Match A is on air.
  const [editIndex, setEditIndex] = useState(0)

  if (!state) {
    return (
      <div className="boot">
        <div className="boot-title">MTGStream</div>
        <div className="boot-sub">
          {connected ? 'Loading state…' : 'Connecting to server on :3001…'}
        </div>
      </div>
    )
  }

  // A slot can be deleted out from under the selection.
  const mi = Math.min(editIndex, state.matches.length - 1)

  return (
    <div className="app">
      <Header state={state} connected={connected} clientCount={clientCount} />

      <nav className="tabs">
        {TABS.map(t => (
          <button
            key={t}
            className={`tab${tab === t ? ' active' : ''}`}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </nav>

      <OverlayBar state={state} />

      <main className="main">
        {tab === 'Match' && (
          <>
            <MatchTabs
              state={state}
              editIndex={mi}
              onSelect={setEditIndex}
            />
            <MatchPanel state={state} mi={mi} />
            <TimerPanel state={state} mi={mi} />
          </>
        )}
        {tab === 'Roster'    && <Roster state={state} editIndex={mi} />}
        {tab === 'Cards'     && <CardSearch state={state} />}
        {tab === 'Standings' && <Standings state={state} />}
        {tab === 'Bracket'   && <Bracket state={state} editIndex={mi} />}
        {tab === 'Talent'    && <Broadcasters state={state} />}
      </main>
    </div>
  )
}
