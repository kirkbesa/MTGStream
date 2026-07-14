import React from 'react'
import { api } from '../store.js'

function PersonRow({ label, person, onPatch }) {
  return (
    <div className="row person">
      <span className="person-label">{label}</span>
      <input
        placeholder="Name"
        value={person.name ?? ''}
        onChange={e => onPatch({ name: e.target.value })}
      />
      <input
        placeholder="@handle"
        value={person.handle ?? ''}
        onChange={e => onPatch({ handle: e.target.value })}
      />
      <input
        placeholder="they/them"
        value={person.pronouns ?? ''}
        onChange={e => onPatch({ pronouns: e.target.value })}
      />
    </div>
  )
}

export default function Broadcasters({ state }) {
  return (
    <section className="card">
      <div className="section-head"><h2>Broadcasters</h2></div>
      {(state.broadcasters ?? []).map((b, i) => (
        <PersonRow
          key={i}
          label={`Caster ${i + 1}`}
          person={b}
          onPatch={p => api.broadcaster(i, p).catch(() => {})}
        />
      ))}

      <div className="section-head"><h2>Panelists</h2></div>
      {(state.panelists ?? []).map((p, i) => (
        <PersonRow
          key={i}
          label={`Panelist ${i + 1}`}
          person={p}
          onPatch={patch => api.panelist(i, patch).catch(() => {})}
        />
      ))}
    </section>
  )
}
