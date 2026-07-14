// overlays/ws.js — shared WebSocket client for all MTGStream overlays
//
// Provides:  connectOverlay(onMessage)
//
// Behaviour:
//   • Connects to ws://hostname:3001/ws and auto-reconnects every 2 s on drop
//   • On the FIRST successful connection: just records that we're live
//   • On a RECONNECT after a drop: calls location.reload()
//       → OBS re-fetches the HTML, picking up any code changes made while the
//         server was down (or any changes that required a server restart)
//   • On receiving { type: 'reload' } from the server: calls location.reload()
//       → Lets the server push a reload when overlay files change WITHOUT
//         restarting — just edit & save, OBS updates in ~1 s
//   • All other messages are forwarded to the onMessage callback as-is
//
// Usage (replace the inline WS boilerplate in each overlay):
//
//   <script src="/overlays/ws.js"></script>
//   <script>
//     connectOverlay(msg => {
//       if (msg.type === 'state') render(msg.data)
//     })
//   </script>

;(function () {
  let _connected = false
  let _timer = null

  window.connectOverlay = function connectOverlay(onMessage) {
    const url = `ws://${location.hostname}:3001/ws`
    const ws  = new WebSocket(url)

    ws.onopen = function () {
      clearTimeout(_timer)
      if (_connected) {
        // Reconnected after a drop → reload so OBS picks up any HTML/JS changes
        location.reload()
        return
      }
      _connected = true
    }

    ws.onclose = function () {
      _timer = setTimeout(function () { connectOverlay(onMessage) }, 2000)
    }

    ws.onerror = function () { ws.close() }

    ws.onmessage = function (e) {
      try {
        const msg = JSON.parse(e.data)
        if (msg.type === 'reload') { location.reload(); return }
        onMessage(msg)
      } catch (_) {}
    }
  }
})()
